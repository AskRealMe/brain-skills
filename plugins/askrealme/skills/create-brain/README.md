# Create Brain design notes

`create-brain` compiles one person's approved work records into a Markdown
knowledge base that can answer in that person's first person. The executable
contract lives in [SKILL.md](SKILL.md); this page records the stable design
rationale.

## Identity comes before discovery

The represented person determines which records are relevant and how the brain
speaks. Non-empty command arguments supply that value verbatim. An empty
invocation stops at an `AskUserQuestion` identity choice. Project names,
conversation counts, existing workspaces, and suggested choices cannot answer
that question for the owner. Source discovery starts only after the owner
explicitly describes or selects the person or expert the brain represents.

The folder name is required owner input. Before suggesting one, the workflow
reads only the existing direct child directory names under `~/ask-brain/` and
excludes them from its two contextual examples. `AskUserQuestion` preserves its
custom-answer route. The workflow normalizes the explicit answer to lowercase
kebab-case but never silently selects an example. A normalized collision enters
the explicit refresh, choose-another-folder, or cancel flow instead of silently
creating a second brain at the same path.

## Scope comes before discovery

The represented person can be broader than one useful brain. Before discovery,
the owner confirms in one question what work or experience the brain covers and
what it leaves out. Relevance workers use that confirmed scope directly. The
workflow does not create a separate scope artifact or add scoring, clustering,
source budgets, or target-question planning.

## Work directories require owner approval

Discovery scans supported self-contained local conversation stores without
reading conversation bodies. It groups the results by work directory and shows
the complete list to the owner. Collection starts only after the owner selects
one or more listed directories, and only sessions from those directories enter
the relevance pass.

## Practices need incidents

An incident alone is an anecdote. A practice alone is generic advice that any
model could produce. Pairing the two gives readers something they can use and
evidence that the practice came from the represented person's experience.

## Collection preserves normalized evidence and precision

Provider-native conversations are parser inputs only. Relevant conversations
are stored as canonical normalized JSONL containing the user, assistant, tool,
and tool-result events used for relevance decisions. Owner-supplied documents
remain unchanged. `raw/index.jsonl` records provenance and hashes.

The compiler never fills missing details from plausibility. A brain speaks as a
real person, so an invented detail would become a false first-person claim.

## Originals are read once

The workflow normalizes each upstream conversation once into temporary JSONL.
It balances parallel worker batches with both a 20-session cap and a 1.5 MiB
normalized-input cap. Normalized size is scheduling data only, never a relevance
signal. An irrelevant conversation leaves no artifact. A relevant conversation
is retained in `raw/`, and the worker writes exactly one matching public source
page from the same in-context normalized events. The upstream conversation is
not reopened for source generation, and no digest or card files exist.

Each semantic worker attempt stops at ten minutes. A timed-out oversized session
is split at normalized event boundaries for parallel evidence extraction, then
reduced back to one session-level decision and one source page. Workers never
perform staging cleanup; the parent removes explicit temporary JSONL paths with
a 60-second command limit.

## One compiler, two source scopes

The [output contract](references/output-contract.md) is the canonical
compiler for both creation and ingestion. `create-brain` runs it in full mode
over retained records. `ingest-brain` runs the same
contract in delta mode over only the exact new source IDs supplied for that
invocation. Delta mode touches only related output pages; it does not
reinterpret old raw material.

## External evidence enters through the source index

Git history and issue trackers can reveal useful evidence, but unindexed query
results cannot support a public fact. When the compiler needs external
evidence, it captures the exact text used for the decision under `raw/files/`
and indexes it before compilation.

## Selection keeps only relevant normalized sessions

Relevance depends on the represented person and topic. Irrelevant conversations
leave no raw artifact. Relevant conversations retain only their normalized
events. Upstream conversation stores remain unchanged.

## Local work and public output stay separate

Raw material and schema notes exist to build and audit the brain. Only
`output/` is self-contained, reviewed, and uploaded.
