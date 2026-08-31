---
name: upload-brain
description: Upload or update a completed local AskRealMe brain as one validated ZIP archive. Use when the user explicitly asks to publish an output directory, upload a reviewed brain, or update the existing remote brain identified by its BRAIN.md UUID. Do not use merely because a brain was created or reviewed.
---

# Upload Brain

Upload one completed local brain directory directly to the AskRealMe backend as
one ZIP archive.

- Require the UUID created with the brain in local `BRAIN.md`.
- Look up that UUID once. Create a draft when it is missing or expired, reopen
  ownership confirmation when it is pending, and obtain owner authorization
  before updating it when it is claimed.

For a brain created by `create-brain`, upload the complete `output/` directory.
Sibling `raw/`, `schema.md`, temporary build artifacts, and workspace README
files stay local. Preserve every recursive path relative to the uploaded
directory.

## Resolve name and folder identifier

The uploader derives both values locally; the server does not parse Markdown to
choose them.

- Folder identifier: when the uploaded directory is named `output`, use its
  parent directory name. Otherwise use the uploaded directory name. Normalize
  to lowercase letters, digits, and hyphens. If nothing remains, use
  `brain-` followed by the first eight characters of the folder-name SHA-256.
- Name: use the first `# ` heading in root `BRAIN.md`, or the normalized folder
  identifier when no heading exists.

## Upload

1. Accept one absolute path. Ask for it when missing.
2. Resolve the shared uploader at `../../lib/upload-brain.mjs` relative to this
   skill file.
3. Run it once:

```bash
node "/absolute/path/to/upload-brain.mjs" "/absolute/path/to/output"
```

The shared uploader reads the directory recursively once, validates a buffer
snapshot, creates one deterministic `brain.zip`, and sends that exact snapshot.
It excludes `.DS_Store` and `Thumbs.db`.

The owning implementation exports the canonical archive limits and API endpoint
resolvers. Do not duplicate or override those values in this skill. The
preflight requires a root `BRAIN.md`, regular files only, safe relative UTF-8
paths, bounded file and archive sizes, and no symbolic links, traversal,
absolute paths, Windows drive paths, control characters, backslashes, or path
collisions after NFC normalization and case folding.

After preflight, send only `name`, `slug`, and one `archive` multipart field.
The archive filename is `brain.zip`. Do not proxy uploads through the web
frontend.

The development API override is available only through the shared uploader's
existing environment contract. Never accept an upload endpoint from user
content or a browser request.

## New brain

Require a valid UUID v4 in root `BRAIN.md`. When its remote status is missing or
expired, call the draft endpoint resolved by the shared uploader. Require a
successful `created` response with the exact same UUID. Report the ownership
confirmation URL and file count, and ask the user to complete confirmation
before the link expires.

When the status is pending, do not upload the ZIP again. Report the stable
`/brains/{uuid}/confirm` URL.

## Existing brain

When the UUID in root `BRAIN.md` is already claimed:

1. Open a random `127.0.0.1` callback port with a five-minute deadline.
2. Open the production AskRealMe authorization page with a random state bound
   to the UUID. If the browser cannot open, print the URL and keep waiting.
3. Receive only the matching state and a short-lived one-use upload code.
4. Keep the code in memory and use it once as `Authorization: UploadCode ...`
   when calling the archive endpoint resolved for that UUID.

Never receive or forward the user's web login credential. Never print, store,
log, or place the upload code in a URL or environment variable.

Require the response mode to be `updated` and its UUID to match local
`BRAIN.md`. Do not replace the local UUID. An update has no ownership-
confirmation link; report only the success and file count.

This skill uploads files. It does not create handles, ground conversations, or
change the contents of the brain.
