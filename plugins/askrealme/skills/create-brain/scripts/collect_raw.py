#!/usr/bin/env python3
"""Collect immutable local source records for create-brain.

The raw directory is a private source corpus:

* ``discover`` lists native conversation originals without copying them;
* ``read`` normalizes one upstream source once, optionally stages that exact
  JSONL, and renders the normalized events on stdout;
* ``retain`` stores one relevant staged conversation without reopening its
  upstream source;
* ``split-normalized`` partitions an oversized staged session at event bounds;
* ``cleanup-staged`` removes only explicitly named temporary JSONL files;
* ``add`` copies owner-supplied text files without rewriting them;
* ``index`` registers text files placed manually under ``raw/files``;
* ``verify`` checks index coverage and hashes.

Conversation discovery reuses the create-brain base extractor. Work directory
metadata is recorded for provenance but is never a collection gate.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType

BASE_SCRIPT = Path(__file__).with_name("extract_raw.py")
INDEX_NAME = "index.jsonl"
FILES_DIR = "files"
NORMALIZED_SESSION_FORMAT = "askrealme-normalized-session-v1"
NORMALIZED_EVENT_ROLES = frozenset({"user", "assistant", "tool", "tool_result"})
NORMALIZED_EVENT_KEYS = frozenset({"timestamp", "role", "tool", "content", "partial"})
DEFAULT_BATCH_BYTES = 1_572_864
SELF_CONTAINED_PROVIDERS = frozenset(
    {"claude", "codex", "grok", "cursor", "pi", "openclaw", "hermes"}
)
TEXT_SUFFIXES = frozenset(
    {
        ".csv",
        ".diff",
        ".json",
        ".jsonl",
        ".markdown",
        ".md",
        ".patch",
        ".toml",
        ".tsv",
        ".txt",
        ".yaml",
        ".yml",
    }
)
VALID_KINDS = frozenset({"conversation", "document"})
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
SAFE_SLUG_RE = re.compile(r"[^A-Za-z0-9]+")
SOURCE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SECRET_RE = re.compile(
    r"(?isx)"
    r"(?:bearer\s+)[a-z0-9._~+/=-]{12,}|"
    r"(?:sk|ghp|glpat|xox[baprs])[-_][a-z0-9_-]{12,}|"
    r"(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+|"
    r"-----BEGIN [A-Z ]+PRIVATE KEY-----.*?-----END [A-Z ]+PRIVATE KEY-----"
)
EMAIL_RE = re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d .()-]{7,}\d)(?!\d)")
HOME_RE = re.compile(r"/(?:Users|home)/[^/\s]+")
USER_RE = re.compile(re.escape(Path.home().name))
INTERNAL_BLOCK_RE = re.compile(
    r"(?s)<(?:codex_internal_context|environment_context|skill)>"
    r".*?</(?:codex_internal_context|environment_context|skill)>"
)
MACHINE_BLOCK_RE = re.compile(
    r"(?is)<(?P<tag>task-id|tool-use-id|system-reminder|command-name|"
    r"local-command-stdout|task-notification)(?:\s[^<>]*?)?>"
    r".*?</(?P=tag)\s*>"
)
TOOL_DETAIL_CAP = 12_000
TOOL_DETAIL_TRUNCATION = "\n… tool details truncated …\n"
TOOL_RESULT_TRUNCATION = "… tool result truncated …"
MAX_DIGEST_CHARS = 80_000
SESSION_PART_BODY_CHARS = MAX_DIGEST_CHARS - 2_000
EVENT_FRAGMENT_CHARS = SESSION_PART_BODY_CHARS - 500


def load_base() -> ModuleType:
    sys.path.insert(0, str(BASE_SCRIPT.parent))
    import extract_raw

    return extract_raw


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def file_time(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_component(value: str, fallback: str = "source") -> str:
    cleaned = SAFE_NAME_RE.sub("-", value).strip("-._").lower()
    return cleaned or fallback


def safe_slug(value: str, fallback: str = "source") -> str:
    cleaned = SAFE_SLUG_RE.sub("-", value).strip("-").lower()
    return cleaned or fallback


def source_id(kind: str, provider: str | None, raw_path: str) -> str:
    rel = Path(raw_path)
    if kind == "conversation":
        if provider == "grok" and len(rel.parts) >= 3:
            stem = rel.parts[-2]
        else:
            stem = rel.stem
        prefix = provider or "conversation"
        base = safe_slug(f"{prefix}-{stem}")
    else:
        without_suffix = rel.with_suffix("").as_posix().replace("/", "-")
        base = safe_slug(without_suffix)
    fingerprint = hashlib.sha256(f"{kind}\0{provider or ''}\0{raw_path}".encode()).hexdigest()[:10]
    return f"{base[:90]}-{fingerprint}"


def read_index(raw_dir: Path) -> list[dict]:
    index = raw_dir / INDEX_NAME
    if not index.exists():
        return []
    records: list[dict] = []
    with index.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{index}:{line_number}: invalid JSON ({exc.msg})") from exc
            if not isinstance(record, dict):
                raise ValueError(f"{index}:{line_number}: expected a JSON object")
            records.append(record)
    return records


def record_key(record: dict) -> tuple[str, str]:
    return str(record.get("raw_path") or ""), str(record.get("source_ref") or "")


def write_index(raw_dir: Path, records: list[dict]) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    target = raw_dir / INDEX_NAME
    unique: dict[tuple[str, str], dict] = {}
    for record in records:
        unique[record_key(record)] = record
    ordered = sorted(
        unique.values(),
        key=lambda item: (str(item.get("raw_path")), str(item.get("id"))),
    )
    handle, temp_name = tempfile.mkstemp(prefix=".index-", suffix=".jsonl.tmp", dir=raw_dir)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as output:
            for record in ordered:
                record = {
                    key: value
                    for key, value in record.items()
                    if key not in {"status", "reason"}
                }
                output.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, target)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


@contextmanager
def locked_index(raw_dir: Path):
    """Serialize cross-process index read-modify-write operations."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    lock_path = raw_dir.parent / f".{raw_dir.name}-index.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def choose_target(raw_dir: Path, relative: Path, digest: str) -> Path:
    target = raw_dir / relative
    if not target.exists() or sha256_file(target) == digest:
        return target
    return target.with_name(f"{target.stem}-{digest[:10]}{target.suffix}")


def native_session_id(base: ModuleType, provider: str, path: Path) -> str:
    if provider == "grok":
        return path.parent.name
    if provider == "codex":
        first = base.first_jsonl_object(path)
        payload = first.get("payload") if isinstance(first.get("payload"), dict) else {}
        native_id = payload.get("id") or payload.get("session_id")
        if native_id:
            return str(native_id)
    return path.stem


def session_relative_path(base: ModuleType, provider: str, path: Path) -> Path:
    session_id = safe_component(native_session_id(base, provider, path), "session")
    if provider == "grok":
        return Path(provider) / session_id / "chat_history.jsonl"
    return Path(provider) / f"{session_id}{path.suffix.lower()}"


def copy_and_record(
    raw_dir: Path,
    source: Path,
    relative: Path,
    *,
    kind: str,
    provider: str | None,
    cwd: str | None,
    source_id_value: str | None = None,
) -> dict:
    digest = sha256_file(source)
    target = choose_target(raw_dir, relative, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copy2(source, target)
    raw_path = target.relative_to(raw_dir).as_posix()
    record = {
        "bytes": target.stat().st_size,
        "captured_at": utc_now(),
        "id": source_id_value or source_id(kind, provider, raw_path),
        "kind": kind,
        "original_path": str(source.resolve()),
        "raw_path": raw_path,
        "sha256": digest,
        "source_modified_at": file_time(source),
    }
    if provider:
        record["provider"] = provider
    if cwd:
        record["cwd"] = cwd
    return record


def merge_records(existing: list[dict], additions: list[dict]) -> list[dict]:
    merged = {str(record.get("id") or record_key(record)): record for record in existing}
    for addition in additions:
        key = str(addition.get("id") or record_key(addition))
        previous = merged.get(key)
        if previous:
            addition["captured_at"] = previous.get("captured_at", addition["captured_at"])
        merged[key] = addition
    return list(merged.values())


def discovered_conversations(base: ModuleType) -> tuple[list[dict], int]:
    records: list[dict] = []
    skipped = 0
    seen_origins: set[Path] = set()
    for cwd, provider, paths in base.all_groups():
        if provider not in SELF_CONTAINED_PROVIDERS:
            continue
        for path in paths:
            try:
                origin = path.expanduser().resolve()
                if origin in seen_origins:
                    continue
                seen_origins.add(origin)
                relative = session_relative_path(base, provider, origin)
                records.append(
                    {
                        "cwd": cwd,
                        "id": source_id("conversation", provider, relative.as_posix()),
                        "kind": "conversation",
                        "original_path": str(origin),
                        "provider": provider,
                        "raw_path": relative.as_posix(),
                        "source_modified_at": file_time(origin),
                    }
                )
            except (OSError, UnicodeError):
                skipped += 1
    return records, skipped


def original_from_args(base: ModuleType, args: argparse.Namespace) -> dict:
    path = Path(args.path).expanduser().resolve()
    provider = str(args.provider)
    if provider not in SELF_CONTAINED_PROVIDERS:
        raise ValueError(f"unsupported conversation provider: {provider}")
    if not path.is_file():
        raise ValueError(f"conversation source does not exist: {path}")
    relative = session_relative_path(base, provider, path)
    expected_id = source_id("conversation", provider, relative.as_posix())
    if args.id != expected_id:
        raise ValueError(f"source id does not match {path}")
    return {
        "cwd": args.cwd or "",
        "id": expected_id,
        "kind": "conversation",
        "original_path": str(path),
        "provider": provider,
        "raw_path": relative.as_posix(),
    }


def cmd_discover(base: ModuleType, args: argparse.Namespace) -> int:
    records, skipped = discovered_conversations(base)
    retained_ids = {
        str(record.get("id"))
        for record in read_index(Path(args.raw).expanduser().resolve())
        if record.get("kind") != "conversation"
        or record.get("format") == NORMALIZED_SESSION_FORMAT
    } if args.raw else set()
    records = [record for record in records if record["id"] not in retained_ids]
    print(json.dumps({"sources": records, "skipped": skipped, "sqlite_sessions_not_read": base.count_sqlite_sessions()}, ensure_ascii=False))
    return 0


def cmd_read(base: ModuleType, args: argparse.Namespace) -> int:
    raw_dir = Path(args.raw).expanduser().resolve() if args.raw else None
    record = None
    if raw_dir is not None:
        record = next((item for item in read_index(raw_dir) if item.get("id") == args.id), None)
    if record is not None:
        if record.get("kind") == "document":
            blocks = [render_document(raw_dir, record)]
        else:
            events = read_normalized_session(raw_dir / str(record["raw_path"]))
            blocks = render_conversation(record, events)
    else:
        if not args.path or not args.provider:
            raise ValueError("--path and --provider are required for an upstream source")
        record = original_from_args(base, args)
        events = normalize_conversation(base, record)
        if not events:
            raise ValueError("conversation has no normalized events")
        if args.normalized_output:
            staged = Path(args.normalized_output).expanduser().resolve()
            write_bytes_atomic(staged, normalized_session_bytes(events))
        blocks = render_conversation(record, events)
    sys.stdout.write("\n\n---\n\n".join(blocks))
    return 0


def cmd_retain(base: ModuleType, args: argparse.Namespace) -> int:
    raw_dir = Path(args.output).expanduser().resolve()
    candidate = original_from_args(base, args)
    staged = Path(args.normalized).expanduser().resolve()
    if not staged.is_file():
        raise ValueError(f"staged normalized session does not exist: {staged}")
    events = read_normalized_session(staged)
    record = write_normalized_conversation(raw_dir, candidate, events)
    with locked_index(raw_dir):
        existing = read_index(raw_dir)
        write_index(raw_dir, merge_records(existing, [record]))
        for previous in existing:
            if previous.get("id") != record["id"] or previous.get("raw_path") == record["raw_path"]:
                continue
            previous_path = raw_dir / str(previous.get("raw_path") or "")
            if previous_path.is_file() and previous_path.resolve().is_relative_to(raw_dir):
                previous_path.unlink()
    print(json.dumps(record, ensure_ascii=False))
    return 0


def cmd_split_normalized(args: argparse.Namespace) -> int:
    source = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    events = read_normalized_session(source)
    if not events:
        raise ValueError("normalized session has no events")
    if args.max_bytes < 1:
        raise ValueError("--max-bytes must be positive")

    windows: list[list[dict]] = []
    current: list[dict] = []
    current_bytes = 0
    for event in events:
        event_bytes = len(normalized_session_bytes([event]))
        if current and current_bytes + event_bytes > args.max_bytes:
            windows.append(current)
            current = []
            current_bytes = 0
        current.append(event)
        current_bytes += event_bytes
    if current:
        windows.append(current)

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    event_start = 0
    for index, window in enumerate(windows, start=1):
        payload = normalized_session_bytes(window)
        target = output_dir / f"{source.stem}.part-{index:03d}.jsonl"
        write_bytes_atomic(target, payload)
        event_end = event_start + len(window) - 1
        manifest.append(
            {
                "bytes": len(payload),
                "event_end": event_end,
                "event_start": event_start,
                "path": str(target),
            }
        )
        event_start = event_end + 1
    print(json.dumps({"source": str(source), "windows": manifest}, ensure_ascii=False))
    return 0


def cmd_cleanup_staged(args: argparse.Namespace) -> int:
    removed = []
    missing = []
    for value in args.path:
        target = Path(value).expanduser().resolve()
        if target.suffix != ".jsonl":
            raise ValueError(f"staged path must be a .jsonl file: {target}")
        if target.is_symlink():
            raise ValueError(f"staged path must not be a symbolic link: {target}")
        if target.exists() and not target.is_file():
            raise ValueError(f"staged path is not a file: {target}")
        if target.is_file():
            target.unlink()
            removed.append(str(target))
        else:
            missing.append(str(target))
    print(json.dumps({"missing": missing, "removed": removed}, ensure_ascii=False))
    return 0


def iter_text_files(path: Path) -> list[tuple[Path, Path]]:
    if path.is_symlink():
        raise ValueError(f"symbolic links are not accepted: {path}")
    if path.is_file():
        if path.suffix.casefold() not in TEXT_SUFFIXES:
            raise ValueError(f"unsupported text source type: {path.suffix or '(none)'}")
        return [(path, Path(path.name))]
    if not path.is_dir():
        raise ValueError(f"source path does not exist: {path}")
    files: list[tuple[Path, Path]] = []
    for source in sorted(path.rglob("*")):
        if source.is_symlink() or not source.is_file():
            continue
        if source.suffix.casefold() in TEXT_SUFFIXES:
            files.append((source, source.relative_to(path)))
    if not files:
        raise ValueError(f"no supported text files found under: {path}")
    return files


def cmd_add(args: argparse.Namespace) -> int:
    raw_dir = Path(args.output).expanduser().resolve()
    existing = read_index(raw_dir)
    existing_ids = {str(record.get("id")) for record in existing}
    additions: list[dict] = []
    for value in args.path:
        root = Path(value).expanduser().resolve()
        if root.is_relative_to(raw_dir) or (root.is_dir() and raw_dir.is_relative_to(root)):
            raise ValueError(f"source path must not contain or be inside raw/: {root}")
        collection = safe_component(root.stem if root.is_file() else root.name)
        collection_hash = hashlib.sha256(str(root).encode()).hexdigest()[:10]
        for source, relative in iter_text_files(root):
            additions.append(
                copy_and_record(
                    raw_dir,
                    source,
                    Path(FILES_DIR) / f"{collection}-{collection_hash}" / relative,
                    kind="document",
                    provider=None,
                    cwd=None,
                )
            )
    records = merge_records(existing, additions)
    write_index(raw_dir, records)
    new_ids = [record["id"] for record in additions if record["id"] not in existing_ids]
    print(
        json.dumps(
            {
                "output": str(raw_dir),
                "files": len(additions),
                "ids": new_ids,
            },
            ensure_ascii=False,
        )
    )
    return 0


def cmd_index(raw_dir: Path) -> int:
    raw_dir = raw_dir.expanduser().resolve()
    existing = read_index(raw_dir)
    known = {record_key(record) for record in existing}
    additions: list[dict] = []
    files_root = raw_dir / FILES_DIR
    if files_root.is_dir():
        try:
            found = iter_text_files(files_root)
        except ValueError:
            found = []
        for source, _ in found:
            raw_path = source.relative_to(raw_dir).as_posix()
            if (raw_path, "") in known:
                continue
            additions.append(
                {
                    "bytes": source.stat().st_size,
                    "captured_at": utc_now(),
                    "id": source_id("document", None, raw_path),
                    "kind": "document",
                    "raw_path": raw_path,
                    "sha256": sha256_file(source),
                    "source_modified_at": file_time(source),
                }
            )
    write_index(raw_dir, merge_records(existing, additions))
    print(
        json.dumps(
            {
                "output": str(raw_dir),
                "indexed": len(additions),
                "ids": [record["id"] for record in additions],
            },
            ensure_ascii=False,
        )
    )
    return 0


def scrub(text: str) -> str:
    text = INTERNAL_BLOCK_RE.sub("[internal context removed]", text)
    text = SECRET_RE.sub("[secret removed]", text)
    text = EMAIL_RE.sub("[email removed]", text)
    text = PHONE_RE.sub("[phone number removed]", text)
    text = HOME_RE.sub("$HOME", text)
    return USER_RE.sub("$USER", text)


def bounded_tool_details(text: str) -> str:
    cleaned = scrub(text).strip()
    if len(cleaned) <= TOOL_DETAIL_CAP:
        return cleaned
    half = (TOOL_DETAIL_CAP - len(TOOL_DETAIL_TRUNCATION)) // 2
    return f"{cleaned[:half]}{TOOL_DETAIL_TRUNCATION}{cleaned[-half:]}"


def strip_machine_blocks(text: str) -> str:
    """Remove only known, fully closed machine wrapper blocks.

    Text outside a matched block remains in place. Unknown or malformed wrappers
    fail open so preparation never discards an owner's words by guessing.
    """

    previous = None
    while previous != text:
        previous = text
        text = MACHINE_BLOCK_RE.sub("", text)
    return text


def split_text_exact(text: str, limit: int) -> list[str]:
    """Split text at readable boundaries without omission or overlap."""

    if limit <= 0:
        raise ValueError("split limit must be positive")
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    offset = 0
    while len(text) - offset > limit:
        window = text[offset : offset + limit]
        candidates = [
            window.rfind("\n\n"),
            window.rfind("\n"),
            window.rfind(" "),
        ]
        boundary = max(candidates)
        if boundary < limit // 2:
            cut = limit
        elif window.startswith("\n\n", boundary):
            cut = boundary + 2
        else:
            cut = boundary + 1
        chunks.append(text[offset : offset + cut])
        offset += cut
    chunks.append(text[offset:])
    if "".join(chunks) != text:
        raise AssertionError("text splitting must preserve exact coverage")
    return chunks


def event_details(item: dict) -> tuple[str, bool]:
    role = str(item.get("role") or "unknown")
    text = item.get("text")
    tool = item.get("tool")
    if role == "tool":
        if item.get("input"):
            details = f"{tool} {json.dumps(item.get('input'), ensure_ascii=False)}"
        else:
            details = str(tool or "unknown")
        return bounded_tool_details(details), False
    if role == "tool_result":
        cleaned = scrub(str(text)).strip() if isinstance(text, str) else ""
        if not cleaned:
            return "", False
        prefix = f"Tool: {tool or 'unknown'}\n\n"
        return prefix + cleaned, TOOL_RESULT_TRUNCATION in cleaned
    if not isinstance(text, str):
        return "", False
    if role == "user":
        text = strip_machine_blocks(text)
    return scrub(text).strip(), False


def normalize_event(item: dict) -> dict | None:
    role = str(item.get("role") or "")
    if role not in NORMALIZED_EVENT_ROLES:
        return None
    content, partial = event_details(item)
    if not content:
        return None
    normalized = {
        "content": content,
        "role": role,
        "timestamp": str(item.get("ts") or ""),
    }
    tool = item.get("tool")
    if isinstance(tool, str) and tool:
        normalized["tool"] = scrub(tool)
    if partial:
        normalized["partial"] = True
    return normalized


def normalize_conversation(base: ModuleType, record: dict) -> list[dict]:
    provider = str(record.get("provider") or "")
    parser = base.PARSERS.get(provider)
    if parser is None:
        raise ValueError(f"no parser for provider {provider!r}")
    path = Path(str(record.get("original_path") or "")).expanduser().resolve()
    events = parser(path, str(record.get("cwd") or ""))
    return [normalized for item in events if (normalized := normalize_event(item))]


def normalized_session_bytes(events: list[dict]) -> bytes:
    return b"".join(
        (json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
        for event in events
    )


def write_bytes_atomic(target: Path, payload: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(
        prefix=f".{target.stem}-", suffix=f"{target.suffix}.tmp", dir=target.parent
    )
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, target)
    except Exception:
        Path(temp_name).unlink(missing_ok=True)
        raise


def read_normalized_session(path: Path) -> list[dict]:
    events: list[dict] = []
    with path.open(encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{path}:{line_number}: invalid normalized JSON ({exc.msg})"
                ) from exc
            if not isinstance(event, dict) or not set(event).issubset(NORMALIZED_EVENT_KEYS):
                raise ValueError(f"{path}:{line_number}: invalid normalized event fields")
            if event.get("role") not in NORMALIZED_EVENT_ROLES:
                raise ValueError(f"{path}:{line_number}: invalid normalized event role")
            if not isinstance(event.get("timestamp"), str) or not isinstance(
                event.get("content"), str
            ):
                raise ValueError(f"{path}:{line_number}: invalid normalized event content")
            if "tool" in event and not isinstance(event["tool"], str):
                raise ValueError(f"{path}:{line_number}: invalid normalized tool name")
            if "partial" in event and event["partial"] is not True:
                raise ValueError(f"{path}:{line_number}: invalid normalized partial flag")
            events.append(event)
    return events


def write_normalized_conversation(raw_dir: Path, candidate: dict, events: list[dict]) -> dict:
    if not events:
        raise ValueError("conversation has no normalized events")
    payload = normalized_session_bytes(events)
    digest = sha256_bytes(payload)
    relative = Path(str(candidate["provider"])) / f"{candidate['id']}.jsonl"
    target = raw_dir / relative
    write_bytes_atomic(target, payload)
    original = Path(str(candidate["original_path"]))
    return {
        "bytes": len(payload),
        "captured_at": utc_now(),
        "cwd": str(candidate.get("cwd") or ""),
        "format": NORMALIZED_SESSION_FORMAT,
        "id": str(candidate["id"]),
        "kind": "conversation",
        "original_path": str(original),
        "provider": str(candidate["provider"]),
        "raw_path": relative.as_posix(),
        "sha256": digest,
        "source_modified_at": file_time(original),
    }


def render_event_fragments(source_id_value: str, event_index: int, item: dict) -> list[str]:
    details = str(item.get("content") or "").strip()
    partial = item.get("partial") is True
    if not details:
        return []
    fragments = split_text_exact(details, EVENT_FRAGMENT_CHARS)
    rendered: list[str] = []
    for fragment_index, fragment in enumerate(fragments, start=1):
        lines = [
            (
                f"### Event {event_index} · "
                f"{item.get('timestamp') or 'time unavailable'} · "
                f"{item.get('role') or 'unknown'}"
            ),
            "",
            f"- Raw locator: {source_id_value}#event-{event_index}",
        ]
        if len(fragments) > 1:
            lines.append(f"- Event fragment: {fragment_index}/{len(fragments)}")
        if partial:
            lines.append("- Partial: true")
        lines.extend(("", fragment, ""))
        rendered.append("\n".join(lines))
    return rendered


def conversation_header(
    record: dict,
    provider: str,
    part_number: int,
    part_total: int,
    event_start: int | None,
    event_end: int | None,
) -> str:
    event_range = "none" if event_start is None else f"{event_start}–{event_end}"
    return "\n".join(
        [
            f"# {record['id']} · part {part_number:03d}/{part_total:03d}",
            "",
            f"- Source ID: {record['id']}",
            "- Kind: conversation",
            f"- Provider: {provider}",
            f"- Work directory: {scrub(str(record.get('cwd') or 'unknown'))}",
            f"- Part: {part_number}/{part_total}",
            f"- Event index range: {event_range}",
            "",
            "## Events",
            "",
        ]
    )


def render_conversation(record: dict, events: list[dict]) -> list[str]:
    provider = str(record.get("provider") or "")
    units: list[tuple[int, str]] = []
    for event_index, item in enumerate(events):
        units.extend(
            (event_index, fragment)
            for fragment in render_event_fragments(str(record["id"]), event_index, item)
        )

    groups: list[list[tuple[int, str]]] = []
    current: list[tuple[int, str]] = []
    current_size = 0
    for event_index, block in units:
        extra = len(block) + (1 if current else 0)
        if current and current_size + extra > SESSION_PART_BODY_CHARS:
            groups.append(current)
            current = []
            current_size = 0
            extra = len(block)
        current.append((event_index, block))
        current_size += extra
    if current or not groups:
        groups.append(current)

    rendered: list[str] = []
    part_total = len(groups)
    for part_number, group in enumerate(groups, start=1):
        event_start = group[0][0] if group else None
        event_end = group[-1][0] if group else None
        header = conversation_header(
            record,
            provider,
            part_number,
            part_total,
            event_start,
            event_end,
        )
        body = "\n".join(block for _, block in group).rstrip()
        rendered.append(f"{header}{body}\n" if body else f"{header.rstrip()}\n")
    return rendered


def render_document(raw_dir: Path, record: dict) -> str:
    path = raw_dir / str(record["raw_path"])
    text = scrub(path.read_text(encoding="utf-8")).strip()
    return (
        f"# {record['id']}\n\n"
        f"- Source ID: {record['id']}\n"
        "- Kind: document\n\n"
        f"## Content\n\n{text}\n"
    )


def cmd_verify(raw_dir: Path) -> int:
    raw_dir = raw_dir.expanduser().resolve()
    violations: list[str] = []
    try:
        records = read_index(raw_dir)
    except ValueError as exc:
        print(exc)
        return 1
    ids: set[str] = set()
    keys: set[tuple[str, str]] = set()
    indexed_paths: set[str] = set()
    for record in records:
        source = str(record.get("id") or "")
        raw_path = str(record.get("raw_path") or "")
        if not source or source in ids:
            violations.append(f"duplicate or missing source id: {source or '(missing)'}")
        ids.add(source)
        if SOURCE_ID_RE.fullmatch(source) is None:
            violations.append(f"{source or '(missing)'}: source id must be lowercase kebab-case")
        key = record_key(record)
        if key in keys:
            violations.append(f"{source}: duplicate raw record for {raw_path}")
        keys.add(key)
        if record.get("kind") not in VALID_KINDS:
            violations.append(f"{source}: invalid kind {record.get('kind')!r}")
        if (
            record.get("kind") == "conversation"
            and record.get("provider") not in SELF_CONTAINED_PROVIDERS
        ):
            violations.append(f"{source}: unsupported conversation provider")
        if (
            record.get("kind") == "conversation"
            and record.get("format") != NORMALIZED_SESSION_FORMAT
        ):
            violations.append(f"{source}: invalid normalized conversation format")
        if SHA256_RE.fullmatch(str(record.get("sha256") or "")) is None:
            violations.append(f"{source}: invalid sha256")
        path = raw_dir / raw_path
        try:
            if not path.resolve().is_relative_to(raw_dir):
                violations.append(f"{source}: raw_path escapes raw/: {raw_path}")
                continue
        except OSError:
            violations.append(f"{source}: invalid raw_path: {raw_path}")
            continue
        indexed_paths.add(raw_path)
        if path.is_symlink():
            violations.append(f"{source}: symbolic links are not allowed in raw/: {raw_path}")
            continue
        if not path.is_file():
            violations.append(f"{source}: missing file {raw_path}")
            continue
        if record.get("bytes") != path.stat().st_size:
            violations.append(f"{source}: byte count mismatch for {raw_path}")
        digest = sha256_file(path)
        if digest != record.get("sha256"):
            violations.append(f"{source}: sha256 mismatch for {raw_path}")
        if record.get("kind") == "conversation":
            try:
                read_normalized_session(path)
            except ValueError as exc:
                violations.append(str(exc))
    for path in sorted(raw_dir.rglob("*")):
        if path.is_symlink():
            rel = path.relative_to(raw_dir).as_posix()
            if rel not in indexed_paths:
                violations.append(f"symbolic links are not allowed in raw/: {rel}")
            continue
        if not path.is_file() or path.name == INDEX_NAME:
            continue
        rel = path.relative_to(raw_dir).as_posix()
        if rel not in indexed_paths:
            violations.append(f"unindexed raw file: {rel}")
    for forbidden in (raw_dir / "_digest", raw_dir / "cards.md"):
        if forbidden.exists():
            violations.append(f"derived artifact is not allowed in raw/: {forbidden.name}")
    if violations:
        for violation in violations:
            print(violation)
        return 1
    print(f"PASS ({len(records)} sources)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    discover = commands.add_parser("discover", help="list upstream native sessions without copying")
    discover.add_argument("--raw", help="omit source ids already retained in this raw directory")

    read = commands.add_parser(
        "read", help="render one source from canonical normalized events on stdout"
    )
    read.add_argument("--id", required=True, help="source id to read")
    read.add_argument("--raw", help="raw directory containing retained documents")
    read.add_argument("--path", help="upstream path returned by discover")
    read.add_argument("--provider", help="provider returned by discover")
    read.add_argument("--cwd", help="work directory returned by discover")
    read.add_argument(
        "--normalized-output",
        help="stage the exact normalized upstream JSONL used for this rendered read",
    )

    retain = commands.add_parser("retain", help="store one normalized relevant conversation in raw/")
    retain.add_argument("--id", required=True, help="discovered source id")
    retain.add_argument("--output", required=True, help="raw directory")
    retain.add_argument("--path", required=True, help="upstream path returned by discover")
    retain.add_argument("--provider", required=True, help="provider returned by discover")
    retain.add_argument("--cwd", help="work directory returned by discover")
    retain.add_argument(
        "--normalized",
        required=True,
        help="staged canonical normalized JSONL produced by read --normalized-output",
    )

    split_normalized = commands.add_parser(
        "split-normalized", help="split staged normalized JSONL at event boundaries"
    )
    split_normalized.add_argument("--input", required=True, help="staged normalized JSONL")
    split_normalized.add_argument("--output-dir", required=True, help="window output directory")
    split_normalized.add_argument(
        "--max-bytes", type=int, default=DEFAULT_BATCH_BYTES, help="maximum bytes per window"
    )

    cleanup_staged = commands.add_parser(
        "cleanup-staged", help="remove explicitly named temporary JSONL files"
    )
    cleanup_staged.add_argument(
        "--path", action="append", required=True, help="temporary JSONL path (repeatable)"
    )

    add = commands.add_parser("add", help="copy owner-supplied text files into raw/files/")
    add.add_argument(
        "--path", action="append", required=True, help="file or directory (repeatable)"
    )
    add.add_argument("--output", required=True, help="raw directory")

    index = commands.add_parser("index", help="index files placed manually under raw/files/")
    index.add_argument("--output", required=True, help="raw directory")

    verify = commands.add_parser("verify", help="verify raw index coverage and hashes")
    verify.add_argument("--output", required=True, help="raw directory")

    args = parser.parse_args()
    try:
        if args.command == "cleanup-staged":
            return cmd_cleanup_staged(args)
        if args.command == "split-normalized":
            return cmd_split_normalized(args)
        if args.command == "index":
            return cmd_index(Path(args.output))
        if args.command == "add":
            return cmd_add(args)
        if args.command == "verify":
            return cmd_verify(Path(args.output))
        base = load_base()
        if args.command == "discover":
            return cmd_discover(base, args)
        if args.command == "read":
            return cmd_read(base, args)
        return cmd_retain(base, args)
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"{args.command} failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
