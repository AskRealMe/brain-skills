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
4. `upload-brain` uploads the reviewed brain to AskRealMe only after an explicit
   user action.

## Install

Install the portable Agent Skills with the open skills CLI:

```bash
npx skills add AskRealMe/askrealme-skills
```

Or install the Claude Code plugin:

```text
/plugin marketplace add AskRealMe/askrealme-skills
/plugin install askrealme@askrealme
```

## Create your first brain

Run the creation skill with a short description of the person the brain should
speak as and, optionally, a folder name:

```text
/create-brain "a product builder who delegates software work to AI" ai-product-builder
```

You can also run `/create-brain` without arguments. It first asks which person
or expert the brain should represent and waits for your answer before inspecting
local conversation folders. Suggested examples are never selected on your
behalf. If you omit the folder name, the skill derives one from your answer.

The skill reads supported local conversation originals in place. It copies only
relevant originals into `~/ask-brain/<folder-name>/raw/` and writes their final
public source pages immediately. Retained source material stays separate from
the shareable result.

```text
~/ask-brain/<folder-name>/
├── raw/          local source material; never upload
├── schema.md     local output schema
└── output/       the only directory intended for review and upload
```

Review the result before publishing:

```text
/review-brain /absolute/path/to/ask-brain/<folder-name>/output
```

You can also upload an already reviewed brain directly:

```text
/upload-brain /absolute/path/to/ask-brain/<folder-name>/output
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

To rebuild from the complete approved conversation set instead, run
`create-brain` with the same folder name. Both refresh paths preserve the UUID
recorded in root `BRAIN.md` and advance its version.

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
- A request to AskRealMe begins only after the user selects the upload action;
  the AI privacy pass is separate from that upload.
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
