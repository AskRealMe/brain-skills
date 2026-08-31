"""Upload gate for create-brain wikis.

CLI: python3 lint_wiki.py <output-dir>
  output-dir is ask-brain/<slug>/output/. Everything under it is the upload
  set — raw/, schema.md, README.md live one level up in
  ask-brain/<slug>/ and are never passed in. Checks: raw path leaks in text,
  sensitive strings, orphan pages, dead wikilinks and frontmatter references,
  violates<->violated_by symmetry, undeclared frontmatter fields on
  events/claims.
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

ROOT_EXEMPT = {"brain"}  # not a page; no orphan check
BRAIN_FIELDS = {"version", "uuid"}
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
LOCAL_PATH_RE = re.compile(r"(?<![\w.])(?:\.\./)*raw/")
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PHONE_RE = re.compile(
    r"(?<![\d-])(?:"
    r"(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}|"
    r"\+\d{1,3}[ .-](?:\d[ .()-]?){6,13}\d"
    r")(?!\d)"
)
HOME_PATH_RE = re.compile(r"/(?:Users|home)/[A-Za-z][\w.-]*")
SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9]{10,}\b"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bxoxb-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b[0-9a-fA-F]{40,}\b"),
    re.compile(r"\b[A-Za-z0-9+/]{40,}={0,2}\b"),
]
MD_LINK_RE = re.compile(r"\]\(([^)]+)\)")
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
# collect_raw.py output signature — a raw dump promoted into output/ unsummarized
DUMP_RE = re.compile(r"^## User messages$", re.MULTILINE)
# a summary page never legitimately reaches this size; a raw dump does
MAX_PAGE_BYTES = 30_000

EVENT_FIELDS = {"date", "sources", "violates"}
CLAIM_FIELDS = {"stated_on", "sources", "origin_events", "violated_by", "superseded_by"}
# frontmatter list field -> directory its filenames must exist in
REF_DIRS = {
    "sources": "sources",
    "violates": "claims",
    "origin_events": "events",
    "violated_by": "events",
    "superseded_by": "claims",
}


def parse_frontmatter(text: str) -> dict[str, object]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    fields: dict[str, object] = {}
    key = None
    for line in lines[1:]:
        if line.strip() == "---":
            return fields
        item = re.match(r"\s+-\s*(.+)", line)
        if item and key is not None and isinstance(fields[key], list):
            fields[key].append(item.group(1).split(" #", 1)[0].strip())
            continue
        kv = re.match(r"(\w+):(.*)", line)
        if not kv:
            continue
        key, value = kv.group(1), kv.group(2).split(" #", 1)[0].strip()
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            fields[key] = [v.strip() for v in inner.split(",") if v.strip()]
        elif value == "":
            fields[key] = []  # may be a block list; items collected above
        else:
            fields[key] = value
    return {}  # frontmatter never closed


def stem_of(name: str) -> str:
    return Path(name.strip()).stem.casefold()


def lint(brain_dir: Path) -> list[str]:
    violations: list[str] = []
    if not brain_dir.is_dir():
        return [f"{brain_dir}: directory not found"]

    md_files = sorted(brain_dir.rglob("*.md"))
    brain_md = brain_dir / "BRAIN.md"
    if not brain_md.is_file():
        violations.append("BRAIN.md is missing")

    texts: dict[Path, str] = {}
    for path in md_files:
        rel = path.relative_to(brain_dir).as_posix()
        try:
            texts[path] = path.read_text(encoding="utf-8", errors="ignore")
        except OSError as exc:
            violations.append(f"{rel}: could not read file ({exc})")

    all_stems = {p.stem.casefold() for p in md_files}
    by_dir: dict[str, dict[str, dict[str, object]]] = {}
    stem_to_dirs: dict[str, set[str]] = {}

    for path, text in texts.items():
        rel = path.relative_to(brain_dir).as_posix()
        if DUMP_RE.search(text):
            violations.append(f"{rel}: found raw dump heading ('## User messages'); write a source summary instead")
        if len(text.encode("utf-8")) > MAX_PAGE_BYTES:
            violations.append(f"{rel}: page exceeds {MAX_PAGE_BYTES:,} bytes; split the article and remove source dumps")
        if LOCAL_PATH_RE.search(text):
            violations.append(f"{rel}: references a local raw/ path")
        if EMAIL_RE.search(text):
            violations.append(f"{rel}: contains a possible email address")
        if PHONE_RE.search(text):
            violations.append(f"{rel}: contains a possible phone number")
        if HOME_PATH_RE.search(text):
            violations.append(f"{rel}: contains a username from a home-directory path")
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                violations.append(f"{rel}: contains a possible API key or token")
                break
        for target in WIKILINK_RE.findall(text):
            if stem_of(target) not in all_stems:
                violations.append(f"{rel}: dead wiki link [[{target.strip()}]]")

        parts = path.relative_to(brain_dir).parts
        if len(parts) == 2:  # <type>/<page>.md
            fm = parse_frontmatter(text)
            by_dir.setdefault(parts[0], {})[path.stem.casefold()] = fm
            stem_to_dirs.setdefault(path.stem.casefold(), set()).add(parts[0])
            type_dir = parts[0]
            declared = {"events": EVENT_FIELDS, "claims": CLAIM_FIELDS}.get(type_dir)
            if declared is not None:
                extra = set(fm) - declared
                if extra:
                    violations.append(f"{rel}: undeclared frontmatter fields {sorted(extra)}")
            for field, ref_dir in REF_DIRS.items():
                for name in fm.get(field, []) if isinstance(fm.get(field), list) else []:
                    if not (brain_dir / ref_dir / f"{Path(name).stem}.md").is_file():
                        violations.append(f"{rel}: {field} references {name}, but {ref_dir}/ has no matching file")

    if brain_md in texts:
        brain_fm = parse_frontmatter(texts[brain_md])
        extra = set(brain_fm) - BRAIN_FIELDS
        if extra:
            violations.append(f"BRAIN.md: undeclared frontmatter fields {sorted(extra)}")
        version = brain_fm.get("version")
        if not isinstance(version, str) or not version.isdigit() or int(version) < 1:
            violations.append("BRAIN.md: version must be an integer greater than or equal to 1")
        uuid = brain_fm.get("uuid")
        if not isinstance(uuid, str) or UUID_RE.fullmatch(uuid) is None:
            violations.append("BRAIN.md: uuid must be a UUID v4")

    # same stem in more than one type dir: wikilinks resolve by stem alone,
    # so two pages sharing a slug are ambiguous even if their content differs
    for stem, dirs in sorted(stem_to_dirs.items()):
        if len(dirs) > 1:
            violations.append(f"file-stem collision: {stem}.md exists in {', '.join(sorted(dirs))}")

    # violates <-> violated_by symmetry
    events = by_dir.get("events", {})
    claims = by_dir.get("claims", {})
    for ev, fm in events.items():
        for cl in fm.get("violates", []) if isinstance(fm.get("violates"), list) else []:
            back = claims.get(stem_of(cl), {}).get("violated_by", [])
            if ev not in [stem_of(x) for x in back if isinstance(back, list)]:
                violations.append(f"events/{ev}.md: violates {cl}, but the claim does not list the event in violated_by")
    for cl, fm in claims.items():
        for ev in fm.get("violated_by", []) if isinstance(fm.get("violated_by"), list) else []:
            fwd = events.get(stem_of(ev), {}).get("violates", [])
            if cl not in [stem_of(x) for x in fwd if isinstance(fwd, list)]:
                violations.append(f"claims/{cl}.md: violated_by lists {ev}, but the event does not list the claim in violates")

    # orphans: every type-dir page must be linked from BRAIN.md
    if brain_md.is_file() and brain_md in texts:
        linked = {stem_of(t) for t in MD_LINK_RE.findall(texts[brain_md])}
        linked |= {stem_of(t) for t in WIKILINK_RE.findall(texts[brain_md])}
        for path in md_files:
            parts = path.relative_to(brain_dir).parts
            if len(parts) == 1 and path.stem.casefold() in ROOT_EXEMPT:
                continue
            if path.stem.casefold() not in linked:
                rel = path.relative_to(brain_dir).as_posix()
                violations.append(f"{rel}: orphan page not linked from BRAIN.md")

    return violations


def selftest() -> int:
    with tempfile.TemporaryDirectory() as td:
        # --- passing case ---
        # raw/, schema.md, README.md live outside output/ and are
        # never handed to lint(); only their sibling output/ is.
        brain = Path(td) / "ask-brain" / "demo"
        (brain / "raw").mkdir(parents=True)
        (brain / "raw" / "session-a.md").write_text("secret sk-aaaaaaaaaaaaaaa\n", encoding="utf-8")
        (brain / "schema.md").write_text("# schema\n\n- sources\n", encoding="utf-8")
        (brain / "README.md").write_text("raw/ is local-only.\n", encoding="utf-8")
        ok = brain / "output"
        for d in ("sources", "entities", "events", "claims"):
            (ok / d).mkdir(parents=True)
        (ok / "BRAIN.md").write_text(
            "---\nversion: 1\nuuid: 550e8400-e29b-41d4-a716-446655440000\n---\n# demo\n\n- [[session-a]] — one\n"
            "- [[claude-code]] — tool\n- [[night-fail]] — event\n- [[night-rule]] — claim\n",
            encoding="utf-8",
        )
        (ok / "sources" / "session-a.md").write_text("---\n---\nNight session summary.\n", encoding="utf-8")
        (ok / "entities" / "claude-code.md").write_text(
            "---\nsources: [session-a]\n---\nA CLI coding agent.\n", encoding="utf-8"
        )
        (ok / "events" / "night-fail.md").write_text(
            "---\ndate: 2026-08-14\nsources: [session-a]\nviolates: [night-rule]\n---\n"
            "## asked\n\nRefactor the feature.\n\n## outcome\n\nThe attempt failed and violated [[night-rule]].\n",
            encoding="utf-8",
        )
        (ok / "claims" / "night-rule.md").write_text(
            "---\nstated_on: 2026-08-02\nsources: [session-a]\n"
            "origin_events: [night-fail]\nviolated_by: [night-fail]\nsuperseded_by: []\n---\n"
            "Delegate at night only after completing the pattern manually during the day.\n",
            encoding="utf-8",
        )
        got = lint(ok)
        assert got == [], f"expected PASS, got: {got}"

        # --- failing case ---
        bad = Path(td) / "ask-brain" / "bad" / "output"
        for d in ("sources", "events", "claims"):
            (bad / d).mkdir(parents=True)
        (bad / "BRAIN.md").write_text(
            "---\nversion: zero\nuuid: not-a-uuid\nowner: someone\n---\n"
            "# bad\n\n- [[e1]]\n- [[c1]]\n",
            encoding="utf-8",
        )
        (bad / "events" / "e1.md").write_text(
            "---\ndate: 2026-08-14\nsources: [missing-src]\nviolates: [c1]\nmood: bad\n---\n"
            "See raw/session.md, contact foo@example.com, +1 415 555 0199,\n"
            "and open [[ghost-page]] from /Users/someone/proj.\n",
            encoding="utf-8",
        )
        (bad / "sources" / "dump.md").write_text(
            "# dump\n\n## User messages\n\n- `2026-08-14` copied verbatim\n" + "x" * 40_000 + "\n",
            encoding="utf-8",
        )
        (bad / "claims" / "c1.md").write_text(
            "---\nstated_on: 2026-08-02\nsources: []\norigin_events: []\n"
            "violated_by: []\nsuperseded_by: []\n---\nA grounded principle.\n",
            encoding="utf-8",
        )
        (bad / "sources" / "orphan-src.md").write_text("---\n---\nSummary.\n", encoding="utf-8")
        (bad / "entities").mkdir(parents=True)
        (bad / "entities" / "e1.md").write_text(
            "---\nsources: []\n---\nA different subject whose stem collides with events/e1.md.\n", encoding="utf-8"
        )
        joined = "\n".join(lint(bad))
        for needle in (
            "references a local raw/ path", "email", "phone number", "home-directory",
            "dead wiki link", "undeclared frontmatter fields", "no matching file",
            "does not list the event", "orphan page",
            "raw dump heading", "exceeds", "file-stem collision",
            "version must be an integer", "uuid must be a UUID v4", "BRAIN.md: undeclared",
        ):
            assert needle in joined, f"missing {needle!r} in:\n{joined}"

        # --- missing BRAIN.md ---
        empty = Path(td) / "ask-brain" / "empty" / "output"
        empty.mkdir(parents=True)
        assert any("BRAIN.md is missing" in v for v in lint(empty))

    print("selftest OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("brain_dir", type=Path, nargs="?")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return selftest()
    if args.brain_dir is None:
        parser.error("brain_dir is required unless --selftest is given")

    violations = lint(args.brain_dir)
    if not violations:
        print("PASS")
        return 0
    for violation in violations:
        print(violation)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
