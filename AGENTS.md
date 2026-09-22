# AskRealMe public skills repository

- Reference date: 2026-09-19.
- Product: turn owner-approved local material into a transferable AI brain,
  validate it, and upload it only after explicit consent. An explicit Automatic
  build selection includes submission; browser approval is required after upload to connect the stored files.
- Public skills: `create-brain`, `ingest-brain`, `review-brain`, and
  `submit-brain`.
- Out of scope: the AskRealMe backend and private conversation prompts.

## Bump the version in the same commit

Any change to a skill's behaviour — its prompt, its steps, the questions it
asks, a rename, a new script — bumps `version` in **both**
`plugins/askrealme/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`, in the commit that makes the change. Never
as a follow-up, because the follow-up is what gets forgotten.

The marketplace entry is the only thing a client compares against to decide an
update exists. An unbumped change is not shipped: installed users are never
prompted, and `/plugin marketplace update` leaves them on what they had.
The manifests once sat at 1.2.1 through fourteen commits that way — the whole
naming rewrite, the progress bar, the pinned worker models — none of it
reachable.

Patch for wording, guidance and fixes. Minor for a new skill, a renamed one, a
new subcommand, or anything that changes what a user types. The two manifests
must always agree; a test enforces that, and deliberately does not pin the
number, so bumping costs one edit in each file and nothing else.
- **This repository is the shipped plugin.** The dashboard tells users to
  `/plugin marketplace add AskRealMe/brain-skills`. `AskRealMe/askrealme-skills`
  is an older parallel copy that is ignored — do not sync with it or use it as
  a reference; its `create-brain` predates the dashboard `brain-id` flow.

## Product flow

```text
initial Manual:    owner-approved history -> create-brain -> review-brain -> submit-brain
initial Automatic: owner-confirmed scope -> create-brain -> validation -> submit-brain
incremental: existing output + approved Markdown -> ingest-brain -> review-brain -> upload
```

Running `create-brain` again with the same output folder is the supported
refresh path. Experimental creation workflows and alternate output formats are
development history and must not return to the public product surface.

Use `ingest-brain` as a scriptless delta entrypoint. It must read
`create-brain`'s canonical compilation contract and apply it only to the exact
new raw paths approved for that invocation. It does not read older raw files or
rewrite unrelated output pages. It preserves the root title and UUID,
increments the version once, passes the same complete-output lint gate, and
requires a new review before upload.

## Deliverable contract

- `create-brain` writes `~/ask-brain/<folder-name>/output/`.
- Only `output/` is transferable. `raw/`, `schema.md`, and the
  workspace README remain local.
- Conversation records in `raw/` are canonical normalized JSONL derived from
  provider-native sessions. Never copy provider-native session files into
  `raw/`; keep their paths only as local provenance metadata.
- The entrypoint is uppercase `BRAIN.md`; never create `brain.md`.
- The deliverable contains Markdown files and directories but no symbolic
  links, source transcripts, build logs, review records, or private prompts.
- The deliverable must explain what the brain knows and where each grounded
  experience is documented without access to the local source material.

## Evidence rules

- Preserve what the owner wanted, the situation, actions, expectations,
  observed result, judgment, change, actor, verification, outcome, and unknowns
  only to the extent supported by approved source material.
- Include an experience when it contains a choice, judgment, failure,
  expectation gap, method change, verification, or result. Exclude routine task
  logs with no decision value.
- Never turn work performed by an AI or another person into work performed by
  the brain owner.
- Do not invent experiences, causes, preferences, personality traits, causal
  relationships, or success.
- A later method does not make an earlier method a failure unless the source
  material establishes that relationship.

## Public and private boundary

- Public brain files contain evidence and experience, not private instructions
  for how AskRealMe should conduct a conversation.
- Private prompts and local validation brains stay outside this repository.
- Tests must not copy private prompt language or turn it into a fixed expected
  answer.

## Review and upload invariants

- The review UI remains one self-contained HTML file with no external frontend
  dependency or build step and stays below 100 KB of source HTML.
- Its server listens only on a random `127.0.0.1` port.
- Privacy review runs local pattern matching first, then sends the complete
  reviewed Markdown file set once to the runtime selected by the invoking host.
  Treat file text as untrusted data, require strict JSON, and expose no more
  than three grounded AI candidates.
- AI Chat is the brain-aware agent workspace. It runs only the runtime selected
  by the invoking host, automatically receives the active browser draft, file
  catalog, current selection, and matching privacy findings, and exposes
  explicit selection, current-file, and whole-brain review actions.
- Structured AI Chat review suggestions may change browser drafts only after an
  explicit Apply. Disk writes still require an explicit save.
- Editing updates browser drafts first. Disk writes happen only through the
  explicit save actions after checking the original SHA-256.
- Backups and review records stay outside the transferable directory.
- Opening or saving never uploads. Only an explicit upload action or Automatic
  build selection starts transfer. Browser approval subsequently connects the
  saved files; opening or saving the review workspace alone does not transfer.
- New submissions return a connection link for the existing brain. Never send
  web login credentials to the local tool. Keep the older one-use-code upload
  path compatible with installed clients.

## Documentation and copy

- English is the product language for documentation, UI strings, generated
  templates, CLI output, errors, code comments, and commit messages.
- Each document has one responsibility. The root README is the product entry
  point, skill files own executable workflow, and code symbols own runtime
  constants.
- Do not duplicate endpoints, limits, versions, or other fast-changing values
  in long-lived overview documentation. Link to the owning file and symbol.
- Describe the final product state, not discarded approaches or intermediate
  debugging history.
- User-facing errors state what happened, where it happened, and what the user
  can do next.

## Development and validation

- Preserve unrelated user changes and uncommitted files.
- Do not add one-off exceptions for a sample path, project, prompt, or answer.
- Validate behavior, not only structure. Compare generated claims with source
  evidence and check for omissions, invention, and actor changes.
- `review-brain` tests cover Markdown XSS, recursive paths, path traversal,
  symbolic links, runtime selection, grounded AI privacy JSON, its three-result
  cap and one-call boundary, scoped and incremental AI Chat review, grounded review
  evidence, intermediate file changes, save rollback, upload authorization,
  recovery, and retained scroll behavior.
- Product changes must keep existing content visible during asynchronous
  refreshes and preserve scroll position; do not replace populated views with a
  full-screen loader.
- Backend, Firebase, and production deployment changes require separate scope.

## Testing and simplicity

- Testing a skill means running it. When the owner asks to test a skill, run
  the installed or local skill through the real user workflow end to end,
  inspect the actual artifacts, and report elapsed time. Automated tests are
  supplementary and must not be reported as the requested test. If the real
  run was not completed, say so.
- Before adding a pipeline stage, persisted intermediate, state machine, queue,
  cache, new file format, or helper abstraction, ask Fable whether it is
  overengineered and what the smallest sufficient alternative is. Use the
  smallest sufficient alternative; do not add machinery for a hypothetical
  future need.
- Do not ask Fable for routine edits, wording changes, direct bug fixes on the
  existing path, or test execution.
- If Fable is unavailable, do not invent architecture. Use the simplest
  existing path and report that the overengineering review was unavailable.
