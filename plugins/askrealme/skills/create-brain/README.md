# Create Brain design notes

`create-brain` compiles one person's approved work records into a Markdown
knowledge base that can answer in that person's first person. The executable
contract lives in [SKILL.md](SKILL.md); this page records the stable design
rationale.

## Identity comes before retrieval

The dashboard supplies the brain name and brain-id. The owner confirms whose
voice the brain represents and what it covers before retrieval. Project
names, session counts, and suggested choices cannot establish the person's
identity or scope. The workspace folder name is derived from the brain name.

## Workflow

The workflow is Retrieve → Compile → Validate. A search-only subagent receives
the topic and scope without inherited conversation history or brain-building
instructions. The parent retains the returned sessions in raw. Compile writes source pages from retained evidence
before synthesis. The executable contract lives in
[SKILL.md](SKILL.md#1-retrieve).

## Automatic includes submission

The build-mode choice describes submission before the owner selects it.
Automatic resolves optional document and workspace choices without another
question and hands the validated output directly to `submit-brain`. The parent
and workers use neither question tools nor conversational permission requests
after mode selection. Worker capacity limits change launch timing, not batch
sizes or source coverage; pending batches start as slots become available. Browser
sign-in and authorization remain with the owner. Manual ends with local output
for review and submission at the owner's discretion. Neither mode uploads raw
sessions or creates an account.

## Practices need incidents

An incident alone is an anecdote. A practice alone is generic advice that any
model could produce. Pairing the two gives readers something they can use and
evidence that the practice came from the represented person's experience.

## Retained evidence preserves precision

Provider-native conversations are parser inputs only. Relevant conversations
are stored as canonical normalized JSONL containing the user, assistant, tool,
and tool-result events used for relevance decisions. Owner-supplied documents
remain unchanged. `raw/index.jsonl` records provenance and hashes.

The compiler never fills missing details from plausibility. A brain speaks as a
real person, so an invented detail would become a false first-person claim.

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

## Worker cost

Every delegated stage uses the explicit provider-specific
[low-cost worker mapping](SKILL.md#which-model-each-worker-runs-on), including
retries and nested workers. This keeps a costly parent model from multiplying
across batches. Unsupported model selections follow the existing stage failure
rules instead of silently escalating cost. The parent model is unchanged.
