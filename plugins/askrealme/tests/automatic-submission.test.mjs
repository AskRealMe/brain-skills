import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PUBLIC_SITE_URL,
  prepareBrainUpload,
  requestUploadAuthorization,
  uploadPreparedBrain,
} from "../lib/upload-brain.mjs";

const brainId = "cmt5cqltx000mw4xrf6rupizj";
const uploadCode = "7Qm3p9Kx2Nw8Za4Bc6De8Fg0Hi2Jk4Lm6No8Pq0Rs2T";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "automatic-submission-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const output = path.join(root, "output");
  await fs.mkdir(output);
  await fs.mkdir(path.join(root, "raw"));
  await fs.writeFile(path.join(root, "raw", "private.jsonl"), "private source");
  await fs.writeFile(path.join(output, "BRAIN.md"),
    `---\nbrain_id: ${brainId}\nversion: 1\n---\n# Test brain\n`);
  return prepareBrainUpload(output);
}

test("automatic handoff uses the existing browser authorization and uploads only output", async (t) => {
  const prepared = await fixture(t);
  let output = "";
  let browserOpened = false;
  const authorization = await requestUploadAuthorization({
    brainId,
    timeoutMs: 2000,
    stderr: { write(text) { output += text; } },
    openBrowserImpl: async (value) => {
      browserOpened = true;
      const url = new URL(value);
      assert.equal(url.origin, PUBLIC_SITE_URL);
      assert.equal(url.pathname, "/upload-authorize");
      assert.equal(url.searchParams.get("brainId"), brainId);
      const callback = url.searchParams.get("callback");
      assert.equal(new URL(callback).hostname, "127.0.0.1");
      const response = await fetch(callback, {
        method: "POST",
        headers: { Origin: PUBLIC_SITE_URL, "Content-Type": "application/json" },
        body: JSON.stringify({ state: url.searchParams.get("state"), uploadCode }),
      });
      assert.equal(response.status, 200);
      return true;
    },
  });
  let calls = 0;
  const result = await uploadPreparedBrain({
    prepared,
    uploadAuthorization: authorization,
    environment: {},
    fetchImpl: async (endpoint, init) => {
      calls += 1;
      assert.equal(browserOpened, true);
      assert.equal(new URL(endpoint).pathname, `/brains/${brainId}/upload`);
      assert.equal(init.method, "PUT");
      assert.equal(init.headers.Authorization, `UploadCode ${uploadCode}`);
      assert.deepEqual([...init.body.keys()], ["name", "slug", "file"]);
      assert.equal(init.body.get("file").name, "brain.zip");
      assert.deepEqual(prepared.files.map((file) => file.relativePath), ["BRAIN.md"]);
      return Response.json({ success: true, mode: "uploaded", brainId, fileCount: 1 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.mode, "uploaded");
  assert.equal(result.brainId, brainId);
  assert.equal(result.fileCount, 1);
  assert.equal(output.includes(uploadCode), false);
});

test("automatic handoff cannot upload without authorization or accept another brain's result", async (t) => {
  const prepared = await fixture(t);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ success: true, mode: "uploaded",
      brainId: "cmt5cqltx000mw4xrf6rupizk", fileCount: 1 });
  };
  await assert.rejects(uploadPreparedBrain({ prepared, fetchImpl, environment: {} }));
  assert.equal(calls, 0);
  await assert.rejects(uploadPreparedBrain({ prepared, fetchImpl, environment: {},
    uploadAuthorization: uploadCode }), { code: "BRAIN_ID_MISMATCH" });
  assert.equal(calls, 1);
});
