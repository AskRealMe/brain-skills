import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillUrl = new URL("../SKILL.md", import.meta.url);
const outputContractUrl = new URL("../references/output-contract.md", import.meta.url);
const pluginUrl = new URL("../../../.claude-plugin/plugin.json", import.meta.url);
const marketplaceUrl = new URL("../../../../../.claude-plugin/marketplace.json", import.meta.url);
const repositoryReadmeUrl = new URL("../../../../../README.md", import.meta.url);

test("identity and brain scope are confirmed before discovery", async () => {
  const skill = await readFile(skillUrl, "utf8");

  const identityGate = skill.indexOf("**the person this brain represents**");
  const scopeGate = skill.indexOf("**brain scope**");
  const sourceDiscovery = skill.indexOf("## 1. Discover and choose source directories");
  assert.ok(identityGate >= 0);
  assert.ok(scopeGate > identityGate);
  assert.ok(sourceDiscovery > scopeGate);
  assert.match(skill, /If the brain-id is missing/);
  assert.match(skill, /create no files, inspect no sources, run no command/);
  assert.match(skill, /displayed default, timeout,\s+cancellation, or empty result is not an answer/);

});

test("collection retains normalized sessions and requires approved work directories", async () => {
  const skill = await readFile(skillUrl, "utf8");

  assert.match(skill, /raw\/\n│   ├── index\.jsonl/);
  assert.match(skill, /grok\/<source-id>\.jsonl/);
  assert.match(skill, /files\/<collection-id>\/<original-relative-path>/);
  assert.match(skill, /show only the first 20 rows as\s+one Markdown table/);
  assert.match(skill, /Never\s+print rows after number 20/);
  assert.match(skill, /number, session count, sources, and\s+directory/);
  assert.match(skill, /Render this table in the normal assistant response before invoking\s+`AskUserQuestion`/);
  assert.match(skill, /the table must remain visible outside the question UI/);
  assert.match(skill, /Never\s+place the table, table rows, or the full directory list inside the\s+`AskUserQuestion`/);
  assert.match(skill, /Only after the normal response has finished rendering the table/);
  assert.match(skill, /Keep\s+the question itself to one short sentence that refers to the already displayed\s+row numbers/);
  assert.match(skill, /enter an absolute\s+directory path when\s+the directory they want is not shown/);
  assert.match(skill, /invoke `AskUserQuestion` to select the source directories/);
  assert.match(skill, /one or more displayed table numbers or\s+absolute directory paths/);
  assert.match(skill, /reject it when no discovered conversation uses that\s+exact work directory/);
  assert.match(skill, /This\s+selection is required/);
  assert.match(skill, /Do not read, retain, or use records from any other directory/);
  assert.match(skill, /must not expose, total, compare, or report native original file\s+sizes/);
  assert.match(skill, /Never open an `original_path`\s+directly/);
  assert.match(skill, /The `read`\s+command is the only content gateway/);
  assert.match(skill, /their size is not a reason to exclude a source, stop, or ask the owner to\s+reduce the approved scope/);
  assert.match(skill, /`askrealme-normalized-session-v1`/);
  assert.match(skill, /build_session\.py" prepare/);
  assert.match(skill, /build_session\.py" check --run/);
  assert.match(skill, /references\/relevance-worker\.md/);
  assert.match(skill, /Do not reread every retained/);
  assert.match(skill, /Before discovery or any other write, verify a non-empty existing `raw\/`/);
  assert.match(skill, /Never mix legacy native-session copies/);

});

test("all blocking owner decisions use AskUserQuestion", async () => {
  const skill = await readFile(skillUrl, "utf8");

  assert.match(skill, /using `AskUserQuestion`/);
  assert.match(skill, /inspect only the direct child directory names/i);
  assert.match(skill, /never reuse another brain's folder/);
  assert.match(skill, /use\s+`AskUserQuestion` to choose Refresh/);
  assert.match(skill, /invoke `AskUserQuestion` to select the source directories/);
  assert.match(skill, /Use `AskUserQuestion` to\s+choose Add suggested documents/);

});

test("plugin and marketplace publish version 1.2.1", async () => {
  const plugin = JSON.parse(await readFile(pluginUrl, "utf8"));
  const marketplace = JSON.parse(await readFile(marketplaceUrl, "utf8"));

  assert.equal(plugin.version, "1.2.1");
  assert.equal(marketplace.plugins[0].version, "1.2.1");
});

test("public source pages map to retained indexed originals", async () => {
  const contract = await readFile(outputContractUrl, "utf8");

  assert.match(contract, /maps one-to-one to retained records in `raw\/index\.jsonl`/);
  assert.match(contract, /uses its matching source ID as the file name/);
  assert.match(contract, /do not copy full prompts, local paths, secrets, personal\n+data/);
});

test("repository privacy boundary documents normalized raw conversations", async () => {
  const readme = await readFile(repositoryReadmeUrl, "utf8");

  assert.match(readme, /canonical normalized JSONL/);
  assert.match(readme, /rather\s+than provider-native session bytes/);
  assert.doesNotMatch(readme, /raw\/` retains only relevant byte-for-byte originals/);
});
