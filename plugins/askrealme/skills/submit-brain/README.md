# Upload Brain design notes

This page explains why direct submission and review uploads share one
uploader. The executable workflow lives in [SKILL.md](SKILL.md).

## Direct backend boundary

The common uploader calls the backend endpoint resolved by
`DEFAULT_API_URL` and `resolveBrainUploadEndpoint` in `plugins/askrealme/lib/upload-brain.mjs`.
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

The uploader never rereads the directory after validation. `submit-brain` and
`review-brain` both use the same implementation, and review uploads also match
the full relative-path and SHA-256 set recorded by the review session.

Archive limits and path rules are exported by the common uploader and mirrored
by backend validation. The code and its contract tests are the canonical source
for their current values.

## Dashboard identity and owner authorization

The dashboard creates the brain and supplies its brain-id. `create-brain`
records that id in `BRAIN.md`; submission uploads to the same existing brain.
The server checks existence and ownership. The uploader does not create a
brain, account, draft, or ownership-confirmation link.

An explicit submission request or Automatic build selection starts the same
browser authorization flow. A short-lived loopback callback obtains a one-use
code tied to the owner and brain. Login credentials do not enter the CLI. The
uploader keeps the code in memory, consumes it once, and requires the response
brain-id to match the local brain. Automatic passes the known output path to
avoid asking the owner to pick the brain again.

The callback verifies a random state and the production web Origin. If opening
the browser fails, the uploader prints the authorization URL and waits for a
bounded time. Backend requests also have a finite timeout.
