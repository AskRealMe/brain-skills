# Upload Brain design notes

This page explains why new-brain uploads and existing-brain updates share one
uploader. The executable workflow lives in [SKILL.md](SKILL.md).

## Direct backend boundary

The common uploader calls the backend endpoint resolved by
`DEFAULT_API_URL`, `resolveDraftStatusEndpoint`, `resolveDraftEndpoint`, and
`resolveBrainArchiveEndpoint` in `plugins/askrealme/lib/upload-brain.mjs`.
Keeping the endpoint in code prevents long-lived documentation from becoming a
second, stale configuration source.

The web frontend is not an upload proxy. Local development and tests may use
`ASKREAL_API_URL` only under the environment conditions enforced by the common
uploader.

## One ZIP snapshot

HTTP has no directory body type. The uploader therefore validates the complete
brain into an in-memory buffer snapshot and packages that same snapshot into one
standard ZIP. It preserves UTF-8 relative paths and fixes file order and header
timestamps so the same snapshot produces the same bytes.

The uploader never rereads the directory after validation. `upload-brain` and
`review-brain` both use the same implementation, and review uploads also match
the full relative-path and SHA-256 set recorded by the review session.

Archive limits and path rules are exported by the common uploader and mirrored
by backend validation. The code and its contract tests are the canonical source
for their current values.

## Draft identity

A first upload cannot create an owner-bound final brain before the user signs
in. `create-brain` puts one UUID v4 in `BRAIN.md` first. The uploader looks up
that UUID, creates a draft with the same identity, and returns the stable
`/brains/{uuid}/confirm` URL. The UUID also identifies the claimed brain and its
storage prefix.

The server preserves the uploaded `BRAIN.md` bytes and never generates or
rewrites its UUID. Every later upload uses the same local value to update the
same brain.

## Owner-authorized updates

An existing UUID uses a browser and a short-lived loopback callback to obtain a
one-use code tied to that owner, brain, and archive update. Login credentials do
not enter the CLI. The uploader keeps the code in memory, consumes it once, and
requires the response UUID to match the local brain.

The callback verifies a random state and the production web Origin. If opening
the browser fails, the uploader prints the authorization URL and waits for a
bounded time. Backend requests also have a finite timeout.
