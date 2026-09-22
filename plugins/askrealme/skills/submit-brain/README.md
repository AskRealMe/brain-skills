# Submit Brain

Submit stores the validated local `output/` on AskReal.me before browser
approval. Its receipt links to a page where the signed-in owner connects those
files to the dashboard-created brain. The original brain ID is preserved, and
the local tool can exit after transfer.

The [skill](SKILL.md) owns selection, consent, execution, and result reporting.
The [shared uploader](../../lib/upload-brain.mjs) owns validation and the API
contract. Connecting files does not create a new brain or publish it.
