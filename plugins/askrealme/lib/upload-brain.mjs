#!/usr/bin/env node

import { constants as FS_CONSTANTS } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

export const DEFAULT_API_URL = "https://askrealmeapi-production.up.railway.app";
export const PUBLIC_SITE_URL = "https://www.askreal.me";
export const MAX_FILES = 10_000;
export const MAX_FILE_BYTES = 10_000_000;
export const MAX_TOTAL_BYTES = 250_000_000;
export const MAX_ARCHIVE_BYTES = 100_000_000;
export const MAX_PATH_DEPTH = 24;
export const MAX_PATH_BYTES = 1_024;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
export const AUTH_HANDOFF_TIMEOUT_MS = 5 * 60 * 1_000;

const SKIP_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const preparedSnapshots = new WeakSet();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE = 0;
const ZIP_DEFLATE = 8;
const ZIP_DOS_DATE = 0x0021;
const AUTH_BODY_LIMIT = 64_000;

export class UploadBrainError extends Error {
  constructor(code, message, { cause, status } = {}) {
    super(message, { cause });
    this.name = "UploadBrainError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function fail(code, message, options) {
  throw new UploadBrainError(code, message, options);
}

function normalizeSlug(value) {
  let slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
  if (!slug) {
    const suffix = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
    slug = `brain-${suffix}`;
  }
  if (slug.length === 2) slug = `${slug}-brain`;
  return slug;
}

function titleFromBrain(content) {
  for (const line of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const match = /^#\s+(.+?)\s*$/u.exec(line);
    if (match) return match[1].trim().slice(0, 80);
  }
  return null;
}

function contentTypeFor(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".md":
    case ".markdown":
      return "text/markdown; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}

function validatedUuid(value, code = "INVALID_RESPONSE") {
  if (typeof value !== "string" || !UUID_RE.test(value)) fail(code, "A valid UUID is required.");
  return value.toLowerCase();
}

function frontmatterMatch(content) {
  const original = content.toString("utf8");
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? original.slice(1) : original;
  if (!body.startsWith("---")) return { bom, body, match: null };
  const match = /^(---\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/mu.exec(body);
  if (!match) fail("INVALID_BRAIN_FRONTMATTER", "BRAIN.md frontmatter is not closed.");
  return { bom, body, match };
}

function uuidFromBrain(content) {
  const { match } = frontmatterMatch(content);
  if (!match) return null;
  const lines = [...match[2].matchAll(/^uuid:([^\r\n]*)$/gmu)];
  if (lines.length > 1) fail("INVALID_BRAIN_FRONTMATTER", "BRAIN.md frontmatter contains more than one UUID.");
  if (lines.length === 0) return null;
  const value = lines[0][1].replace(/[ \t]+#[^\r\n]*$/u, "").trim();
  return validatedUuid(value, "INVALID_BRAIN_FRONTMATTER");
}

function caseFold(value) {
  return value.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function relativePathWithin(root, resolvedPath) {
  const relative = path.relative(root, resolvedPath);
  if (relative === "") return "";
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail("PATH_ESCAPE", `Cannot read a path outside the upload root: ${resolvedPath}`);
  }
  return relative.split(path.sep).join("/");
}

async function assertResolvedPath(root, absolutePath, relativePath) {
  let resolved;
  try {
    resolved = await fs.realpath(absolutePath);
  } catch (error) {
    fail("PATH_CHANGED", `The path changed during collection: ${relativePath || "."}`, { cause: error });
  }
  if (relativePathWithin(root, resolved) !== relativePath) {
    fail("PATH_CHANGED", `The path began pointing to another location during collection: ${relativePath || "."}`);
  }
}

async function assertStableDirectory(root, absolutePath, relativePath, expectedStat) {
  let currentStat;
  try {
    currentStat = await fs.lstat(absolutePath);
  } catch (error) {
    fail("PATH_CHANGED", `The directory changed during collection: ${relativePath || "."}`, { cause: error });
  }
  if (currentStat.isSymbolicLink()) fail("SYMLINK_NOT_ALLOWED", `Symbolic links cannot be uploaded: ${relativePath || "."}`);
  if (!currentStat.isDirectory() || !sameFileIdentity(currentStat, expectedStat)) {
    fail("PATH_CHANGED", `The directory changed during collection: ${relativePath || "."}`);
  }
  await assertResolvedPath(root, absolutePath, relativePath);
}

function validateArchiveRelativePath(relativePath) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || relativePath.includes("\\")
    || relativePath.startsWith("/")
    || /^[A-Za-z]:/u.test(relativePath)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(relativePath)
  ) {
    fail("INVALID_PATH", `Invalid upload path: ${relativePath}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("INVALID_PATH", `Invalid upload path: ${relativePath}`);
  }
  if (segments.length > MAX_PATH_DEPTH) {
    fail("PATH_TOO_DEEP", `Upload paths may have at most ${MAX_PATH_DEPTH} segments: ${relativePath}`);
  }
  if (Buffer.byteLength(relativePath, "utf8") > MAX_PATH_BYTES) {
    fail("PATH_TOO_LONG", `Upload paths may not exceed ${MAX_PATH_BYTES} UTF-8 bytes: ${relativePath}`);
  }
  return segments;
}

/** Reject archive paths that collide after NFC normalization and case folding. */
export function assertUniqueArchivePaths(relativePaths) {
  if (!Array.isArray(relativePaths)) fail("INVALID_PATH", "The upload path list is invalid.");
  const nodes = new Map();
  for (const relativePath of relativePaths) {
    const segments = validateArchiveRelativePath(relativePath);
    for (let index = 0; index < segments.length; index += 1) {
      const original = segments.slice(0, index + 1).join("/");
      const key = segments.slice(0, index + 1).map(caseFold).join("/");
      const type = index === segments.length - 1 ? "file" : "directory";
      const existing = nodes.get(key);
      if (!existing) {
        nodes.set(key, { original, type });
        continue;
      }
      if (existing.original !== original || existing.type !== type || type === "file") {
        fail("PATH_COLLISION", `Paths collide after normalization or case folding: ${existing.original}, ${original}`);
      }
    }
  }
}

async function readRegularFile(root, absolutePath, relativePath, expectedStat) {
  let handle;
  try {
    handle = await fs.open(absolutePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || !sameFileIdentity(stat, expectedStat)) fail("PATH_CHANGED", `The file changed during collection: ${relativePath}`);
    if (stat.size > MAX_FILE_BYTES) {
      fail("FILE_TOO_LARGE", `A file may not exceed ${MAX_FILE_BYTES.toLocaleString("en-US")} bytes: ${relativePath}`);
    }
    let pathStat;
    try {
      pathStat = await fs.lstat(absolutePath);
    } catch (error) {
      fail("PATH_CHANGED", `The file changed during collection: ${relativePath}`, { cause: error });
    }
    if (pathStat.isSymbolicLink()) fail("SYMLINK_NOT_ALLOWED", `Symbolic links cannot be uploaded: ${relativePath}`);
    if (!pathStat.isFile() || !sameFileIdentity(pathStat, stat)) fail("PATH_CHANGED", `The file changed during collection: ${relativePath}`);
    await assertResolvedPath(root, absolutePath, relativePath);
    const content = await handle.readFile();
    const finalStat = await handle.stat();
    if (!sameFileIdentity(finalStat, stat) || finalStat.size !== stat.size) fail("PATH_CHANGED", `The file changed during collection: ${relativePath}`);
    if (content.byteLength > MAX_FILE_BYTES) {
      fail("FILE_TOO_LARGE", `A file may not exceed ${MAX_FILE_BYTES.toLocaleString("en-US")} bytes: ${relativePath}`);
    }
    return content;
  } catch (error) {
    if (error instanceof UploadBrainError) throw error;
    if (error?.code === "ELOOP") fail("SYMLINK_NOT_ALLOWED", `Symbolic links cannot be uploaded: ${relativePath}`);
    fail("READ_FAILED", `Could not read file: ${relativePath}`, { cause: error });
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

async function collectFiles(root, current = root, files = [], totals = { bytes: 0 }, expectedDirectoryStat) {
  const directoryRelativePath = relativePathWithin(root, current);
  let directoryStat = expectedDirectoryStat;
  if (!directoryStat) {
    try {
      directoryStat = await fs.lstat(current);
    } catch (error) {
      fail("PATH_CHANGED", `Could not read the upload directory: ${directoryRelativePath || "."}`, { cause: error });
    }
  }
  await assertStableDirectory(root, current, directoryRelativePath, directoryStat);
  const entries = await fs.readdir(current, { withFileTypes: true });
  await assertStableDirectory(root, current, directoryRelativePath, directoryStat);
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")));
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    validateArchiveRelativePath(relativePath);
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) fail("SYMLINK_NOT_ALLOWED", `Symbolic links cannot be uploaded: ${relativePath}`);
    if (stat.isDirectory()) {
      await assertResolvedPath(root, absolutePath, relativePath);
      await collectFiles(root, absolutePath, files, totals, stat);
      continue;
    }
    if (!stat.isFile()) fail("UNSUPPORTED_FILE", `Only regular files can be uploaded: ${relativePath}`);
    if (files.length >= MAX_FILES) fail("TOO_MANY_FILES", `An upload may contain at most ${MAX_FILES.toLocaleString("en-US")} files.`);
    await assertResolvedPath(root, absolutePath, relativePath);
    const content = await readRegularFile(root, absolutePath, relativePath, stat);
    totals.bytes += content.byteLength;
    if (totals.bytes > MAX_TOTAL_BYTES) {
      fail("UPLOAD_TOO_LARGE", `The uncompressed upload may not exceed ${MAX_TOTAL_BYTES.toLocaleString("en-US")} bytes.`);
    }
    files.push({
      absolutePath,
      relativePath,
      size: content.byteLength,
      contentType: contentTypeFor(relativePath),
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
    });
  }
  await assertStableDirectory(root, current, directoryRelativePath, directoryStat);
  return files;
}

/** Read and validate one upload folder without making a network request. */
export async function prepareBrainUpload(brainDir, { expectedFiles } = {}) {
  if (typeof brainDir !== "string" || !path.isAbsolute(brainDir)) fail("ABSOLUTE_PATH_REQUIRED", "Provide the absolute path to the brain directory.");
  const requestedRoot = path.normalize(brainDir);
  let requestedRootStat;
  let root;
  try {
    requestedRootStat = await fs.lstat(requestedRoot);
    root = await fs.realpath(requestedRoot);
  } catch (error) {
    fail("DIRECTORY_NOT_FOUND", `Could not find the upload directory: ${requestedRoot}`, { cause: error });
  }
  if (requestedRootStat.isSymbolicLink()) fail("SYMLINK_NOT_ALLOWED", "The upload directory cannot be a symbolic link.");
  if (!requestedRootStat.isDirectory()) fail("NOT_A_DIRECTORY", `The upload path is not a directory: ${requestedRoot}`);
  let rootStat;
  try {
    rootStat = await fs.lstat(root);
  } catch (error) {
    fail("DIRECTORY_NOT_FOUND", `Could not find the upload directory: ${root}`, { cause: error });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || !sameFileIdentity(rootStat, requestedRootStat)) {
    fail("PATH_CHANGED", "The resolved upload directory changed before collection.");
  }

  let files;
  try {
    files = await collectFiles(root, root, [], { bytes: 0 }, rootStat);
  } catch (error) {
    if (error instanceof UploadBrainError) throw error;
    fail("READ_FAILED", "Could not read the upload directory.", { cause: error });
  }
  if (files.length === 0) fail("NO_FILES", "The upload directory contains no files.");
  try {
    const finalRequestedRoot = await fs.realpath(requestedRoot);
    if (finalRequestedRoot !== root) fail("PATH_CHANGED", "The upload directory path changed during collection.");
    await assertStableDirectory(root, root, "", rootStat);
  } catch (error) {
    if (error instanceof UploadBrainError) throw error;
    fail("PATH_CHANGED", "The upload directory path changed during collection.", { cause: error });
  }
  assertUniqueArchivePaths(files.map((file) => file.relativePath));
  const brainFile = files.find((file) => file.relativePath === "BRAIN.md");
  if (!brainFile) fail("BRAIN_FILE_REQUIRED", "The upload directory requires a root BRAIN.md file.");
  const uuid = uuidFromBrain(brainFile.content);
  if (!uuid) fail("BRAIN_UUID_REQUIRED", "BRAIN.md requires the UUID created with this brain.");
  const folderName = path.basename(root) === "output" ? path.basename(path.dirname(root)) : path.basename(root);
  const slug = normalizeSlug(folderName);
  const name = titleFromBrain(brainFile.content.toString("utf8")) || slug;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  assertExpectedFilesMatch(files, expectedFiles);
  const prepared = { brainDir: root, name, slug, uuid, fileCount: files.length, totalBytes, files };
  preparedSnapshots.add(prepared);
  return prepared;
}

/** Compare a Buffer snapshot with an exact relative path and SHA-256 list. */
export function assertExpectedFilesMatch(files, expectedFiles) {
  if (expectedFiles === undefined) return;
  if (!Array.isArray(expectedFiles)) fail("INVALID_EXPECTED_FILES", "The expected file list is invalid.");
  const expected = new Map();
  for (const item of expectedFiles) {
    const relativePath = item?.relativePath ?? item?.name;
    const sha256 = item?.sha256 ?? item?.hash;
    if (
      typeof relativePath !== "string"
      || !relativePath
      || typeof sha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(sha256)
      || expected.has(relativePath)
    ) fail("INVALID_EXPECTED_FILES", "The expected file list is invalid.");
    expected.set(relativePath, sha256);
  }
  if (files.length !== expected.size) fail("SNAPSHOT_MISMATCH", "Files were added or removed after review, so the upload was stopped.");
  for (const file of files) {
    if (expected.get(file.relativePath) !== file.sha256) fail("SNAPSHOT_MISMATCH", `A file changed after review, so the upload was stopped: ${file.relativePath}`);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zipLocalHeader({ method, checksum, compressedSize, size, nameBytes }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(ZIP_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function zipCentralHeader({ method, checksum, compressedSize, size, nameBytes, offset }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(ZIP_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

/** Build one deterministic standard ZIP from the prepared Buffer snapshot. */
export function buildBrainZip(prepared) {
  if (!prepared || typeof prepared !== "object" || !preparedSnapshots.has(prepared)) fail("INVALID_PREPARED_UPLOAD", "A snapshot created by prepareBrainUpload is required.");
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;
  const files = [...prepared.files].sort((left, right) => Buffer.compare(Buffer.from(left.relativePath, "utf8"), Buffer.from(right.relativePath, "utf8")));
  for (const file of files) {
    const nameBytes = Buffer.from(file.relativePath, "utf8");
    const deflated = deflateRawSync(file.content, { level: 9 });
    const method = deflated.byteLength < file.content.byteLength ? ZIP_DEFLATE : ZIP_STORE;
    const data = method === ZIP_DEFLATE ? deflated : file.content;
    const checksum = crc32(file.content);
    const localHeader = zipLocalHeader({ method, checksum, compressedSize: data.byteLength, size: file.content.byteLength, nameBytes });
    const centralHeader = zipCentralHeader({ method, checksum, compressedSize: data.byteLength, size: file.content.byteLength, nameBytes, offset: localOffset });
    localParts.push(localHeader, nameBytes, data);
    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.byteLength + nameBytes.byteLength + data.byteLength;
    centralSize += centralHeader.byteLength + nameBytes.byteLength;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  const archiveSize = localOffset + centralSize + end.byteLength;
  if (archiveSize > MAX_ARCHIVE_BYTES) fail("ARCHIVE_TOO_LARGE", `The ZIP may not exceed ${MAX_ARCHIVE_BYTES.toLocaleString("en-US")} bytes.`);
  return Buffer.concat([...localParts, ...centralParts, end], archiveSize);
}

function resolveApiBase(environment = process.env) {
  const override = typeof environment.ASKREAL_API_URL === "string" ? environment.ASKREAL_API_URL.trim() : "";
  if (override && !new Set(["development", "test"]).has(environment.NODE_ENV)) fail("API_OVERRIDE_NOT_ALLOWED", "ASKREAL_API_URL is allowed only when NODE_ENV is development or test.");
  let parsed;
  try {
    parsed = new URL(override || DEFAULT_API_URL);
  } catch (error) {
    fail("INVALID_API_URL", "ASKREAL_API_URL is not a valid URL.", { cause: error });
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail("INVALID_API_URL", "ASKREAL_API_URL must be an HTTP(S) URL without credentials, a query, or a fragment.");
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  return parsed;
}

export function resolveDraftEndpoint(environment = process.env) {
  const parsed = resolveApiBase(environment);
  const basePath = parsed.pathname === "/" ? "" : parsed.pathname;
  parsed.pathname = `${basePath}/drafts`;
  return parsed.toString();
}

export function resolveDraftStatusEndpoint(uuid, environment = process.env) {
  const parsed = new URL(resolveDraftEndpoint(environment));
  parsed.pathname = `${parsed.pathname}/${validatedUuid(uuid, "INVALID_UUID")}`;
  return parsed.toString();
}

export function resolveBrainArchiveEndpoint(uuid, environment = process.env) {
  const normalizedUuid = validatedUuid(uuid, "INVALID_UUID");
  const parsed = resolveApiBase(environment);
  const basePath = parsed.pathname === "/" ? "" : parsed.pathname;
  parsed.pathname = `${basePath}/brains/${normalizedUuid}/archive`;
  return parsed.toString();
}

function confirmLocation(uuid) {
  const normalizedUuid = validatedUuid(uuid);
  const confirmPath = `/brains/${normalizedUuid}/confirm`;
  return { confirmPath, confirmUrl: new URL(confirmPath, PUBLIC_SITE_URL).toString() };
}

function validateUploadCode(uploadCode) {
  if (typeof uploadCode !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(uploadCode)) {
    fail("AUTH_REQUIRED", "Updating an existing brain requires a one-use upload authorization.");
  }
  return uploadCode;
}

function rejectRawCredential(options) {
  if (options && Object.hasOwn(options, "idToken")) {
    fail("RAW_CREDENTIAL_NOT_ALLOWED", "Do not pass a Firebase ID token to upload-brain. Use a one-use upload authorization.");
  }
}

function validateTimeout(timeoutMs, code = "INVALID_TIMEOUT") {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) fail(code, "The timeout must be a positive integer number of milliseconds.");
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("INVALID_RESPONSE", "The upload server returned a non-JSON response.", { cause: error, status: response.status });
  }
}

async function fetchWithTimeout(fetchImpl, endpoint, init, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const error = new UploadBrainError("TIMEOUT", "The AskRealMe backend did not respond before the upload timeout.");
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(endpoint, { ...init, signal: controller.signal });
        return { response, payload: await responsePayload(response) };
      })(),
      timeout,
    ]);
  } catch (error) {
    if (error instanceof UploadBrainError) throw error;
    if (timedOut) fail("TIMEOUT", "The AskRealMe backend did not respond before the upload timeout.", { cause: error });
    fail("NETWORK_ERROR", "Could not connect to the AskRealMe backend.", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export async function getDraftStatus(uuid, {
  fetchImpl = globalThis.fetch,
  environment = process.env,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE", "This Node.js runtime does not provide fetch.");
  validateTimeout(timeoutMs);
  const normalizedUuid = validatedUuid(uuid, "INVALID_UUID");
  const { response, payload } = await fetchWithTimeout(
    fetchImpl,
    resolveDraftStatusEndpoint(normalizedUuid, environment),
    { method: "GET", redirect: "error" },
    timeoutMs,
  );
  const status = payload.status;
  if (!new Set(["missing", "pending", "claimed", "expired"]).has(status)) {
    fail("INVALID_RESPONSE", "The upload server returned an invalid Brain status.", { status: response.status });
  }
  const expectedHttpStatus = status === "missing" ? 404 : status === "expired" ? 410 : 200;
  if (response.status !== expectedHttpStatus) {
    fail("INVALID_RESPONSE", "The upload server returned an inconsistent Brain status.", { status: response.status });
  }
  if (status === "pending" && (typeof payload.expiresAt !== "string" || Number.isNaN(Date.parse(payload.expiresAt)))) {
    fail("INVALID_RESPONSE", "The upload server returned an invalid confirmation deadline.", { status: response.status });
  }
  return { status, ...confirmLocation(normalizedUuid), ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}) };
}

function commonUploadResult(prepared, uuid, mode) {
  return { mode, uuid, name: prepared.name, slug: prepared.slug, fileCount: prepared.fileCount, totalBytes: prepared.totalBytes };
}

async function postPreparedBrain({ prepared, fetchImpl, environment, timeoutMs, uploadAuthorization, draftStatus }) {
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE", "This Node.js runtime does not provide fetch.");
  if (!prepared || typeof prepared !== "object" || !preparedSnapshots.has(prepared)) fail("INVALID_PREPARED_UPLOAD", "A snapshot created by prepareBrainUpload is required.");
  validateTimeout(timeoutMs);
  if (draftStatus !== undefined && !new Set(["missing", "pending", "claimed", "expired"]).has(draftStatus)) {
    fail("INVALID_DRAFT_STATUS", "The supplied Brain status is invalid.");
  }
  const remote = uploadAuthorization
    ? { status: "claimed" }
    : draftStatus
      ? { status: draftStatus, ...confirmLocation(prepared.uuid) }
      : await getDraftStatus(prepared.uuid, { fetchImpl, environment, timeoutMs });
  if (!uploadAuthorization && remote.status === "claimed") {
    fail("AUTH_REQUIRED", "Updating an existing brain requires a one-use upload authorization.");
  }
  if (remote.status === "pending") {
    fail("DRAFT_PENDING", `This brain is already uploaded and waiting for ownership confirmation: ${remote.confirmUrl}`);
  }
  const updating = remote.status === "claimed";
  const uploadCode = updating ? validateUploadCode(uploadAuthorization) : null;
  const archive = buildBrainZip(prepared);
  const form = new FormData();
  form.append("name", prepared.name);
  form.append("slug", prepared.slug);
  form.append("archive", new Blob([archive], { type: "application/zip" }), "brain.zip");
  const endpoint = updating ? resolveBrainArchiveEndpoint(prepared.uuid, environment) : resolveDraftEndpoint(environment);
  const { response, payload } = await fetchWithTimeout(fetchImpl, endpoint, {
    method: updating ? "PUT" : "POST",
    body: form,
    redirect: "error",
    ...(uploadCode ? { headers: { Authorization: `UploadCode ${uploadCode}` } } : {}),
  }, timeoutMs);
  if (!response.ok) {
    const candidate = typeof payload.message === "string" ? payload.message : "";
    const serverMessage = uploadCode && candidate.includes(uploadCode) ? "Upload authorization failed." : candidate || "The upload failed.";
    fail("HTTP_ERROR", serverMessage, { status: response.status });
  }
  if (payload.success !== true || payload.fileCount !== prepared.fileCount) fail("INVALID_RESPONSE", "The upload response does not match the requested files.", { status: response.status });
  const responseUuid = validatedUuid(payload.uuid);

  if (updating) {
    if (payload.mode !== "updated") fail("INVALID_RESPONSE", "The existing-brain upload response has an invalid mode.");
    if (responseUuid !== prepared.uuid) fail("UUID_MISMATCH", "The existing BRAIN.md UUID does not match the server response UUID.");
    if (
      Object.hasOwn(payload, "expiresAt")
      || Object.hasOwn(payload, "confirmPath")
      || Object.hasOwn(payload, "confirmUrl")
      || Object.hasOwn(payload, "signinPath")
      || Object.hasOwn(payload, "signinUrl")
    ) fail("INVALID_RESPONSE", "An existing-brain upload response must not contain confirmation details.");
    return commonUploadResult(prepared, responseUuid, "updated");
  }

  if (payload.mode !== "created" || typeof payload.expiresAt !== "string" || Number.isNaN(Date.parse(payload.expiresAt))) fail("INVALID_RESPONSE", "The new-brain upload response is invalid.", { status: response.status });
  if (responseUuid !== prepared.uuid) fail("UUID_MISMATCH", "BRAIN.md UUID does not match the server response UUID.");
  const expectedConfirm = confirmLocation(responseUuid);
  if (payload.confirmPath !== expectedConfirm.confirmPath) fail("INVALID_RESPONSE", "The upload response confirmPath is invalid.");
  let confirmUrl;
  try {
    confirmUrl = new URL(payload.confirmUrl).toString();
  } catch {
    fail("INVALID_RESPONSE", "The upload response confirmUrl is invalid.");
  }
  if (confirmUrl !== expectedConfirm.confirmUrl) fail("INVALID_RESPONSE", "The upload response confirmUrl is invalid.");
  return { ...commonUploadResult(prepared, responseUuid, "created"), expiresAt: payload.expiresAt, ...expectedConfirm };
}

/** Upload a prepared ZIP snapshot without reading its source directory again. */
export async function uploadPreparedBrain(options = {}) {
  rejectRawCredential(options);
  const { prepared, fetchImpl = globalThis.fetch, environment = process.env, timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS, uploadAuthorization, draftStatus } = options;
  return postPreparedBrain({ prepared, fetchImpl, environment, timeoutMs, uploadAuthorization, draftStatus });
}

/** Prepare and upload a brain directory. Existing UUID uploads require an upload authorization. */
export async function uploadBrain(options = {}) {
  rejectRawCredential(options);
  const { brainDir, expectedFiles, fetchImpl = globalThis.fetch, environment = process.env, timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS, uploadAuthorization, draftStatus } = options;
  const prepared = await prepareBrainUpload(brainDir, { expectedFiles });
  return uploadPreparedBrain({ prepared, fetchImpl, environment, timeoutMs, uploadAuthorization, draftStatus });
}

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function setCors(request, response) {
  response.setHeader("Access-Control-Allow-Origin", PUBLIC_SITE_URL);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
  if (request.method === "POST" || request.headers["access-control-request-private-network"] === "true") {
    response.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function readAuthJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.byteLength;
      if (bytes > AUTH_BODY_LIMIT) {
        reject(new UploadBrainError("AUTH_BODY_TOO_LARGE", "The authorization response is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new UploadBrainError("INVALID_AUTH_RESPONSE", "The authorization response is not valid JSON.", { cause: error }));
      }
    });
    request.on("error", reject);
  });
}

function uploadCodeFromCallback(body, expectedState) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("INVALID_AUTH_RESPONSE", "The upload authorization response is invalid.");
  const keys = Object.keys(body).sort();
  const expectedKeys = Object.hasOwn(body, "expiresAt")
    ? ["expiresAt", "state", "uploadCode"]
    : ["state", "uploadCode"];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    fail("INVALID_AUTH_RESPONSE", "The upload authorization response fields are invalid.");
  }
  if (!secureEqual(body.state, expectedState)) fail("INVALID_AUTH_RESPONSE", "The upload authorization state is invalid.");
  if (Object.hasOwn(body, "expiresAt")) {
    if (typeof body.expiresAt !== "string" || Number.isNaN(Date.parse(body.expiresAt))) {
      fail("INVALID_AUTH_RESPONSE", "The upload authorization expiration time is invalid.");
    }
  }
  return validateUploadCode(body.uploadCode);
}

export async function openAuthorizationUrl(url, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = [url];
  } else if (platform === "win32") {
    command = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

/** Obtain a one-use upload authorization through a short-lived loopback callback. */
export async function requestUploadAuthorization({ uuid, openBrowserImpl = openAuthorizationUrl, timeoutMs = AUTH_HANDOFF_TIMEOUT_MS, stderr = process.stderr } = {}) {
  const normalizedUuid = validatedUuid(uuid, "INVALID_UUID");
  validateTimeout(timeoutMs, "INVALID_AUTH_TIMEOUT");
  const state = randomBytes(32).toString("hex");
  let settle;
  const authorizationPromise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let settled = false;
  const finish = (error, uploadCode) => {
    if (settled) return;
    settled = true;
    if (error) settle.reject(error);
    else settle.resolve(uploadCode);
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.origin !== PUBLIC_SITE_URL) {
      response.writeHead(403).end();
      return;
    }
    setCors(request, response);
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] || "")) {
      response.writeHead(415).end();
      return;
    }
    try {
      const body = await readAuthJson(request);
      const uploadCode = uploadCodeFromCallback(body, state);
      response.writeHead(204).end();
      finish(null, uploadCode);
    } catch {
      response.writeHead(400).end();
    }
  });
  server.on("error", (error) => finish(new UploadBrainError("AUTH_SERVER_FAILED", "Could not start the local authorization server.", { cause: error })));
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const callback = `http://127.0.0.1:${address.port}/callback`;
  const authorizationUrl = new URL("/upload-authorize", PUBLIC_SITE_URL);
  authorizationUrl.searchParams.set("brainId", normalizedUuid);
  authorizationUrl.searchParams.set("callback", callback);
  authorizationUrl.searchParams.set("state", state);
  const timer = setTimeout(() => finish(new UploadBrainError("AUTH_TIMEOUT", "Browser authorization timed out.")), timeoutMs);
  try {
    let opened = false;
    try {
      opened = await openBrowserImpl(authorizationUrl.toString());
    } catch {
      opened = false;
    }
    if (!opened) stderr.write(`The browser did not open. Open this URL to continue: ${authorizationUrl.toString()}\n`);
    return await authorizationPromise;
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

async function runCli() {
  const [brainDir, ...extra] = process.argv.slice(2);
  if (!brainDir || extra.length > 0) fail("USAGE", "Usage: node upload-brain.mjs <absolute-brain-directory>");
  const prepared = await prepareBrainUpload(brainDir);
  const remote = await getDraftStatus(prepared.uuid);
  if (remote.status === "pending") {
    process.stdout.write(`${JSON.stringify({ mode: "pending", uuid: prepared.uuid, ...remote }, null, 2)}\n`);
    return;
  }
  const uploadAuthorization = remote.status === "claimed" ? await requestUploadAuthorization({ uuid: prepared.uuid }) : undefined;
  const result = await uploadPreparedBrain({ prepared, uploadAuthorization, draftStatus: remote.status });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`upload-brain failed: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}
