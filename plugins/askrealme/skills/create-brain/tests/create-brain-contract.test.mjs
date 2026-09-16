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
  const sourceDiscovery = skill.indexOf("## 1. Discover source directories");

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
  // Reading every discovered source is the default: the owner is told, not
  // asked. A guess from a path name cannot beat the relevance workers, which
  // judge each source against scope AFTER reading it, and the consent that
  // matters is at upload, not here.
  assert.match(skill, /\*\*Do not ask which directories to use\.\*\*/);
  assert.match(skill, /this is a notice, not a\s*\n?gate/);
  assert.match(skill, /Never print more than five directories, never number them for selection/);
  assert.match(skill, /reject it when no\s*\n?discovered conversation uses that exact work directory/);
  assert.doesNotMatch(skill, /This\s+selection is required/);
  assert.doesNotMatch(skill, /invoke `AskUserQuestion` to select the source directories/);
  // The escape hatch is what makes a notice sufficient rather than presumptuous.
  assert.match(skill, /Say so now if you would rather narrow this, or use documents only/);
  assert.match(skill, /Honour an interruption whenever it arrives/);
  // Narrowing is now the exception, granted only on an interruption.
  assert.match(skill, /every discovered record is in scope for review/);
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
  assert.match(skill, /Create one background\s+relevance worker for every batch, each on the session default model, and start\s+all workers immediately/);
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
  assert.match(skill, /makes exactly one\s+`relevant` or `irrelevant` decision/);
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
  // A left bar reads as a callout beside flush-left build output and needs no
  // guess about terminal width. Two lines, question restated on the second.
  assert.match(skill, /\u258c \u2753 YOUR INPUT NEEDED\n\u258c <the question, verbatim>/);
  assert.match(skill, /Two lines, a bar on each, with a blank line above and below/);
});

test("worker models are pinned, never asked about", async () => {
  const skill = await readFile(skillUrl, "utf8");

  // With no model named at a spawn, a run improvises — and improvising has
  // included stopping to ask the owner Haiku or Opus, which is not their
  // decision and not one they have any basis to make.
  assert.match(skill, /\*\*Never ask the owner which model to use\.\*\*/);
  assert.match(skill, /Set the Agent `model` parameter explicitly at every\s*\n?spawn/);

  // Every spawn point names one, so none of them can fall back to improvising.
  assert.match(skill, /relevance worker for every batch, each on the session default model/);
  assert.match(skill, /Start one evidence worker per window immediately, each with the Agent `model`\s*\n?parameter set to `haiku`/);
  assert.match(skill, /one reducer on the session\s*\n?default model/);
  assert.match(skill, /launch the content inspection as one background Agent worker with the `model`\s*\n?parameter set to `haiku`/);

  // A rejected model must not become a halt.
  assert.match(skill, /fall back to the session default and carry\s*\n?on/);
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
  // Per-source, not per-batch: a batch of twenty can take ten minutes, and a
  // bar that only moves when a batch lands sits still for all of it.
  assert.match(skill, /collect_raw\.py" judged/);
  assert.match(skill, /Record irrelevant decisions too/);
  assert.match(skill, /--batch-plan "1:20,2:14"/);
  // A countable rule gets followed; "after each group" gets improvised.
  assert.match(skill, /After every fifth page written/);
  assert.match(skill, /"After every fifth page" is a count, not a feeling/);

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
