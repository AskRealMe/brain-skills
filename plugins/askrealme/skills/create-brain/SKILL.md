---
name: create-brain
description: Build a first-person, evidence-grounded AskRealMe brain within an owner-confirmed scope from normalized local AI sessions and owner-supplied project documents. Use when the user wants to turn their work history, decisions, or lived experience into a portable brain or refresh an existing AskRealMe brain. Require the dashboard brain name and brain-id, then confirm the represented person, scope, and build mode before retrieval. Retrieve relevant sessions using an adaptive search, retain normalized evidence, and write matching source pages. Automatic continues without follow-up questions through validation to browser-authorized submission; Manual keeps the local creation workflow. Every subagent uses an explicit provider-specific low-cost model. The shareable result is the output directory; normalized raw evidence stays private.
---

# Create Brain

Build a knowledge base from one person's records that can answer in that
person's first person. The user chooses the person the brain represents and
confirms what the brain covers and leaves out before retrieval. Each useful
answer must pair a reproducible practice with the real incident that produced
it.

The workflow has three stages: Retrieve → Compile → Validate.

Read [the output contract](references/output-contract.md) and
[the writing contract](references/writing-contract.md) before compiling. They
own the shared evidence, writing, page, and validation rules used by both full
creation and incremental ingestion.

## Inputs

`create-brain` is invoked from the AskReal.me dashboard's "Create new brain"
flow as:

```text
/create-brain "{brain name}" {brain-id}
```

Parse the arguments as:

- **brain name**: the quoted text (or all text before the final token) — the
  brain's title, already chosen on the dashboard.
- **brain-id**: the final whitespace-separated token — the DB brain id (a Prisma
  cuid like `cmt5cqltx000mw4xrf6rupizj`) that the dashboard created when the user
  finished naming the brain. **Required.**

If the brain-id is missing, or is not a cuid (`^c[a-z0-9]{20,30}$`), STOP
immediately: create no files, inspect no sources, run no command. Tell the user
in a normal message:

> This can't be processed without a brain-id. Go to
> https://askreal.me/dashboard, choose "Create new brain" to create it and get
> your brain-id, then run `/create-brain "{brain name}" {brain-id}`.

Then end the turn.

The brain-id is the only identifier. Never generate, invent, or substitute one.
Stamp it verbatim into `output/BRAIN.md` as `brain_id:` (see the output
contract); the `submit-brain` skill uploads to exactly that brain.

Still gather the two things the compile needs, using `AskUserQuestion` with the
exact wording in [Asking the owner](#asking-the-owner) (its
native custom-answer route is the third choice; a displayed default, timeout,
cancellation, or empty result is not an answer — ask again and wait). If the
host cannot collect an explicit required answer, stop rather than substituting
a default:

- **the person this brain represents** — who it answers as. If it is not already
  clear from the conversation, ask with exactly two concise contextual examples,
  then wait for the user's answer before ending the turn.
- **brain scope** — what it covers and leaves out. Ask once with exactly two
  contextual examples, each narrower than the represented person, naming a
  concrete included area and an excluded area.

After confirming brain scope, invoke `AskUserQuestion` (or the host's equivalent
structured question tool) using [Build mode](#build-mode). If a question tool
is available, do not present this choice only as plain text. Wait for an explicit answer; a displayed default,
timeout, cancellation, or empty result does not select Automatic.

Both modes use the same retrieval, compilation, and validation
steps below. Automatic resolves optional
prompts without asking again, then calls `submit-brain` for this output. The
Automatic option explicitly includes submission; selecting it authorizes that
handoff for the supplied brain-id. Browser sign-in and authorization still
belong to the owner. Do not ask for a second upload confirmation, open an
interactive review workspace, or wait for another command after validation.

Derive the **folder name** for the local workspace from the brain name
(lowercase kebab-case). Inspect only the direct child directory names under
`~/ask-brain/` (a missing directory is an empty set; at this initial name check,
do not open any existing brain). Resolve collisions under [Workspace](#workspace)
before writing. Never reuse another brain's folder. A re-run with the same
brain-id refreshes that brain (preserve `raw/`, keep the same `brain_id`,
increment `version`).

## Automatic: continue without questions

After the owner explicitly selects Automatic, do not call `AskUserQuestion`,
`request_user_input`, `request_user_input_async`, or any equivalent question or
approval tool. Do not ask questions in prose, offer choices, request permission
for an implementation decision, or end a turn asking whether to continue.
This rule applies to the parent, every subagent, and the submission handoff.
Include the Automatic mode and this no-question rule in every worker prompt.
Workers report results or failures to the parent, never questions to the owner.

Resolve execution choices yourself within the confirmed identity, scope, and
brain-id. Use the existing workflow and preserve its evidence and validation
requirements. Concurrency limits, batch scheduling, model fallback, optional
files, and workspace naming are implementation decisions, not owner decisions.
A rule in this skill or its references that describes a question applies only
to Manual once Automatic has been selected. Do not ask permission to adapt
scheduling to the host's available capacity.

Continue through retrieval, compilation, validation, and
`submit-brain` in the same run. Send declarative progress updates while working;
a status report is not a handoff back to the owner. Recover from routine errors
using the existing bounded retries. If no valid recovery remains, report the
specific failure and preserve completed work without turning it into a question.
Do not fabricate evidence, skip failed validation, expand the owner's scope,
create accounts, or claim upload success to force completion. Browser sign-in
and authorization still belong to the owner; wait for the existing uploader's
callback without adding a conversational confirmation. Honour owner corrections
or cancellation immediately. An instruction to stop
or build locally cancels the automatic submission handoff.

## Asking the owner

These questions apply before mode selection and during Manual. After Automatic
is selected, follow [Automatic: continue without questions](#automatic-continue-without-questions).

Every question below ships with its wording. Use the `question` and `header`
verbatim; write only the two example options from context. Wording is not a
detail here — the owner sees the question and nothing else, so an improvised
paraphrase of the rules above is what produces "Before I discover any source, I
need to know who this brain represents", which reads as the skill narrating its
own control flow at someone who just wants to make a brain.

Use a question tool to ask one question at a time. Wait for the user's answer
before asking the next question. If no question tool is available, follow the
same approach in plain text.

Rules for anything you do have to write yourself, including the examples:

- Plain second person. No word the owner would not use in conversation:
  never *persona*, *slug*, *scope*, *corpus*, *normalize*, *evidence*,
  *discovery*, *gate*, *artifact*, *invoke*, *retain*, *source directory*.
- Never narrate what you are about to do, why you need the answer, or what
  happens next. No "before I…", "I need to…", "in order to…".
- Question under about fifteen words. Options one to four words, with the
  concrete example in the option's description.

### The person this brain represents

```text
header:   Whose voice
question: When someone asks this brain a question, who are they hearing from?
```

Two options, each a short description of a person, drawn from the brain name.

This asks who the brain **answers as** — never who will be asking it. "Who
would talk to your brain" is a different question with a different answer, and
taking the audience as the voice makes the brain answer as the wrong person for
the rest of its life. If the owner's reply names an audience instead
("junior engineers", "my clients"), ask once more rather than accepting it.

### Brain scope

```text
header:   What it covers
question: What should this brain be good at — and what should it stay out of?
```

Two options, each naming one thing it handles and one thing it does not, both
narrower than the person above.

### Build mode

```text
header:   Build mode
question: Choose how to build your brain:
```

```text
Automatic (Recommended) — Find related projects, build, check, and upload this brain. Sign in when the browser opens.
Manual                  — Build locally with optional document choices. Review and submit when you choose.
```

### Written notes

```text
header:   Written notes
question: Any write-ups to add? Retros, decision records, design notes.
```

```text
Add these       — the <n> I found under <path>
I'll give paths — you type where they are
Skip            — the conversations are enough
```

### A brain already exists in that folder

```text
header:   Existing brain
question: You already have a brain here. Update it, or start a separate one?
```

```text
Update it            — keep what is there and add to it
Use a different name — start a separate brain
Cancel               — change nothing
```

In every other user-facing message, say "the person this brain represents" and
"folder name" (not "persona"/"slug"). Describe results and next actions without
narrating internal script mechanics.

## Which model each worker runs on

**Never ask the owner which model to use.** Set the Agent `model` parameter explicitly at every
spawn, including retries and nested delegation. Every content-inspection and other delegated worker uses the same
low-cost mapping below. The parent keeps its own model.

Choose by the worker's actual inference provider and execution environment,
not the provider of the conversation being read. A Codex worker reading Claude
sessions still uses the Codex mapping. A host connected to another provider
uses that provider's supported model IDs.

Mapping reference date: 2026-09-21. These are explicit cost-saving defaults,
not a claim that every provider exposes the same model or effort controls.

| Execution environment / inference provider | Worker model | Reasoning setting |
| --- | --- | --- |
| Claude Code / Anthropic | `haiku` | No separate effort override. |
| Codex / OpenAI | `gpt-5.6-luna` | `reasoning_effort: medium` on every spawn. |
| Grok / xAI | `grok-build-0.1` | Use only reasoning settings supported by the host for this model. |
| Gemini / Google | `gemini-2.5-flash-lite` | Disable thinking when supported. |
| Kimi Code | `kimi-for-coding` | `low`; use the configured alias `kimi-code/kimi-for-coding` when required. |
| Other providers, including standalone Kimi API | Cheapest available model that supports the worker's required tools and context | Lowest supported reasoning setting. |

For unlisted providers, resolve availability and cost from the host's model
catalog and official pricing before spawning. Do not guess a model ID or assume
that a fast model is cheaper. Kimi Code HighSpeed consumes more quota than the
standard model. Pricing and availability references:
[xAI](https://docs.x.ai/developers/pricing),
[Google](https://ai.google.dev/gemini-api/docs/pricing), and
[Kimi Code](https://www.kimi.com/code/docs/en/kimi-code/models.html).

Pass the selected model through the host's native subagent model control, not
only in the worker prompt. Do not leave it unset or select `inherit`, `auto`,
or an agent role that fixes a different model or effort. In Codex, use a spawn
mode that accepts overrides: `fork_turns: "none"` or a supported bounded history
count, never `fork_turns: "all"`. Supply the assigned scope, inputs, contracts,
and build mode explicitly when history is not inherited. In Gemini, configure
the subagent model itself; changing the parent's `/model` is insufficient.
Include this policy in worker prompts for any further delegation.

If the mapped model or required effort is rejected or unavailable, report the
worker launch failure and preserve completed work. Never fall back to the
parent model, session default, or a more expensive model. Do not ask the owner
to choose a model. Failed content
inspection blocks submission. Automatic mode does not waive this model policy.

## Schedule workers within host capacity

Use one worker per planned batch, but start only as many workers as the host
can run concurrently. Apply this to compilation, retries, and content inspection. Keep unstarted batches in the parent's
existing plan and start the next batch as a slot becomes available. Reuse or
release completed workers using the host's lifecycle tools when needed. Do not
create coordinator agents that consume slots merely to wait for other agents.

A capacity rejection means wait for running work to finish and then launch the
pending batch; it is not a failed source or a reason to ask the owner, stop the
build, drop sources, or enlarge batches. Preserve all planned work and each
batch's source, byte, and time limits. Each worker's deadline starts when it
actually launches, not while its batch waits for a slot. Monitor running
workers' deadlines while waiting. If worker execution is unavailable entirely,
report that runtime failure without a question or a false completion claim.

## Showing progress

One bar runs 0-100% across the whole build. It never restarts per stage and
never goes backwards.

```bash
python3 "$SKILL_DIR/scripts/collect_raw.py" progress \
  --workspace "$BRAIN_ROOT" --stage <stage> [--approved N] [--judged N]
```

For compilation and validation, report progress at these points:

| When | Call |
| --- | --- |
| Synthesis begins | `--stage synthesis` |
| **After writing each page** | `--stage synthesis` |
| Validation begins | `--stage validate --steps 3 --step 0` |
| **After each check finishes** | `--step <checks done>` |
| Completion report | `--stage done` |

The command owns the percentage. Never compute, round, or adjust it yourself.
Only the completion report may show 100%. During retrieval, report findings
and remaining uncertainty in prose without inventing a completion percentage.

## Workspace

Resolve this skill directory as `SKILL_DIR`. Store every brain under:

```text
~/ask-brain/<folder-name>/
├── README.md
├── raw/
│   ├── index.jsonl
│   ├── claude/<source-id>.jsonl
│   ├── codex/<source-id>.jsonl
│   ├── grok/<source-id>.jsonl
│   └── files/<collection-id>/<original-relative-path>
├── schema.md
└── output/
    ├── BRAIN.md
    ├── sources/
    ├── entities/
    ├── events/
    └── claims/
```

Conversation files under `raw/<provider>/` use one canonical format:
`askrealme-normalized-session-v1`. Each JSONL line is one ordered event with
only `timestamp`, `role`, `content`, and optional `tool` and `partial` fields.
Create provider directories only when matching records exist.

Use the absolute workspace path for every command and write. Never create an
`ask-brain/` directory inside the current project.

Only `output/` is transferable. Keep `raw/`, `schema.md`, and the workspace
README local. `raw/` contains only relevant normalized conversations and
owner-approved documents retained for this brain. Conversation normalization
removes unsupported envelope metadata, thinking, reasoning, images, and
discarded tool details before storage. Never upload, publish, or place `raw/`
in the transferable output.

If Automatic encounters an existing candidate folder, read only its root
`output/BRAIN.md` identity before deciding. Refresh it only when its `brain_id`
matches the command-line brain-id. Otherwise choose an unused folder name
with a short disambiguator; missing or unreadable identity is not a match.
Do not ask the existing-brain question in Automatic or overwrite a different
brain. Preserve `raw/` and increment the matching brain's version exactly once.

In Manual, if the normalized folder name matches an existing direct child
directory, explain that the operation will refresh the existing brain and use
`AskUserQuestion` — wording in [Asking the owner](#asking-the-owner) — to choose
Update it, Use a different name, or Cancel before changing it. If the owner chooses a different folder, repeat the direct-child
name check before accepting the replacement. Preserve
`raw/`, increment the positive integer `version` in `output/BRAIN.md`, and
keep `brain_id` set to the brain-id passed on the command line.

Before retrieval or any other write, verify a non-empty existing `raw/`:

```bash
python3 "$SKILL_DIR/scripts/collect_raw.py" verify \
  --output "$BRAIN_ROOT/raw"
```

If verification fails, stop. Do not retrieve, read, retain, compile, or add new
results to that workspace. Report that its retained evidence does not satisfy
the current normalized-raw contract. Never mix legacy native-session copies
with `askrealme-normalized-session-v1` records.

## 1. Retrieve

Find local AI sessions that provide useful evidence for the confirmed brain topic and scope. Use your judgment to search, inspect, and follow leads. Choose the tools and approach that fit the records you find; you do not need to inventory or review every session.

Spend up to five minutes searching and checking candidates. Then finish retaining the evidence you confirmed and writing its source pages.

Look for material that helps this brain answer useful questions: work performed, decisions, explanations, comparisons, failures, corrections, and observed results. A successful outcome is not required. Distinguish the owner's contributions from AI suggestions and work performed by others.

Useful leads may include tool names, actions, project paths, filenames, outputs, and session relationships. Follow whichever leads help. Mentions in settings, skill catalogs, or summaries can point you toward original records, but do not establish that the work happened in that session.

As you confirm relevant sessions, save them to `raw/` as canonical normalized JSONL and register their provenance and hashes in `raw/index.jsonl`. Never copy provider-native session files into `raw/`. Use the existing normalization and retention tools.

After retaining a session, write its matching `output/sources/<source-id>.md` page from the same normalized evidence. Follow the output and writing contracts. Preserve useful context, decisions, outcomes, and uncertainty without reproducing the transcript. Do not reopen the provider original to write the source page.

Keep unverified candidates out of the retained evidence. Report what you found, why it matters to the brain, the evidence locations, and any meaningful gaps or unverified leads. Do not claim exhaustive coverage.

Before continuing to Compile, verify that retained records are indexed and each retained session has its matching source page. If no relevant evidence is available, report that result instead of inventing material.

## 2. Compile

Apply the [compilation contract](references/compilation-contract.md) and the
[output contract](references/output-contract.md). For each retained source ID,
read its normalized record through `read --raw` together with its matching final
page in `output/sources/`. Use these pairs to write or update `entities/`,
`events/`, `claims/`, and `BRAIN.md`. Do not reopen upstream conversation
originals or create another intermediate format.

Before writing pages, write `schema.md` as a declaration of the page types that
this brain actually uses. The seed types are `sources`, `entities`, `events`,
and `claims`. Add another lowercase kebab-case directory only when recurring
supported content does not fit those four.

Use lowercase kebab-case Markdown file names. A stem must be unique across the
entire `output/` tree because short wiki links resolve by stem. Reuse an
existing page when it represents the same subject; choose a more specific
human-readable name when two different subjects would collide.

For an existing workspace: keep `brain_id` (the command-line brain-id),
increment the version exactly once, and rebuild the output from the complete
retained set.

## 3. Validate

Run the private source check again, then run the deterministic upload gate
against the transferable directory:

```bash
python3 "$SKILL_DIR/scripts/collect_raw.py" verify \
  --output "$BRAIN_ROOT/raw"
python3 "$SKILL_DIR/scripts/lint_wiki.py" "$BRAIN_ROOT/output"
```

Fix every reported error and rerun both checks, reporting progress after each.
Do not waive failures. Then launch the content inspection as one background
Agent worker using the [low-cost worker mapping](#which-model-each-worker-runs-on) — the third check — and
inspect for:

- conflicting claims;
- superseded claims that are not linked to their replacement;
- unsupported causes, preferences, or conclusions;
- direct quotations or framing that violates the public-safety rules;
- pages that cannot stand alone without local source material.

Resolve the content inspection findings before completion. Fix supported
issues and rerun affected checks. An unresolved validation error or failed
inspection blocks submission in both modes; Automatic reports the blocker
without waiving checks or inventing evidence.

## Submit the automatic result

In Manual, finish with the local completion report below. In Automatic, after
all checks pass, read and execute [submit-brain](../submit-brain/SKILL.md) with
the absolute `$BRAIN_ROOT/output/` path and the original brain-id. This explicit
path bypasses its brain picker. Use its existing shared uploader and production
defaults; do not implement another upload or authentication path.

Keep the uploader running while the owner signs in and authorizes in the
browser. Report that authorization is pending, not that upload succeeded.
Never create an account, accept credentials in chat, or bypass browser
authorization. If the browser cannot open, surface the uploader's continuation
URL. If authorization expires, is cancelled, or upload fails, preserve the local
brain and report the error and how to retry with `submit-brain`. Do not loop
retries or report success without a matching `uploaded` response.

## Completion report

Report:

- the absolute path to `output/`;
- for Automatic, the actual submission result: uploaded with its returned file
  count, awaiting browser authorization, or failed with the retry action;
- the page count for each type and the retained source count;
- both validation commands and whether they passed;
- what the content review verified and what remains unknown;
- each material judgment made while resolving ambiguous source material;
- any SQLite-backed or dependent-file sessions that remain unsupported;
- this reminder: "Upload only `output/` to AskRealMe. Keep `raw/`,
  `schema.md`, and the workspace README on this computer."
