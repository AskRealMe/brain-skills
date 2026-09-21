# AskRealMe Skills

Turn your approved local AI work history into a portable, evidence-grounded
knowledge base that can answer in your voice.

The AskRealMe plugin provides four product skills:

1. `create-brain` collects approved local conversations and project documents,
   then compiles them into a self-contained Markdown brain.
2. `ingest-brain` applies the creation compiler to an explicit set of new raw
   Markdown without rebuilding older material.
3. `review-brain` opens a loopback privacy review workspace where you can
   inspect and edit every file before publishing it.
4. `submit-brain` uploads the validated brain to AskRealMe after an explicit
   upload request or an Automatic build selection, using browser authorization.

## Install

Install the Claude Code plugin:

```text
/plugin marketplace add AskRealMe/brain-skills
/plugin install askrealme@brain-skills
/reload-plugins
```

This is the supported route, and the one the AskRealMe dashboard hands you.
`/reload-plugins` is not optional: installing writes the plugin to disk without
activating it in the running session, so `/create-brain` does not exist until
it runs. The same applies after `/plugin marketplace update brain-skills` —
without a reload you keep using the version you already had.

The skills also publish through the open [skills CLI](https://github.com/vercel-labs/skills),
which reaches Codex, Cursor and others:

```bash
npx skills add AskRealMe/brain-skills
```

That path is **not yet verified end to end**. Two known gaps: it installs the
four skill directories but not their shared `plugins/askrealme/lib/uploader`,
which `submit-brain` and `review-brain` resolve at `../../lib/`; and
`create-brain` asks its questions through `AskUserQuestion` and fans relevance
work out across background Agent workers, neither of which exists outside
Claude Code. Expect brain creation to degrade and publishing to fail. Use the
plugin until that is fixed.

## Create your first brain

Create the brain on the [dashboard](https://www.askreal.me/dashboard) first —
it names the brain and issues the brain-id. Then run the creation skill with
both, exactly as the dashboard shows them:

```text
/create-brain "Loop engineering" cmt5cqltx000mw4xrf6rupizj
```

The brain-id is required. Without it the skill stops and sends you to the
dashboard rather than inventing one, because that id is what `submit-brain`
later publishes to.

The skill confirms whose voice the brain answers in and what it should cover
and stay out of, then offers Automatic and Manual:

- **Automatic** builds and checks the brain, then opens the browser to authorize its upload.
  Selecting this option includes submission; there are no further setup
  questions. Sign in and authorize in the browser when prompted.
- **Manual** offers optional document choices and leaves the result locally
  for you to review and submit.

The workflow is Retrieve → Compile → Validate. Retrieve is not implemented in
this branch; new brain builds are unavailable until its contract is defined.

Both use the same evidence, writing, and validation workflow. You can interrupt
to narrow the projects or stop submission. The local folder name is derived
from the brain name.

The skill reads supported local conversation originals in place. It retains only
relevant normalized conversations in `~/ask-brain/<folder-name>/raw/` and writes their final
public source pages immediately. Retained source material stays separate from
the shareable result.

```text
~/ask-brain/<folder-name>/
├── raw/          local source material; never upload
├── schema.md     local output schema
└── output/       the only directory intended for review and upload
```

For Manual, review the result before publishing:

```text
/review-brain /absolute/path/to/ask-brain/<folder-name>/output
```

You can also upload an already reviewed brain directly:

```text
/submit-brain /absolute/path/to/ask-brain/<folder-name>/output
```

## Add new material to an existing brain

Use `ingest-brain` when you have approved Markdown notes or records to merge
without rebuilding the full brain:

```text
/ingest-brain /absolute/path/to/ask-brain/<folder-name>/output /absolute/path/to/new-note.md
```

The skill contains no separate compiler or helper script. It reads
`create-brain`'s canonical compilation contract, applies it in delta mode to
only the exact new raw files, and updates only the related output pages. Older
raw files are not reread, unrelated output pages remain unchanged, and the
complete output still passes the same lint gate. Review the updated output
before uploading it.

To rebuild from the complete retained set instead, run `create-brain` again
with the same brain-id. Both refresh paths keep the brain-id recorded in root
`BRAIN.md` and advance its version.

## Privacy and upload boundary

- `raw/` retains relevant conversations as canonical normalized JSONL rather
  than provider-native session bytes. Normalization keeps only supported
  user, assistant, tool, and tool-result event fields and redacts common
  secrets, contact details, and local usernames.
- Ingestion copies approved external Markdown into local `raw/` without
  modifying the original, then compiles only that explicit new set.
- `raw/`, `schema.md`, and the workspace README stay local.
- The review workspace listens only on `127.0.0.1`.
- Review runs local pattern checks first, then sends the complete reviewed
  Markdown file set once to the AI runtime selected by the invoking host for a
  contextual privacy pass. That runtime may use its configured model provider.
- Opening the review workspace or saving edits never uploads a brain.
- An upload starts only after an explicit upload request or Automatic selection
  and browser authorization. The review workspace AI privacy pass is separate
  from creation validation and upload.
- Updates to an existing brain require a short-lived, one-use authorization
  tied to that brain.

See the individual skill files for the executable workflow and validation
contracts. Source code, API endpoints, and upload limits remain canonical in
the implementation rather than being duplicated here.

## Development

The public plugin lives under `plugins/askrealme/`. Validate changes with the
skill validators, the Claude plugin validator, the cross-agent installation
list, and the Python and Node test suites that accompany each skill.
# brain-skills
