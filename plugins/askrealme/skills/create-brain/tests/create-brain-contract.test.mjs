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

  const identityGate = skill.indexOf("If the represented person is missing");
  const scopeGate = skill.indexOf("If the brain scope is missing");
  const sourceDiscovery = skill.indexOf("## 1. Discover and choose source directories");

  assert.ok(identityGate >= 0, "missing identity gate");
  assert.ok(scopeGate > identityGate, "scope gate must follow identity gate");
  assert.ok(sourceDiscovery > scopeGate, "scope gate must precede discovery");
  assert.match(skill, /Treat any non-empty text after the skill command as the represented person/);
  assert.match(skill, /do not reinterpret it as a folder name/);
  assert.match(skill, /never treat it as the brain scope/);
  assert.match(skill, /Use `AskUserQuestion` for every missing or blocking owner decision/);
  assert.match(skill, /provide exactly two concise,\s+contextual examples/);
  assert.match(skill, /native custom-answer route is the third choice/);
  assert.match(skill, /then end the\s+turn/);
  assert.match(skill, /Do not inspect\s+conversation stores/);
  assert.match(skill, /displayed default, timeout, cancellation, or\s+empty result is not an answer/);
  assert.match(skill, /ask what work or experience the brain\s+should cover and what it should leave out/);
  assert.match(skill, /make each example narrower than the represented person/);
  assert.match(skill, /naming both a concrete included area and an excluded area/);
  assert.match(skill, /The explicit selection or\s+custom answer is the confirmed brain scope/);
  assert.match(skill, /Do not add target-question lists,\s+scores, source budgets, clustering, or another scope artifact/);
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
  assert.match(skill, /never copies the native session/);
  assert.match(skill, /normalize every approved source exactly once/);
  assert.match(skill, /worker reads only its assigned staged normalized JSONL/);
  assert.match(skill, /must not invoke `read` on the upstream source/);
  assert.match(skill, /--normalized-output/);
  assert.doesNotMatch(skill, /byte-for-byte originals/);
  assert.doesNotMatch(skill, /│   ├── _digest|│   └── cards\.md/);
  assert.match(skill, /list native\s+conversation originals from every locally supported self-contained store\s+without copying them/);
  assert.match(skill, /Do not reread the upstream source,\s+reread retained raw for source creation/);
  assert.match(skill, /create a digest file, or create an\s+intermediate card/);
  assert.match(skill, /at most 20 sources and at most\s+1,572,864 normalized bytes \(1\.5 MiB\)/);
  assert.match(skill, /Use greedy size-balanced\s+packing/);
  assert.match(skill, /single staged session larger than 1\.5 MiB forms an\s+oversized batch by itself/);
  assert.match(skill, /use it only to balance work, never to decide relevance or exclude a\s+source/);
  assert.match(skill, /Create one background\s+relevance worker for every batch and start all workers immediately/);
  assert.match(skill, /instead of falling back to a larger or sequential\s+worker/);
  assert.match(skill, /Give each worker the confirmed brain scope/);
  assert.match(skill, /Treat a source as relevant only when it is inside the confirmed brain scope/);
  assert.match(skill, /Each worker owns its batch through retention/);
  assert.match(skill, /Before writing, the worker validates exact ID coverage/);
  assert.match(skill, /When it is relevant, run `retain` with the staged JSONL/);
  assert.match(skill, /these\s+writes remain parallel and never collide/);
  assert.match(skill, /Workers must not wait for the parent, finish the complete batch, or wait for\s+other batches/);
  assert.match(skill, /cross-process\s+lock/);
  assert.match(skill, /workers may retain\s+concurrently without losing index records/);
  assert.match(skill, /`retain` is idempotent by source ID/);
  assert.match(skill, /does not parse or reopen the upstream session/);
  assert.match(skill, /Do not call `read --raw` to create the\s+source page/);
  assert.match(skill, /write exactly one\s+final `output\/sources\/<source-id>\.md` page/);
  assert.match(skill, /Grouping multiple conversations into one source page fails\s+accounting/);
  assert.match(skill, /Give each worker the output and writing contracts exactly once/);
  assert.match(skill, /discard its standard output/);
  assert.match(skill, /hard ten-minute wall-clock limit/);
  assert.match(skill, /interrupts an unfinished worker at ten minutes/);
  assert.match(skill, /retry those IDs once/);
  assert.match(skill, /split-normalized/);
  assert.match(skill, /contiguous event windows/);
  assert.match(skill, /one evidence worker per window/);
  assert.match(skill, /makes exactly one `relevant` or `irrelevant` decision/);
  assert.match(skill, /retains the original\s+unsplit staged JSONL/);
  assert.match(skill, /Window files are temporary processing\s+units, never raw records or source pages/);
  assert.match(skill, /Workers never delete staged files or window files/);
  assert.match(skill, /cleanup-staged/);
  assert.match(skill, /deterministic command at most 60 seconds/);
  assert.match(skill, /normalized events still visible in the worker context/);
  assert.match(skill, /Each worker writes only source pages for\s+its exclusively assigned IDs/);
  assert.match(skill, /The parent does not reread\s+sessions, rejudge relevance, perform retain operations, or create conversation\s+source pages/);
  assert.match(skill, /the parent checks only\s+final accounting/);
  assert.match(skill, /both one retained normalized record and exactly one matching source page/);
  assert.match(skill, /Do\s+not begin compilation until\s+this accounting passes and all owner-supplied document choices are complete/);
  assert.match(skill, /Synthesize the brain from retained raw and final source pages/);
  assert.match(skill, /read its normalized record through `read --raw` together with its matching final\s+page/);
  assert.match(skill, /keyword frequency, native or normalized\s+file size, path\s+names, and corpus-wide statistics cannot replace semantic\s+review/);
  assert.match(skill, /Before discovery or any other write, verify a non-empty existing `raw\/`/);
  assert.match(skill, /Never mix legacy native-session copies/);
  assert.doesNotMatch(skill, /total discovered `bytes`|source larger than the byte limit/);
  assert.doesNotMatch(skill, /Use parallel calls when the host supports them/);
  assert.doesNotMatch(skill, /collect_raw\.py" status/);
  assert.doesNotMatch(skill, /collect_raw\.py" prepare/);
});

test("all blocking owner decisions use AskUserQuestion", async () => {
  const skill = await readFile(skillUrl, "utf8");

  assert.match(skill, /\*\*folder name\*\*: a required name/);
  assert.match(skill, /before proposing or accepting a\s+folder name, inspect only the direct child directory names under\s+`~\/ask-brain\/`/);
  assert.match(skill, /Treat a missing `~\/ask-brain\/` directory as an empty set/);
  assert.match(skill, /Do not\s+open any existing brain or inspect its contents during this name check/);
  assert.match(skill, /Exclude every existing\s+direct child directory name from both examples/);
  assert.match(skill, /compare the normalized result with the\s+existing names/);
  assert.match(skill, /If it matches an existing\s+name, do not treat it as a new brain/);
  assert.match(skill, /If the brain scope is missing after the represented person and folder name are\s+confirmed/);
  assert.match(skill, /Never silently select an\s+example/);
  assert.match(skill, /use\s+`AskUserQuestion` to choose Refresh/);
  assert.match(skill, /repeat the direct-child\s+name check before accepting the replacement/);
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
