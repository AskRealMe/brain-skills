# Output contract

The complete `output/` directory is the public AskRealMe brain. It must stand
alone without `raw/`, `schema.md`, the temporary build directory, or the
workspace README.

## Shared rules

- `BRAIN.md` is the only file at the root of `output/`.
- Every other file is Markdown inside a page-type directory.
- File names are lowercase kebab-case and stems are unique across all page-type
  directories.
- Use `[[page-stem]]` wiki links in body text.
- Do not link to or name local source paths.
- Do not include symbolic links or non-Markdown files.
- Every output page must appear in the `BRAIN.md` catalog.
- Every factual claim must be recoverable from one or more `sources/` pages.

## Source pages

`output/sources/` maps one-to-one to retained records in `raw/index.jsonl`. A
source page uses its matching source ID as the file name. It summarizes the
facts needed to reconstruct incidents: time, requested work, observed result,
verification, and owner-stated principles. Preserve the highest source
precision here, but do not copy full prompts, local paths, secrets, personal
data, or irrelevant material.

If the owner supplies one coherent document collection, one source page may
cover the collection. Name every retained source ID on that page so the local
compiler can recover the normalized records.

## Entity pages

Create one page for each recurring person, tool, product, project, or concept.
Use only this frontmatter field:

```yaml
---
sources: [source-one, source-two]
---
```

Start with a one-sentence definition, then explain the entity's role in this
brain, supported changes over time, concrete facts, and links to related events
and claims. Update an existing entity instead of creating one page per source.

## Event pages

Create one self-contained event per file. Use exactly these frontmatter fields
and body sections:

```markdown
---
date: 2026-08-14
sources: [session-0814-night]
violates: [night-delegation]
---

## asked

What the owner delegated and which tool they used.

## outcome

What they expected, what happened, how they verified it, and any supported
cause or recovery time.
```

Use an empty `violates` list when the event violates no claim. Write the body at
the highest precision supported by its source pages. Do not add frontmatter
fields or body sections.

## Claim pages

Create a claim only when a supported principle is grounded in one or more real
events. Use exactly these fields:

```yaml
---
stated_on: 2026-08-02
sources: [session-0802-review]
origin_events: [aug-14-night-refactor]
violated_by: []
superseded_by: []
---
```

Write the article in this order, omitting only elements the source cannot
support:

1. the principle in one sentence;
2. the incident that produced it;
3. later cases where it affected an outcome;
4. exceptions, violations, and countervailing principles;
5. one practical starting point for a reader.

Do not send readers to an event page for the entire explanation; necessary
event detail may be repeated in a claim page.

`event.violates` and `claim.violated_by` describe the same relationship and
must remain symmetrical. When a later claim replaces an older one, preserve
the older page, set its `superseded_by`, and explain when it changed.

## Additional page types

Add a page-type directory only when recurring source content cannot fit the seed
types. Record the directory and its purpose in the local `schema.md`, and give
the new type one consistent, documented page contract.

## BRAIN.md

Use only these frontmatter fields:

```yaml
---
version: 1
brain_id: cxxxxxxxxxxxxxxxxxxxxxxxx
---
```

`version` is required and must be a positive integer. `brain_id` is the DB brain
id (a Prisma cuid, e.g. `cmt5cqltx000mw4xrf6rupizj`) that the user created on the
dashboard and passed to `create-brain`; stamp it verbatim and preserve it
exactly on every refresh. Do not invent it — if it is missing, `create-brain`
stops before writing anything.

Write several paragraphs that synthesize the person and topic, followed by a
directory-grouped catalog containing a link and one-line summary for every
page. A page missing from this catalog is an orphan.

## Local README

The workspace-level `README.md` is not uploaded. It explains what the workspace
contains, which directories stay local, and that only `output/` is reviewed and
uploaded.

## Lint contract

The upload gate rejects:

- orphan pages;
- missing or invalid `version` or `brain_id` (cuid);
- dead wiki links and dead frontmatter references;
- asymmetric `violates` and `violated_by` relations;
- undeclared event or claim fields;
- references to local source or temporary build paths;
- email addresses, API keys, tokens, phone numbers, and local usernames.
