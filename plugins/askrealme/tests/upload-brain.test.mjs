import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inflateRawSync } from "node:zlib";

import {
  AUTH_HANDOFF_TIMEOUT_MS,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  MAX_ARCHIVE_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_PATH_BYTES,
  MAX_PATH_DEPTH,
  MAX_TOTAL_BYTES,
  PUBLIC_SITE_URL,
  UploadBrainError,
  assertUniqueArchivePaths,
  buildBrainZip,
  crc32,
  getDraftStatus,
  openAuthorizationUrl,
  prepareBrainUpload,
  requestUploadAuthorization,
  resolveBrainArchiveEndpoint,
  resolveDraftEndpoint,
  resolveDraftStatusEndpoint,
  uploadBrain,
  uploadPreparedBrain,
} from "../lib/upload-brain.mjs";

const UUID_ONE = "11111111-1111-4111-8111-111111111111";
const UUID_TWO = "22222222-2222-4222-8222-222222222222";
const UPLOAD_CODE = "7Qm3p9Kx2Nw8Za4Bc6De8Fg0Hi2Jk4Lm6No8Pq0Rs2T";
const RAW_ID_TOKEN = "header.payload.signature";

function tempDir(name = "brain") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upload-brain-test-"));
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function write(directory, relativePath, content = "") {
  const target = path.join(directory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function brainContent({ uuid = UUID_ONE, eol = "\n", body = "# Brain\n\nContent\n" } = {}) {
  const fields = [`version: 1`, ...(uuid ? [`uuid: ${uuid}`] : [])];
  return `---${eol}${fields.join(eol)}${eol}---${eol}${body.replaceAll("\n", eol)}`;
}

function createdResponse(fileCount, overrides = {}) {
  return new Response(JSON.stringify({
    success: true,
    mode: "created",
    uuid: UUID_ONE,
    fileCount,
    expiresAt: "2026-08-26T00:00:00.000Z",
    confirmPath: `/brains/${UUID_ONE}/confirm`,
    confirmUrl: `https://www.askreal.me/brains/${UUID_ONE}/confirm`,
    ...overrides,
  }), { status: 201, headers: { "content-type": "application/json" } });
}

function updatedResponse(fileCount, overrides = {}) {
  return new Response(JSON.stringify({
    success: true,
    mode: "updated",
    uuid: UUID_ONE,
    fileCount,
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function parseZip(archive) {
  const files = [];
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const checksum = archive.readUInt32LE(offset + 14);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const size = archive.readUInt32LE(offset + 22);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    assert.equal(content.byteLength, size);
    assert.equal(crc32(content), checksum);
    files.push({ name, flags, method, checksum, content });
    offset = dataStart + compressedSize;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50);
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50);
  assert.equal(archive.readUInt16LE(endOffset + 10), files.length);
  return files;
}

test("prepares a recursive snapshot with a client UUID, Unicode paths, and a deterministic Unicode-only slug", async () => {
  const project = tempDir("🧠");
  const output = path.join(project, "output");
  fs.mkdirSync(output);
  write(output, "BRAIN.md", brainContent({ body: "# Actual Brain Name\n" }));
  write(output, "sources/meeting notes.md", "Meeting");
  write(output, "entities/people/José.md", "Person");
  write(output, ".DS_Store", "skip");
  write(output, "sources/Thumbs.db", "skip");

  const prepared = await prepareBrainUpload(output);

  assert.equal(prepared.name, "Actual Brain Name");
  assert.equal(prepared.slug, "brain-bf0e823c");
  assert.equal(prepared.uuid, UUID_ONE);
  assert.deepEqual(
    prepared.files.map((file) => file.relativePath).sort(),
    ["BRAIN.md", "entities/people/José.md", "sources/meeting notes.md"].sort(),
  );
});

test("reads an existing root BRAIN.md uuid as the update identity", async () => {
  const directory = tempDir("existing");
  write(directory, "BRAIN.md", brainContent({ uuid: UUID_ONE }));
  const prepared = await prepareBrainUpload(directory);
  assert.equal(prepared.uuid, UUID_ONE);
});

test("accepts more than 40 files and exposes the backend limits", async () => {
  const directory = tempDir("many-files");
  write(directory, "BRAIN.md", brainContent());
  for (let index = 0; index < 45; index += 1) write(directory, `sources/${index}.md`, `${index}\n`);

  const prepared = await prepareBrainUpload(directory);
  const entries = parseZip(buildBrainZip(prepared));

  assert.equal(prepared.fileCount, 46);
  assert.equal(entries.length, 46);
  assert.equal(MAX_FILES, 10_000);
  assert.equal(MAX_FILE_BYTES, 10_000_000);
  assert.equal(MAX_TOTAL_BYTES, 250_000_000);
  assert.equal(MAX_ARCHIVE_BYTES, 100_000_000);
  assert.equal(MAX_PATH_DEPTH, 24);
  assert.equal(MAX_PATH_BYTES, 1_024);
});

test("enforces the per-file byte limit", async () => {
  const directory = tempDir();
  write(directory, "BRAIN.md", brainContent());
  write(directory, "large.bin", Buffer.alloc(MAX_FILE_BYTES + 1));
  await assert.rejects(
    () => prepareBrainUpload(directory),
    (error) => error instanceof UploadBrainError && error.code === "FILE_TOO_LARGE",
  );
});

test("rejects deep, long, absolute, control-character, NFC, and case-fold collisions", () => {
  const tooDeep = `${Array.from({ length: MAX_PATH_DEPTH }, (_, index) => `d${index}`).join("/")}/x.md`;
  const tooLong = `${"a".repeat(MAX_PATH_BYTES + 1)}.md`;
  for (const [paths, code] of [
    [[tooDeep], "PATH_TOO_DEEP"],
    [[tooLong], "PATH_TOO_LONG"],
    [["C:/secret.md"], "INVALID_PATH"],
    [["bad\u0001name.md"], "INVALID_PATH"],
    [["sources/e\u0301.md", "sources/é.md"], "PATH_COLLISION"],
    [["sources/straße.md", "sources/STRASSE.md"], "PATH_COLLISION"],
    [["Sources/a.md", "sources/b.md"], "PATH_COLLISION"],
  ]) {
    assert.throws(
      () => assertUniqueArchivePaths(paths),
      (error) => error instanceof UploadBrainError && error.code === code,
    );
  }
});

test("rejects symlinks and requires root BRAIN.md", async () => {
  const linked = tempDir("linked");
  write(linked, "BRAIN.md", brainContent());
  fs.symlinkSync(path.join(linked, "BRAIN.md"), path.join(linked, "linked.md"));
  await assert.rejects(
    () => prepareBrainUpload(linked),
    (error) => error instanceof UploadBrainError && error.code === "SYMLINK_NOT_ALLOWED",
  );

  const missing = tempDir("missing");
  write(missing, "page.md", "page");
  await assert.rejects(
    () => prepareBrainUpload(missing),
    (error) => error instanceof UploadBrainError && error.code === "BRAIN_FILE_REQUIRED",
  );
});

test("pins a canonical root when the requested parent path is a symlink", async () => {
  const physicalParent = tempDir("physical-parent");
  const physicalOutput = path.join(physicalParent, "output");
  fs.mkdirSync(physicalOutput);
  write(physicalOutput, "BRAIN.md", brainContent({ body: "# pinned\n" }));
  const aliasContainer = tempDir("alias-container");
  const parentAlias = path.join(aliasContainer, "linked-parent");
  fs.symlinkSync(physicalParent, parentAlias, "dir");

  const prepared = await prepareBrainUpload(path.join(parentAlias, "output"));

  assert.equal(prepared.brainDir, fs.realpathSync(physicalOutput));
  assert.deepEqual(prepared.files.map((file) => file.relativePath), ["BRAIN.md"]);
});

test("rejects directory and file symlink swaps before reading outside bytes", async (context) => {
  await context.test("directory swap", async () => {
    const directory = tempDir("directory-swap");
    write(directory, "BRAIN.md", brainContent());
    write(directory, "sources/inside.md", "inside bytes");
    const outside = tempDir("directory-outside");
    write(outside, "inside.md", "outside secret");
    const sources = fs.realpathSync(path.join(directory, "sources"));
    const physicalDirectory = path.dirname(sources);
    const backup = path.join(physicalDirectory, "sources-original");
    const originalReaddir = fsPromises.readdir;
    let swapped = false;
    fsPromises.readdir = async function readdirWithSwap(current, options) {
      const entries = await originalReaddir.call(this, current, options);
      if (!swapped && path.resolve(current) === path.resolve(sources)) {
        swapped = true;
        fs.renameSync(sources, backup);
        fs.symlinkSync(outside, sources, "dir");
      }
      return entries;
    };
    try {
      await assert.rejects(
        () => prepareBrainUpload(directory),
        (error) => error instanceof UploadBrainError && error.code === "SYMLINK_NOT_ALLOWED",
      );
    } finally {
      fsPromises.readdir = originalReaddir;
      if (fs.existsSync(backup)) {
        if (fs.lstatSync(sources).isSymbolicLink()) fs.unlinkSync(sources);
        fs.renameSync(backup, sources);
      }
    }
    assert.equal(swapped, true);
  });

  await context.test("file swap", async () => {
    const directory = tempDir("file-swap");
    write(directory, "BRAIN.md", brainContent());
    write(directory, "inside.md", "inside bytes");
    const outside = path.join(tempDir("file-outside"), "secret.md");
    fs.writeFileSync(outside, "outside secret");
    const inside = fs.realpathSync(path.join(directory, "inside.md"));
    const backup = path.join(path.dirname(inside), "inside-original.md");
    const originalRealpath = fsPromises.realpath;
    let swapped = false;
    fsPromises.realpath = async function realpathWithSwap(current, options) {
      const resolved = await originalRealpath.call(this, current, options);
      if (!swapped && path.resolve(current) === path.resolve(inside)) {
        swapped = true;
        fs.renameSync(inside, backup);
        fs.symlinkSync(outside, inside);
      }
      return resolved;
    };
    try {
      await assert.rejects(
        () => prepareBrainUpload(directory),
        (error) => error instanceof UploadBrainError && error.code === "SYMLINK_NOT_ALLOWED",
      );
    } finally {
      fsPromises.realpath = originalRealpath;
      if (fs.existsSync(backup)) {
        if (fs.lstatSync(inside).isSymbolicLink()) fs.unlinkSync(inside);
        fs.renameSync(backup, inside);
      }
    }
    assert.equal(swapped, true);
  });
});

test("builds a deterministic UTF-8 ZIP with valid CRC32, store, deflate, and central directory", async () => {
  const directory = tempDir("zip");
  write(directory, "BRAIN.md", brainContent({ body: `# zip\n\n${"repeat ".repeat(200)}\n` }));
  write(directory, "sources/café.md", Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  const prepared = await prepareBrainUpload(directory);

  const first = buildBrainZip(prepared);
  const second = buildBrainZip(prepared);
  const entries = parseZip(first);

  assert.deepEqual(first, second);
  assert.deepEqual(entries.map((entry) => entry.name), ["BRAIN.md", "sources/café.md"]);
  assert.ok(entries.every((entry) => (entry.flags & 0x0800) !== 0));
  assert.ok(entries.some((entry) => entry.method === 8));
  assert.ok(entries.some((entry) => entry.method === 0));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("uses secure direct backend endpoints and development-only overrides", () => {
  assert.equal(resolveDraftEndpoint({}), "https://askrealmeapi-production.up.railway.app/drafts");
  assert.equal(resolveDraftStatusEndpoint(UUID_ONE, {}), `https://askrealmeapi-production.up.railway.app/drafts/${UUID_ONE}`);
  assert.equal(resolveBrainArchiveEndpoint(UUID_ONE, {}), `https://askrealmeapi-production.up.railway.app/brains/${UUID_ONE}/archive`);
  assert.equal(
    resolveDraftEndpoint({ NODE_ENV: "development", ASKREAL_API_URL: "http://127.0.0.1:3001/api/" }),
    "http://127.0.0.1:3001/api/drafts",
  );
  assert.throws(
    () => resolveDraftEndpoint({ ASKREAL_API_URL: "http://127.0.0.1:3001" }),
    (error) => error instanceof UploadBrainError && error.code === "API_OVERRIDE_NOT_ALLOWED",
  );
});

test("looks up upload state by the client-created UUID", async () => {
  const result = await getDraftStatus(UUID_ONE, {
    environment: {},
    fetchImpl: async (url, init) => {
      assert.equal(url, `https://askrealmeapi-production.up.railway.app/drafts/${UUID_ONE}`);
      assert.equal(init.method, "GET");
      return new Response(JSON.stringify({
        success: true,
        status: "pending",
        expiresAt: "2026-08-27T20:00:00.000Z",
      }), { status: 200 });
    },
  });
  assert.deepEqual(result, {
    status: "pending",
    confirmPath: `/brains/${UUID_ONE}/confirm`,
    confirmUrl: `https://www.askreal.me/brains/${UUID_ONE}/confirm`,
    expiresAt: "2026-08-27T20:00:00.000Z",
  });
});

test("creates with exactly one archive part and uploads the untouched BRAIN.md snapshot", async () => {
  const directory = tempDir("create");
  const originalBrain = brainContent({ body: "# New Brain\n\nOriginal\n" });
  write(directory, "BRAIN.md", originalBrain);
  write(directory, "sources/café.md", "Content");
  let calls = 0;

  const result = await uploadBrain({
    brainDir: directory,
    draftStatus: "missing",
    environment: {},
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, "https://askrealmeapi-production.up.railway.app/drafts");
      assert.equal(init.method, "POST");
      assert.equal(init.headers, undefined);
      assert.deepEqual([...init.body.keys()], ["name", "slug", "archive"]);
      assert.equal(init.body.getAll("archive").length, 1);
      assert.equal(init.body.get("archive").name, "brain.zip");
      assert.equal(init.body.getAll("files").length, 0);
      const archive = Buffer.from(await init.body.get("archive").arrayBuffer());
      const entries = parseZip(archive);
      assert.equal(entries.find((entry) => entry.name === "BRAIN.md").content.toString("utf8"), originalBrain);
      return createdResponse(2);
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.mode, "created");
  assert.equal(result.uuid, UUID_ONE);
  assert.equal(result.confirmUrl, `https://www.askreal.me/brains/${UUID_ONE}/confirm`);
  assert.equal(Object.hasOwn(result, "brainFile"), false);
  assert.equal(fs.readFileSync(path.join(directory, "BRAIN.md"), "utf8"), originalBrain);
});

test("sends the validated snapshot even if disk changes and preserves the changed local file", async () => {
  const directory = tempDir("snapshot");
  const original = brainContent({ body: "# before\n\noriginal bytes\n" });
  write(directory, "BRAIN.md", original);
  const prepared = await prepareBrainUpload(directory);
  const changed = brainContent({ body: "# after\n\nchanged bytes\n" });
  write(directory, "BRAIN.md", changed);
  let archivedBrain;

  const result = await uploadPreparedBrain({
    prepared,
    draftStatus: "missing",
    environment: {},
    fetchImpl: async (_url, init) => {
      const archive = Buffer.from(await init.body.get("archive").arrayBuffer());
      archivedBrain = parseZip(archive).find((entry) => entry.name === "BRAIN.md").content.toString("utf8");
      return createdResponse(1);
    },
  });

  assert.equal(archivedBrain, original);
  assert.equal(result.mode, "created");
  assert.equal(fs.readFileSync(path.join(directory, "BRAIN.md"), "utf8"), changed);
});

test("refuses missing upload authorization and explicitly rejects raw Firebase credentials before networking", async () => {
  const directory = tempDir("auth-required");
  write(directory, "BRAIN.md", brainContent({ uuid: UUID_ONE }));
  let calls = 0;
  await assert.rejects(
    () => uploadBrain({
      brainDir: directory,
      draftStatus: "claimed",
      environment: {},
      fetchImpl: async () => { calls += 1; return updatedResponse(1); },
    }),
    (error) => error instanceof UploadBrainError && error.code === "AUTH_REQUIRED",
  );
  await assert.rejects(
    () => uploadBrain({
      brainDir: directory,
      idToken: RAW_ID_TOKEN,
      environment: {},
      fetchImpl: async () => { calls += 1; return updatedResponse(1); },
    }),
    (error) => error instanceof UploadBrainError && error.code === "RAW_CREDENTIAL_NOT_ALLOWED",
  );
  assert.equal(calls, 0);
});

test("updates the existing UUID endpoint with a one-use UploadCode and no sign-in fields", async () => {
  const directory = tempDir("update");
  const original = brainContent({ uuid: UUID_ONE, body: "# Existing Brain\n" });
  write(directory, "BRAIN.md", original);

  const result = await uploadBrain({
    brainDir: directory,
    uploadAuthorization: UPLOAD_CODE,
    environment: {},
    fetchImpl: async (url, init) => {
      assert.equal(url, `https://askrealmeapi-production.up.railway.app/brains/${UUID_ONE}/archive`);
      assert.equal(init.method, "PUT");
      assert.deepEqual(init.headers, { Authorization: `UploadCode ${UPLOAD_CODE}` });
      assert.deepEqual([...init.body.keys()], ["name", "slug", "archive"]);
      const archive = Buffer.from(await init.body.get("archive").arrayBuffer());
      assert.equal(parseZip(archive).find((entry) => entry.name === "BRAIN.md").content.toString("utf8"), original);
      return updatedResponse(1);
    },
  });

  assert.deepEqual(result, {
    mode: "updated",
    uuid: UUID_ONE,
    name: "Existing Brain",
    slug: "update",
    fileCount: 1,
    totalBytes: Buffer.byteLength(original),
  });
  assert.equal(fs.readFileSync(path.join(directory, "BRAIN.md"), "utf8"), original);
  assert.equal(Object.hasOwn(result, "signinPath"), false);
});

test("never exposes an upload code echoed by an upstream error", async () => {
  const directory = tempDir("redacted-update-error");
  write(directory, "BRAIN.md", brainContent({ uuid: UUID_ONE }));
  await assert.rejects(
    () => uploadBrain({
      brainDir: directory,
      uploadAuthorization: UPLOAD_CODE,
      environment: {},
      fetchImpl: async () => new Response(JSON.stringify({ message: `rejected ${UPLOAD_CODE}` }), { status: 401 }),
    }),
    (error) => error instanceof UploadBrainError
      && error.code === "HTTP_ERROR"
      && !error.message.includes(UPLOAD_CODE),
  );
});

test("rejects update UUID mismatch and sign-in fields without changing local uuid", async () => {
  for (const response of [
    updatedResponse(1, { uuid: UUID_TWO }),
    updatedResponse(1, { signinPath: "/signin?token=482193" }),
  ]) {
    const directory = tempDir("update-invalid");
    const original = brainContent({ uuid: UUID_ONE });
    write(directory, "BRAIN.md", original);
    await assert.rejects(
      () => uploadBrain({
        brainDir: directory,
        uploadAuthorization: UPLOAD_CODE,
        environment: {},
        fetchImpl: async () => response,
      }),
      (error) => error instanceof UploadBrainError
        && new Set(["UUID_MISMATCH", "INVALID_RESPONSE"]).has(error.code),
    );
    assert.equal(fs.readFileSync(path.join(directory, "BRAIN.md"), "utf8"), original);
  }
});

test("invalid created response and HTTP failure leave local BRAIN.md untouched", async () => {
  for (const response of [
    createdResponse(1, { uuid: "not-a-uuid" }),
    new Response(JSON.stringify({ message: "unavailable" }), { status: 503 }),
  ]) {
    const directory = tempDir("create-invalid");
    const original = brainContent();
    write(directory, "BRAIN.md", original);
    await assert.rejects(() => uploadBrain({
      brainDir: directory,
      draftStatus: "missing",
      environment: {},
      fetchImpl: async () => response,
    }), UploadBrainError);
    assert.equal(fs.readFileSync(path.join(directory, "BRAIN.md"), "utf8"), original);
  }
});

test("expected snapshot rejects added, deleted, and modified files before networking", async (context) => {
  async function fixture() {
    const directory = tempDir("expected");
    write(directory, "BRAIN.md", brainContent());
    write(directory, "sources/a.md", "original\n");
    const prepared = await prepareBrainUpload(directory);
    return {
      directory,
      expectedFiles: prepared.files.map((file) => ({ name: file.relativePath, hash: file.sha256 })),
    };
  }
  for (const [label, mutate] of [
    ["added", (directory) => write(directory, "sources/new.md", "new")],
    ["deleted", (directory) => fs.unlinkSync(path.join(directory, "sources", "a.md"))],
    ["modified", (directory) => write(directory, "sources/a.md", "changed")],
  ]) {
    await context.test(label, async () => {
      const { directory, expectedFiles } = await fixture();
      mutate(directory);
      let calls = 0;
      await assert.rejects(() => uploadBrain({
        brainDir: directory,
        expectedFiles,
        environment: {},
        fetchImpl: async () => { calls += 1; return createdResponse(2); },
      }), (error) => error instanceof UploadBrainError && error.code === "SNAPSHOT_MISMATCH");
      assert.equal(calls, 0);
    });
  }
});

test("rejects a BRAIN.md without the client-created UUID", async () => {
  const directory = tempDir("missing-uuid");
  write(directory, "BRAIN.md", brainContent({ uuid: null }));
  await assert.rejects(
    () => prepareBrainUpload(directory),
    (error) => error instanceof UploadBrainError && error.code === "BRAIN_UUID_REQUIRED",
  );
});

test("aborts a hanging backend and clears the timer after success", async () => {
  const hanging = tempDir("timeout");
  write(hanging, "BRAIN.md", brainContent());
  const prepared = await prepareBrainUpload(hanging);
  let abortedSignal;
  await assert.rejects(() => uploadPreparedBrain({
    prepared,
    draftStatus: "missing",
    environment: {},
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      abortedSignal = init.signal;
      return new Promise(() => {});
    },
  }), (error) => error instanceof UploadBrainError && error.code === "TIMEOUT");
  assert.equal(abortedSignal.aborted, true);

  const successful = tempDir("timer-cleanup");
  write(successful, "BRAIN.md", brainContent());
  const successPrepared = await prepareBrainUpload(successful);
  let successSignal;
  await uploadPreparedBrain({
    prepared: successPrepared,
    draftStatus: "missing",
    environment: {},
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      successSignal = init.signal;
      return createdResponse(1);
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(successSignal.aborted, false);
  assert.equal(DEFAULT_UPLOAD_TIMEOUT_MS, 120_000);
});

test("loopback auth validates production CORS, PNA, strict fields, and keeps only the upload code in memory", async () => {
  let authorizationUrl;
  const stderr = { text: "", write(value) { this.text += value; } };
  const auth = requestUploadAuthorization({
    uuid: UUID_ONE,
    timeoutMs: 2_000,
    stderr,
    openBrowserImpl: async (value) => {
      authorizationUrl = new URL(value);
      const callback = authorizationUrl.searchParams.get("callback");
      const state = authorizationUrl.searchParams.get("state");
      queueMicrotask(async () => {
        const preflight = await fetch(callback, {
          method: "OPTIONS",
          headers: {
            Origin: PUBLIC_SITE_URL,
            "Access-Control-Request-Private-Network": "true",
          },
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get("access-control-allow-origin"), PUBLIC_SITE_URL);
        assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
        const denied = await fetch(callback, {
          method: "POST",
          headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
          body: JSON.stringify({ state, uploadCode: UPLOAD_CODE }),
        });
        assert.equal(denied.status, 403);
        const rawCredential = await fetch(callback, {
          method: "POST",
          headers: { Origin: PUBLIC_SITE_URL, "Content-Type": "application/json" },
          body: JSON.stringify({ state, idToken: RAW_ID_TOKEN }),
        });
        assert.equal(rawCredential.status, 400);
        const extraBrainId = await fetch(callback, {
          method: "POST",
          headers: { Origin: PUBLIC_SITE_URL, "Content-Type": "application/json" },
          body: JSON.stringify({ state, brainId: UUID_ONE, uploadCode: UPLOAD_CODE }),
        });
        assert.equal(extraBrainId.status, 400);
        const accepted = await fetch(callback, {
          method: "POST",
          headers: { Origin: PUBLIC_SITE_URL, "Content-Type": "application/json" },
          body: JSON.stringify({ state, uploadCode: UPLOAD_CODE, expiresAt: "2026-08-26T00:00:00.000Z" }),
        });
        assert.equal(accepted.status, 204);
        assert.equal(accepted.headers.get("access-control-allow-private-network"), "true");
      });
      return true;
    },
  });

  assert.equal(await auth, UPLOAD_CODE);
  assert.equal(authorizationUrl.origin, PUBLIC_SITE_URL);
  assert.equal(authorizationUrl.pathname, "/upload-authorize");
  assert.equal(authorizationUrl.searchParams.get("brainId"), UUID_ONE);
  assert.equal(stderr.text, "");
  assert.doesNotMatch(authorizationUrl.toString(), new RegExp(UPLOAD_CODE, "u"));
});

test("browser-open failure prints only the authorization URL and keeps waiting", async () => {
  const stderr = { text: "", write(value) { this.text += value; } };
  let openedUrl;
  const uploadAuthorization = await requestUploadAuthorization({
    uuid: UUID_ONE,
    timeoutMs: 2_000,
    stderr,
    openBrowserImpl: async (value) => {
      openedUrl = new URL(value);
      const callback = openedUrl.searchParams.get("callback");
      const state = openedUrl.searchParams.get("state");
      queueMicrotask(async () => {
        await fetch(callback, {
          method: "POST",
          headers: { Origin: PUBLIC_SITE_URL, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ state, uploadCode: UPLOAD_CODE }),
        });
      });
      return false;
    },
  });
  assert.equal(uploadAuthorization, UPLOAD_CODE);
  assert.match(stderr.text, /https:\/\/www\.askreal\.me\/upload-authorize/u);
  assert.doesNotMatch(stderr.text, new RegExp(UPLOAD_CODE, "u"));
});

test("loopback auth has a finite timeout", async () => {
  await assert.rejects(() => requestUploadAuthorization({
    uuid: UUID_ONE,
    timeoutMs: 10,
    openBrowserImpl: async () => true,
  }), (error) => error instanceof UploadBrainError && error.code === "AUTH_TIMEOUT");
  assert.equal(AUTH_HANDOFF_TIMEOUT_MS, 300_000);
});

test("Windows browser opening uses rundll32 argv without a command shell", async () => {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
  const url = "https://www.askreal.me/upload-authorize?brainId=x&state=y";
  assert.equal(await openAuthorizationUrl(url, { platform: "win32", spawnImpl }), true);
  assert.deepEqual(calls, [{
    command: "rundll32.exe",
    args: ["url.dll,FileProtocolHandler", url],
    options: { detached: true, stdio: "ignore" },
  }]);
});
