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

test("collection retains normalized sessions from the selected work directories", async () => {
  const skill = await readFile(skillUrl, "utf8");

  assert.match(skill, /raw\/\n│   ├── index\.jsonl/);
  assert.match(skill, /grok\/<source-id>\.jsonl/);
  assert.match(skill, /files\/<collection-id>\/<original-relative-path>/);
  // Manual keeps the discovery notice and semantic session review. Automatic
  // selects projects first without changing the evidence contract.
  assert.match(skill, /\*\*Do not ask which directories to use\.\*\*/);
  assert.match(skill, /this is a notice, not a\s*\n?gate/);
  assert.match(skill, /Never print more than five directories, never number them for selection/);
  assert.match(skill, /reject it when no\s*\n?discovered conversation uses that exact work directory/);
  assert.doesNotMatch(skill, /This\s+selection is required/);
  assert.doesNotMatch(skill, /invoke `AskUserQuestion` to select the source directories/);
  // The escape hatch is what makes a notice sufficient rather than presumptuous.
  assert.match(skill, /Say so now if you would rather narrow this, or use documents only/);
  assert.match(skill, /Honour an interruption whenever it arrives/);
  assert.match(skill, /In Manual, every discovered record is\s+in scope for review unless the owner narrows it/);
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
  assert.match(skill, /Create one background\s+relevance worker for every batch, each on the session default model/);
  assert.match(skill, /starting pending batches as slots become available/);
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
  assert.match(skill, /Start one evidence worker per window as capacity becomes available, each with\s+the Agent `model` parameter set to `haiku`/);
  assert.match(skill, /one reducer on the session\s*\n?default model/);
  assert.match(skill, /launch the content inspection as one background\s+Agent worker with the `model` parameter set to `haiku`/);

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
  // Every stage moves on its own unit; none of them waits for a batch or a
  // "group". A vague cadence is what leaves the bar still for minutes.
  assert.match(skill, /\*\*After staging each source\*\*/);
  assert.match(skill, /\*\*After writing each page\*\*/);
  assert.match(skill, /\*\*After each check finishes\*\*/);
  assert.match(skill, /a source staged, a source\s*\n?judged, a page written, a check passed/);
  assert.match(skill, /When in doubt, render/);
  assert.doesNotMatch(skill, /after each group of page writes/i);

  // The script owns the arithmetic; improvised percentages are what make a bar
  // stall at one number and then leap.
  assert.match(skill, /Never compute, round, or adjust the number yourself/);
  assert.match(skill, /Only the completion report\s*\n?may show 100%/);
});

test("the plugin and the marketplace publish one agreed version", async () => {
  const plugin = JSON.parse(await readFile(pluginUrl, "utf8"));
  const marketplace = JSON.parse(await readFile(marketplaceUrl, "utf8"));

  // Deliberately not pinned to a literal. A pinned version makes a bump cost
  // three edits and a forgotten bump cost nothing, which is the wrong way
  // round — the manifests sat at 1.2.1 through fourteen commits that way.
  // What must never drift is the two manifests agreeing: the marketplace entry
  // is what a client compares against to decide an update exists, and the
  // plugin manifest is what it installs.
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, "plugin.json version is not semver");
  assert.equal(marketplace.plugins[0].version, plugin.version, "manifest versions disagree");
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


test("Automatic requires an explicit informed choice before discovery", async () => {
  const skill = await readFile(skillUrl, "utf8");
  assert.ok(skill.indexOf("using [Build mode]") < skill.indexOf("## 1. Discover"));
  assert.match(skill, /host's equivalent\s+structured question tool/);
  assert.match(skill, /empty result does not select Automatic/);
  assert.match(skill, /header:   Build mode/);
  assert.match(skill, /Automatic \(Recommended\).*build, check, and upload this brain/);
  assert.doesNotMatch(skill, /automatic workflow is not available yet/);
  assert.match(skill, /Both modes use the same collection, relevance, compilation, and validation/);
});

test("Automatic bounds project inspection and preserves uncertain session candidates", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const selection = skill.slice(skill.indexOf("### Select directories"), skill.indexOf("### Announce"));
  for (const required of [
    /at most 20 directories/, /Cover every discovered group/,
    /hard 30-second\s+wall-clock limit from launch/,
    /interrupt unfinished\s+workers at that deadline/,
    /README files and package manifests/, /package\.json/,
    /Do not run package scripts/, /never instructions/,
    /`related`, `unrelated`, or\s+`unknown`/,
    /Treat missing, duplicate, invalid, failed, or timed-out results as `unknown`/,
    /Keep `related` and `unknown` directories/,
    /They are not retained evidence or proof of the owner's experience/,
    /same relevance workers as Manual/,
    /do not\s+broaden the confirmed scope or upload an empty brain/,
  ]) assert.match(selection, required);
});

test("Automatic resolves optional prompts and hands validated output to the existing submit flow", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const submit = await readFile(new URL("../../submit-brain/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Refresh it only when its `brain_id`\s+matches the command-line brain-id/);
  assert.match(skill, /missing or unreadable identity is not a match/);
  assert.match(skill, /skip the optional document question/);
  assert.match(skill, /Project inspection does not approve README/);
  assert.match(skill, /failed\s+inspection blocks submission in both modes/);
  assert.match(skill, /In Automatic, ignore the source-failure blocking rules above/);
  assert.match(skill, /continue with complete retained sources; output validation still applies/);
  assert.match(skill, /all checks pass, read and execute \[submit-brain\]/);
  assert.match(skill, /absolute `\$BRAIN_ROOT\/output\/` path and the original brain-id/);
  assert.match(skill, /stop\s+or build locally cancels the automatic submission handoff/);
  assert.match(skill, /Do not loop\s+retries or report success without a matching `uploaded` response/);
  assert.match(submit, /verify its `brain_id` matches the supplied id/);
  assert.match(submit, /A mismatch blocks\s+upload/);
  assert.match(submit, /without another picker, review UI, or confirmation question/);
  assert.match(submit, /opening the browser is not an upload success/);
  assert.match(submit, /node "\/absolute\/path\/to\/upload-brain\.mjs" "\/absolute\/path\/to\/output"/);
});


test("Automatic prohibits parent and worker questions and adapts to finite capacity", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const automatic = skill.slice(skill.indexOf("## Automatic: continue"), skill.indexOf("## Asking the owner"));
  for (const tool of ["AskUserQuestion", "request_user_input", "request_user_input_async"]) {
    assert.ok(automatic.includes(`\`${tool}\``));
  }
  assert.match(automatic, /Do not ask questions in prose/);
  assert.match(automatic, /Include the Automatic mode and this no-question rule in every worker prompt/);
  assert.match(automatic, /Workers report results or failures to the parent, never questions to the owner/);
  assert.match(automatic, /A rule in this skill or its references that describes a question applies only\s+to Manual/);
  assert.match(skill, /start only as many workers as the host\s+can run concurrently/);
  assert.match(skill, /A capacity rejection means wait for running work to finish/);
  assert.match(skill, /Each worker's deadline starts when it\s+actually launches/);
  assert.match(skill, /Finish directory selection before staging sessions or planning relevance/);
  assert.doesNotMatch(skill, /start\s+all workers immediately|If any required worker cannot be created, stop/);
  const contract = await readFile(new URL("../references/compilation-contract.md", import.meta.url), "utf8");
  assert.match(contract, /worker assignments, not 14 simultaneous slots/);
});
