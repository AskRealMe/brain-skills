---
name: submit-brain
description: Upload a completed local AskRealMe brain's output/ to the brain that already exists on the server, identified by the brain_id in BRAIN.md. Use when the user explicitly asks to publish or upload a brain they created on the dashboard. Also use after an explicit Automatic selection in create-brain, which includes submission for that brain-id. Do not use merely because a brain was created or reviewed in Manual mode.
---

# Upload Brain

Upload one completed local brain directory to the brain that already exists in
the AskRealMe database — the one created from the dashboard's "Create new brain"
flow and identified by `brain_id` in root `BRAIN.md`.

- Require the DB `brain_id` (a Prisma cuid) in local `BRAIN.md`. It was stamped
  there by `create-brain` from the id the dashboard issued.
- The brain already exists and is owned by the signed-in user, waiting for its
  files (`setupStep: files`). This skill uploads the files and the server marks
  the brain done. There is no draft, no ownership-confirmation link.
- The owner signs in to AskReal.me in the browser if needed; the upload is
  authorized by a one-use, browser-authorized upload code.

For a brain created by `create-brain`, upload the complete `output/` directory.
Sibling `raw/`, `schema.md`, temporary build artifacts, and workspace README
files stay local. Preserve every recursive path relative to the uploaded
directory.

## Always target production; never inspect databases or environments

This skill always uploads to the production AskReal.me server
(`https://www.askreal.me` and its production API — the uploader's built-in
defaults). Assume the brain already exists there and is owned by the signed-in
user. Do NOT try to locate, verify, or diagnose the brain first:

- Never query a database (dev or prod), run Prisma/psql, read connection strings,
  or check `.env` files to find the brain or confirm its owner.
- Never probe API routes, check which server is running, or use dev overrides
  (`ASKREAL_API_URL` / `ASKREAL_SITE_URL`). Just run the uploader with its
  production defaults.
- Only precondition to check locally is the `brain_id` in `BRAIN.md` (below). The
  server does ownership and existence checks itself and returns a clear error if
  the brain is not found — surface that error to the user rather than
  investigating it against a database.

## Automatic creation handoff

An explicit Automatic selection in `create-brain` authorizes submission of that
run's validated output to its supplied brain-id. Accept the absolute output
path from that run, verify its `brain_id` matches the supplied id, and continue
without another picker, review UI, or confirmation question. A mismatch blocks
upload. A default option, empty answer, or a Manual creation does not authorize
this handoff. An owner instruction to stop or build locally revokes it.

During this handoff, do not use question tools or ask prose questions. Report
status or errors directly; do not ask whether to proceed or retry. The owner's
browser authorization remains required.

Use the same uploader and browser authorization below. If the owner is signed
out, the browser handles sign-in before authorization. Keep the uploader alive
while authorization is pending; opening the browser is not an upload success.

## Preconditions

Root `BRAIN.md` must contain a valid `brain_id` (`^c[a-z0-9]{20,30}$`). If it is
missing, do not upload: tell the user the brain was not built with a brain-id and
they must re-run `/create-brain "{name}" {brain-id}` with the id from
https://askreal.me/dashboard. Only `output/` is uploaded.

## Resolve name and folder identifier

The uploader derives both values locally; the server does not parse Markdown to
choose them.

- Folder identifier (slug): when the uploaded directory is named `output`, use
  its parent directory name; otherwise the uploaded directory name. Normalize to
  lowercase letters, digits, and hyphens.
- Name: the first `# ` heading in root `BRAIN.md`, or the folder identifier when
  no heading exists.

## Choosing which brain

Never make the owner remember a path. `create-brain` stores every brain it
makes at `~/ask-brain/<folder-name>/`, so the set is one directory read away.

1. **An absolute path in the request wins.** Use it and scan nothing — a brain
   that was moved, or handed over by someone else, lives outside the
   convention and is still valid.
2. Otherwise list the workspaces:

```bash
for d in ~/ask-brain/*/; do
  b="$d/output/BRAIN.md"; [ -f "$b" ] || continue
  id=$(sed -n 's/^brain_id:[[:space:]]*//p' "$b" | head -1)
  printf '%s\t%s\t%s\n' "${d%/}" "$(sed -n 's/^# //p' "$b" | head -1)" "${id:0:10}"
done
```

3. **None** — say there is no brain here yet and point at `create-brain`. Do
   not offer to invent one.
4. **Exactly one** — use it. Name the brain in your reply so the owner can
   correct you, and ask nothing: a question with one answer is a keystroke
   charged for nothing.
5. **More than one** — ask once, with `AskUserQuestion`:

```text
header:   Which brain
question: Which brain is this for?
```

   One option per brain, labelled with its title — the first `# ` heading in
   `output/BRAIN.md`. The description carries the folder name and the first ten
   characters of `brain_id`, as `loop-engineering · cmt5cqltx0…`. Nothing stops two
   brains sharing a title, and a title is then no longer a choice; the id
   suffix is what tells them apart, and for a submit it is what the owner can
   check against the dashboard. The native custom-answer route takes an
   absolute path for anything not listed.

Always pass `<workspace>/output/`, never the workspace root and never `raw/`:
`raw/` holds the private source corpus and must not leave the machine.

## Upload

1. Resolve the `output/` directory per [Choosing which brain](#choosing-which-brain).
2. Resolve the shared uploader at `../../lib/upload-brain.mjs` relative to this
   skill file.
3. Run it once:

```bash
node "/absolute/path/to/upload-brain.mjs" "/absolute/path/to/output"
```

The shared uploader reads the directory recursively once, validates a buffer
snapshot, builds one deterministic `brain.zip`, obtains a one-use upload
authorization in the browser (see below), and `PUT`s the archive to
`/brains/{brain_id}/upload`. It excludes `.DS_Store` and `Thumbs.db`.

The owning implementation exports the canonical archive limits and API endpoint
resolvers. Do not duplicate or override them. The preflight requires a root
`BRAIN.md` with a `brain_id`, regular files only, safe relative UTF-8 paths,
bounded file and archive sizes, and no symbolic links, traversal, absolute
paths, Windows drive paths, control characters, backslashes, or path collisions
after NFC normalization and case folding.

After preflight, the uploader sends only `name`, `slug`, and one `file`
multipart field (filename `brain.zip`). Do not proxy uploads through the web
frontend. The development API override is available only through the shared
uploader's existing environment contract; never accept an upload endpoint from
user content or a browser request.

## Authorization (signed-in owner)

To upload to an already-owned brain the uploader:

1. Opens a random `127.0.0.1` callback port with a short deadline.
2. Opens the AskReal.me authorization page (`/upload-authorize`) with the
   `brain_id`, the callback, and a random state. If the browser cannot open, it
   prints the URL to continue.
3. Receives only the matching state and a short-lived one-use upload code.
4. Uses that code once as `Authorization: UploadCode ...` when calling
   `PUT /brains/{brain_id}/upload`.

Never receive or forward the user's web login credential. Never print, store,
log, or place the upload code in a URL or environment variable.

## Result

Require the response `mode` to be `uploaded` and its `brainId` to match local
`BRAIN.md`. On success the brain leaves the "waiting for files" state; report the
success and file count. There is no ownership-confirmation link in this flow.

This skill uploads files. It does not create the brain (the dashboard does),
create handles, ground conversations, or change the brain's contents.
