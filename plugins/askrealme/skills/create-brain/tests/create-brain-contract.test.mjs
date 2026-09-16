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

  assert.ok(identityGate >= 0, "missing identity gate");
  assert.ok(scopeGate > identityGate, "scope gate must follow identity gate");
  assert.ok(sourceDiscovery > scopeGate, "scope gate must precede discovery");
  assert.match(skill, /native custom-answer route is the third choice/);
  assert.match(skill, /then end the\s+turn/);
  assert.match(skill, /displayed default, timeout,\s*\n?cancellation, or empty result is not an answer/);
  assert.match(skill, /narrower than the person above/);
  assert.match(skill, /naming one thing it handles and one thing it does\s*\n?not/);
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
  assert.match(skill, /one short sentence\s*\n?referring to the already displayed row numbers/);
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

  // The folder name is derived from the brain name here, not asked for — the
  // dashboard already named the brain. Only genuine decisions are questions.
  assert.match(skill, /Derive the \*\*folder name\*\* for the local workspace from the brain name/);
  assert.match(skill, /Treat a missing directory as an empty set|a missing directory is an empty set/);
  assert.match(skill, /do not open any existing\s*\n?brain/);
  assert.match(skill, /to choose\s*\n?Update it, Use a different name, or Cancel/);
  assert.match(skill, /invoke `AskUserQuestion` to select the source directories/);
  assert.match(skill, /to choose Add these, I'll\s*\n?give paths, or Skip/);
});

test("every owner question ships with its literal wording", async () => {
  const skill = await readFile(skillUrl, "utf8");

  // Improvised phrasing is what produced "Before I discover any source, I need
  // to know who this brain represents". Each gate pins question and header.
  assert.match(skill, /## Asking the owner/);
  for (const [header, question] of [
    ["Whose voice", "When someone asks this brain a question, who are they hearing from?"],
    ["What it covers", "What should this brain be good at — and what should it stay out of?"],
    ["Which projects", "Which of these should it learn from? Use the numbers above."],
    ["Written notes", "Any write-ups to add? Retros, decision records, design notes."],
    ["Existing brain", "You already have a brain here. Update it, or start a separate one?"],
  ]) {
    assert.ok(skill.includes(`header:   ${header}`), `missing header: ${header}`);
    assert.ok(skill.includes(`question: ${question}`), `missing question: ${question}`);
  }

  // The voice question must not drift into asking who the audience is: taking
  // the audience as the voice makes the brain answer as the wrong person.
  assert.match(skill, /This asks who the brain \*\*answers as\*\* — never who will be asking it/);

  // Vocabulary the owner would not use in conversation stays out of the UI.
  for (const banned of ["persona", "slug", "corpus", "normalize", "artifact"]) {
    assert.ok(skill.includes(banned), `banned-word list must still name ${banned}`);
  }
  assert.match(skill, /Never narrate what you are about to do/);

  // A waiting question must be impossible to mistake for build output.
  assert.match(skill, /YOUR INPUT NEEDED/);
  assert.match(skill, /Announce every question in the normal response, immediately before you invoke\s*\n?the tool/);
  // A thin rule reads as build output. The banner needs weight: full-width
  // heavy rules with blank lines inside them, and the question restated so the
  // banner alone says what is wanted.
  assert.ok(skill.includes("\u2501".repeat(60)), "banner rules must be 60 heavy characters");
  assert.match(skill, /<the question, verbatim>/);
  assert.match(skill, /a blank line sits above the\s*\n?first and below the last/);
});

test("one progress bar spans the whole build", async () => {
  const skill = await readFile(skillUrl, "utf8");

  assert.match(skill, /## Showing progress/);
  assert.match(skill, /runs 0-100% across the whole build/);
  assert.match(skill, /never restarts per stage and\s*\n?never goes backwards/);
  // Every checkpoint the skill must call, so a stage cannot silently stall.
  for (const stage of ["discover", "relevance", "synthesis", "validate", "done"]) {
    assert.ok(skill.includes(`--stage ${stage}`), `missing progress checkpoint: ${stage}`);
  }
  // The script owns the arithmetic; improvised percentages are what make a bar
  // stall at one number and then leap.
  assert.match(skill, /Never compute, round, or adjust the number yourself/);
  assert.match(skill, /Only the completion report\s*\n?may show 100%/);
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
