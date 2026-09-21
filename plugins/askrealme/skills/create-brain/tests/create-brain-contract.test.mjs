import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillUrl = new URL("../SKILL.md", import.meta.url);
const outputContractUrl = new URL("../references/output-contract.md", import.meta.url);
const pluginUrl = new URL("../../../.claude-plugin/plugin.json", import.meta.url);
const marketplaceUrl = new URL("../../../../../.claude-plugin/marketplace.json", import.meta.url);
const repositoryReadmeUrl = new URL("../../../../../README.md", import.meta.url);

test("identity and brain scope are confirmed before retrieval", async () => {
  const skill = await readFile(skillUrl, "utf8");

  const identityGate = skill.indexOf("**the person this brain represents**");
  const scopeGate = skill.indexOf("**brain scope**");
  const sourceDiscovery = skill.indexOf("## 1. Retrieve");

  assert.ok(identityGate >= 0, "missing identity gate");
  assert.ok(scopeGate > identityGate, "scope gate must follow identity gate");
  assert.ok(sourceDiscovery > scopeGate, "scope gate must precede retrieval");
  assert.match(skill, /native custom-answer route is the third choice/);
  assert.match(skill, /wait for the user's answer before ending the turn/);
  assert.match(skill, /displayed default, timeout,\s*\n?cancellation, or empty result is not an answer/);
  assert.match(skill, /narrower than the person above/);
  assert.match(skill, /naming one thing it handles and one thing it does\s*\n?not/);
});


test("all blocking owner decisions use AskUserQuestion", async () => {
  const skill = await readFile(skillUrl, "utf8");

  // The folder name is derived from the brain name here, not asked for — the
  // dashboard already named the brain. Only genuine decisions are questions.
  assert.match(skill, /Derive the \*\*folder name\*\* for the local workspace from the brain name/);
  assert.match(skill, /Treat a missing directory as an empty set|a missing directory is an empty set/);
  assert.match(skill, /do not open any existing\s*\n?brain/);
  assert.match(skill, /to choose\s*\n?Update it, Use a different name, or Cancel/);
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
});

test("all workers use provider-specific low-cost models without expensive fallback", async () => {
  const skill = await readFile(skillUrl, "utf8");
  assert.match(skill, /\*\*Never ask the owner which model to use\.\*\*/);
  assert.match(skill, /Set the Agent `model` parameter explicitly at every\s+spawn/);
  for (const model of ["haiku", "gpt-5.6-luna", "grok-build-0.1", "gemini-2.5-flash-lite", "kimi-for-coding"]) {
    assert.ok(skill.includes("`" + model + "`"), `missing mapping: ${model}`);
  }
  assert.match(skill, /`reasoning_effort: medium` on every spawn/);
  assert.match(skill, /including retries and nested delegation/);
  assert.match(skill, /not the provider of the conversation being read/);
  assert.match(skill, /Cheapest available model that supports the worker's required tools and context/);
  assert.match(skill, /never `fork_turns: "all"`/);
  assert.match(skill, /Never fall back to the\s+parent model, session default, or a more expensive model/);
  assert.match(skill, /[Ff]ailed content\s+inspection blocks submission/);
  assert.doesNotMatch(skill, /on the session\s+default model|fall back to the session default|parameter set to `haiku`/);
  assert.match(skill, /content inspection as one background\s+Agent worker using the \[low-cost worker mapping\]/);
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


test("Automatic requires an explicit informed choice before retrieval", async () => {
  const skill = await readFile(skillUrl, "utf8");
  assert.ok(skill.indexOf("using [Build mode]") < skill.indexOf("## 1. Retrieve"));
  assert.match(skill, /host's equivalent\s+structured question tool/);
  assert.match(skill, /empty result does not select Automatic/);
  assert.match(skill, /header:   Build mode/);
  assert.match(skill, /Automatic \(Recommended\).*build, check, and upload this brain/);
  assert.doesNotMatch(skill, /automatic workflow is not available yet/);
});


test("Automatic resolves optional prompts and hands validated output to the existing submit flow", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const submit = await readFile(new URL("../../submit-brain/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /Refresh it only when its `brain_id`\s+matches the command-line brain-id/);
  assert.match(skill, /missing or unreadable identity is not a match/);
  assert.match(skill, /failed\s+inspection blocks submission in both modes/);
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
  assert.doesNotMatch(skill, /start\s+all workers immediately|If any required worker cannot be created, stop/);
});


test("retrieval remains undefined while compilation keeps the retained evidence boundary", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const contract = await readFile(new URL("../references/compilation-contract.md", import.meta.url), "utf8");
  assert.match(skill, /Retrieve → Compile → Validate/);
  assert.match(skill, /Retrieval is not implemented in this branch/);
  assert.match(skill, /Do not start a new brain build/);
  assert.match(skill, /## 2\. Compile/);
  assert.match(skill, /## 3\. Validate/);
  assert.doesNotMatch(skill, /## 1\. Discover|## 2\. Add owner-supplied originals|normalize every approved source exactly once/);
  assert.doesNotMatch(contract, /Workers must not rank, score|Partition conversations from the selected directories/);
  assert.match(contract, /never copy the\s+native session/);
  assert.match(contract, /Do not reopen upstream originals/);
});
