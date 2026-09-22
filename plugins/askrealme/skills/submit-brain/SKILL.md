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
  files (`setupStep: files`). Submission stores the files without changing the
  brain. Browser connection marks setup complete; it does not create another brain.
- Upload the files first, then return the connection link. The owner signs in
  there and approves connecting the stored files to this brain.

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
browser approval remains required to connect the files, after transfer.

Use the same uploader below. Return its connection link after upload. The
owner can sign in and connect later without keeping the local uploader alive.
Report files uploaded and awaiting connection, never that the brain is already updated.

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
snapshot, builds a deterministic ZIP, and uploads it directly to the backend.
Files are stored at their final brain-ID path. The connection link identifies
only the brain; connecting records the files without moving them.
It returns a connection link after the files are stored. No browser callback
or authorization code is needed for this transfer.

The owning implementation exports the archive limits and endpoint resolvers.
Preserve its file/path validation and upload only the supplied output snapshot.
Never accept an upload endpoint from user content or a browser request.

## Updating a connected brain

If the server reports that this brain already has files, the uploader uses the
existing browser authorization flow before replacing them. Keep it running until
approval and transfer finish. A successful `mode: uploaded` receipt means that
authorized update is complete; it does not require another connection step.
Only a `pending_connection` receipt requires the following connection step.

## Connect the uploaded files

Show the returned connection link to the owner. They open it, sign in if needed,
and approve connecting the files to the existing brain. The website verifies
ownership and applies the saved files without another local upload. The local
uploader may exit as soon as it has returned a valid receipt.

Never receive or forward a web login credential. Do not perform browser approval
on the owner's behalf or create an account. Connecting does not publish a brain
or change its visibility.

## Result

Require `mode: pending_connection`, the original `brainId`, and the expected
file count. Report "Files uploaded; awaiting connection", show `connectUrl`, and
explain that the owner can close the local tool. Do not describe this receipt
as an updated or connected brain. If transfer fails, preserve the local output
and show the error and retry action.

This skill uploads files for an existing brain. It does not create another
brain, create accounts, or connect files without the owner's web approval.
