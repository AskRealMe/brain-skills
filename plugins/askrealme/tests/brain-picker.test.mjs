import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SKILLS = ["submit-brain", "review-brain", "ingest-brain"];
const read = (skill) =>
  readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), "utf8");

test("every brain-consuming skill offers a picker instead of demanding a path", async () => {
  for (const skill of SKILLS) {
    const text = await read(skill);

    assert.match(text, /## Choosing which brain/, `${skill}: no picker section`);
    assert.match(text, /\*\*An absolute path in the request wins\.\*\*/, `${skill}: no explicit-path escape hatch`);

    // One brain is not a choice. Asking anyway is the habit this replaces.
    assert.match(text, /\*\*Exactly one\*\* — use it/, `${skill}: does not auto-select a lone brain`);
    assert.match(text, /a question with one answer is a keystroke\s*\n?charged for nothing/, `${skill}: missing the reason`);

    // Several brains get one question, with wording pinned like every other.
    assert.ok(text.includes("header:   Which brain"), `${skill}: no pinned header`);
    assert.ok(text.includes("question: Which brain is this for?"), `${skill}: no pinned question`);

    // The title is what a person recognises, but nothing stops two brains
    // sharing one — the folder and an id fragment are what tell them apart.
    assert.match(text, /labelled with its title — the first `# ` heading in/, `${skill}: options not labelled by title`);
    assert.match(text, /the folder name and the first ten\s*\n?\s*characters of `brain_id`/, `${skill}: no id fragment in the option`);
    assert.ok(text.includes('"${id:0:10}"'), `${skill}: listing does not read the id prefix`);

    // The privacy line the picker must not cross.
    assert.match(text, /Always pass `<workspace>\/output\/`, never the workspace root and never `raw\/`/, `${skill}: raw/ not excluded`);

    // The old behaviour must be gone, not merely supplemented.
    assert.doesNotMatch(text, /Accept one absolute path to the `output\/` directory\. Ask for it when missing/, `${skill}: still demands a path`);
  }
});

test("the listing command skips workspaces without a compiled brain", async () => {
  // A half-built workspace has no output/BRAIN.md; offering it would send the
  // skill at a directory with nothing to review, submit or ingest.
  const text = await read("submit-brain");
  assert.match(text, /b="\$d\/output\/BRAIN\.md"; \[ -f "\$b" \] \|\| continue/);
  assert.match(text, /sed -n 's\/\^# \/\/p'/, "title comes from the first heading");
});
