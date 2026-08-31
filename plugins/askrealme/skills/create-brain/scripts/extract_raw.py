"""Session-store discovery and parsers used by collect_raw.py.

Do not generate a replacement parser. Agents import this file via collect_raw.

  python3 extract_raw.py --self-check
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sqlite3
import sys
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
DOWNLOADS = HOME / "Downloads"
FILE_MUTATION_TOOL_SUFFIXES = frozenset(
    {
        "applypatch",
        "createfile",
        "edit",
        "editfile",
        "multiedit",
        "patch",
        "replaceinfile",
        "searchreplace",
        "strreplace",
        "strreplaceeditor",
        "write",
        "writefile",
        "writetofile",
    }
)
PATH_INPUT_KEYS = ("path", "file_path", "target_file", "target", "filename")
SKIP_TEXT_TYPES = frozenset({"thinking", "reasoning", "image"})
TOOL_RESULT_TYPES = frozenset(
    {
        "tool_result",
        "toolResult",
        "function_call_output",
        "custom_tool_call_output",
    }
)
TOOL_RESULT_MAX_CHARS = 12_000
VERIFICATION_SIGNAL = re.compile(
    r"(?i)(?:\b(?:passed|failed|failure|error|errors|tests?|pytest|unittest|lint|"
    r"build|compiled?|exit[ _-]?code|return[ _-]?code|status)\b)"
)
VERIFICATION_TOOL_PARTS = frozenset(
    {
        "bash",
        "build",
        "check",
        "compile",
        "doctor",
        "exec",
        "lint",
        "pytest",
        "shell",
        "terminal",
        "test",
        "tests",
        "typecheck",
        "unittest",
        "validate",
        "verify",
    }
)
RETRIEVAL_TOOL_PARTS = frozenset(
    {
        "edit",
        "fetch",
        "find",
        "glob",
        "grep",
        "image",
        "list",
        "open",
        "patch",
        "read",
        "replace",
        "screenshot",
        "search",
        "web",
        "write",
    }
)


class CorruptSessionError(ValueError):
    """A selected conversation record could not be decoded completely."""


def iter_jsonl_objects(path: Path) -> Iterator[dict]:
    with path.open(encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise CorruptSessionError(
                    f"{path}:{line_number}: invalid JSON ({exc.msg})"
                ) from exc
            if not isinstance(obj, dict):
                raise CorruptSessionError(
                    f"{path}:{line_number}: expected a JSON object"
                )
            yield obj


def read_json_object(path: Path) -> dict:
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CorruptSessionError(f"{path}: invalid JSON ({exc.msg})") from exc
    if not isinstance(obj, dict):
        raise CorruptSessionError(f"{path}: expected a JSON object")
    return obj


def decode_stored_json(raw: object, location: str) -> object:
    if not isinstance(raw, (str, bytes, bytearray)):
        raise CorruptSessionError(
            f"{location}: invalid JSON (expected text or bytes, got {type(raw).__name__})"
        )
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        detail = exc.msg if isinstance(exc, json.JSONDecodeError) else str(exc)
        raise CorruptSessionError(f"{location}: invalid JSON ({detail})") from exc


def first_jsonl_object(path: Path) -> dict:
    try:
        return next(iter_jsonl_objects(path))
    except StopIteration as exc:
        raise CorruptSessionError(f"{path}: empty conversation log") from exc


def open_sqlite_read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def agent_roots(dotname: str) -> list[Path]:
    live, backup = HOME / dotname, DOWNLOADS / dotname
    if live.exists():
        return [live]
    if backup.exists():
        return [backup]
    return []


def decode_hyphen(name: str) -> str:
    s = name.strip("-")
    if not s.startswith(("Users-", "home-", "private-")):
        return name
    parts = s.split("-")
    acc = Path("/")
    i, n = 0, len(parts)
    while i < n:
        found = False
        for k in range(n - i, 0, -1):
            trial = acc / "-".join(parts[i : i + k])
            if trial.exists():
                acc = trial
                i += k
                found = True
                break
        if not found:
            acc = acc / "-".join(parts[i:])
            break
    return str(acc)


def iso_from(value: object, fallback: Path | None = None) -> str:
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e12 else value
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    if isinstance(value, str) and value:
        return value
    if fallback is not None:
        try:
            return datetime.fromtimestamp(
                fallback.stat().st_mtime, tz=timezone.utc
            ).strftime("%Y-%m-%dT%H:%M:%SZ")
        except OSError:
            pass
    return "unknown"


def parse_args_blob(raw: object) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, dict) else {"_raw": raw[:200]}
        except json.JSONDecodeError:
            try:
                obj = ast.literal_eval(raw)
                return obj if isinstance(obj, dict) else {"_raw": raw[:200]}
            except (ValueError, SyntaxError):
                return {"_raw": raw[:200]}
    return {}


def slim_input(tool: str, raw: object) -> dict:
    inp = parse_args_blob(raw)
    normalized_tool = "".join(char for char in tool.casefold() if char.isalnum())
    if any(normalized_tool.endswith(suffix) for suffix in FILE_MUTATION_TOOL_SUFFIXES):
        path = next((inp.get(key) for key in PATH_INPUT_KEYS if inp.get(key)), None)
        return {"path": path} if path else {}
    return inp


def tool_parts(tool: str) -> set[str]:
    return {part for part in re.split(r"[^a-z0-9]+", tool.casefold()) if part}


def is_verification_tool(tool: str) -> bool:
    parts = tool_parts(tool)
    normalized = "".join(parts)
    return bool(parts & VERIFICATION_TOOL_PARTS) or normalized in {
        "execcommand",
        "localcommand",
        "localshell",
        "runcommand",
        "runshell",
        "runtests",
    }


def is_retrieval_tool(tool: str) -> bool:
    return bool(tool_parts(tool) & RETRIEVAL_TOOL_PARTS)


def result_text(raw: object) -> str | None:
    """Extract bounded human-readable evidence without serializing whole payloads."""

    parts: list[str] = []

    def add(value: object, label: str | None = None) -> None:
        if value is None:
            return
        if isinstance(value, (bytes, bytearray)):
            value = value.decode("utf-8", errors="replace")
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned:
                parts.append(f"{label}: {cleaned}" if label else cleaned)
            return
        if isinstance(value, (int, float, bool)):
            parts.append(f"{label}: {value}" if label else str(value))
            return
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict) and item.get("type") in SKIP_TEXT_TYPES:
                    continue
                add(item)
            return
        if isinstance(value, dict):
            selected = False
            for key in ("status", "exit_code", "returncode", "code"):
                if key in value:
                    add(value[key], key)
                    selected = True
            for key in ("output", "stdout", "stderr", "result", "content", "text", "error", "message"):
                if key in value:
                    add(value[key], "error" if key == "error" else None)
                    selected = True
            if not selected and value:
                parts.append(json.dumps(value, ensure_ascii=False, sort_keys=True))

    add(raw)
    text = "\n".join(dict.fromkeys(parts)).strip()
    if not text:
        return None
    if len(text) <= TOOL_RESULT_MAX_CHARS:
        return text
    half = (TOOL_RESULT_MAX_CHARS - len("\n… tool result truncated …\n")) // 2
    return f"{text[:half]}\n… tool result truncated …\n{text[-half:]}"


def remember_tool(tool_names: dict[str, str], block: dict, name: str) -> None:
    for key in ("id", "call_id", "callID", "toolCallId", "tool_use_id"):
        value = block.get(key)
        if value:
            tool_names[str(value)] = name
    tool_names[""] = name


def resolve_result_tool(tool_names: dict[str, str], block: dict) -> str:
    explicit = block.get("name") or block.get("tool") or block.get("tool_name")
    if explicit:
        return str(explicit)
    for key in ("tool_use_id", "toolCallId", "call_id", "callID", "id"):
        value = block.get(key)
        if value and str(value) in tool_names:
            return tool_names[str(value)]
    return tool_names.get("", "unknown")


def tool_result_event(
    session_id: str,
    cwd: str,
    ts: str,
    tool: str,
    raw: object,
) -> dict | None:
    text = result_text(raw)
    if not text:
        return None
    if is_retrieval_tool(tool) and not is_verification_tool(tool):
        return None
    if not is_verification_tool(tool) and not VERIFICATION_SIGNAL.search(text):
        return None
    return event(session_id, cwd, ts, "tool_result", text=text, tool=tool)


def event(
    session_id: str,
    cwd: str,
    ts: str,
    role: str,
    text: str | None = None,
    tool: str | None = None,
    inp: dict | None = None,
) -> dict:
    return {
        "session_id": session_id,
        "cwd": cwd,
        "ts": ts,
        "role": role,
        "text": text,
        "tool": tool,
        "input": inp,
    }


def walk_blocks(content: object) -> list[dict]:
    if isinstance(content, str) and content.strip():
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def from_blocks(
    session_id: str,
    cwd: str,
    ts: str,
    content: object,
    tool_names: dict[str, str] | None = None,
) -> list[dict]:
    tool_names = tool_names if tool_names is not None else {}
    out: list[dict] = []
    for b in walk_blocks(content):
        btype = b.get("type")
        if btype in SKIP_TEXT_TYPES:
            continue
        if btype in TOOL_RESULT_TYPES:
            name = resolve_result_tool(tool_names, b)
            raw = b.get("content") if "content" in b else b.get("output")
            result = tool_result_event(session_id, cwd, ts, name, raw)
            if result:
                out.append(result)
            continue
        if btype in ("text", "input_text", "output_text") and b.get("text"):
            out.append(event(session_id, cwd, ts, "assistant", text=str(b["text"])))
        elif btype in ("tool_use", "toolCall", "functionCall"):
            name = str(b.get("name") or b.get("tool") or "unknown")
            raw = b.get("input") if "input" in b else b.get("arguments")
            remember_tool(tool_names, b, name)
            out.append(
                event(session_id, cwd, ts, "tool", tool=name, inp=slim_input(name, raw))
            )
    return out


def results_from_blocks(
    session_id: str,
    cwd: str,
    ts: str,
    content: object,
    tool_names: dict[str, str],
) -> list[dict]:
    out: list[dict] = []
    for block in walk_blocks(content):
        if block.get("type") not in TOOL_RESULT_TYPES:
            continue
        name = resolve_result_tool(tool_names, block)
        raw = block.get("content") if "content" in block else block.get("output")
        result = tool_result_event(session_id, cwd, ts, name, raw)
        if result:
            out.append(result)
    return out


def user_text_from_blocks(content: object) -> str | None:
    parts: list[str] = []
    for b in walk_blocks(content):
        if b.get("type") in SKIP_TEXT_TYPES or b.get("type") in TOOL_RESULT_TYPES:
            continue
        if b.get("type") in (None, "text", "input_text") and b.get("text"):
            parts.append(str(b["text"]))
    if isinstance(content, str) and content.strip():
        return content
    return "\n".join(parts) if parts else None


# --- discovery ---


def claude_jsonl(project_dir: Path) -> list[Path]:
    files = list(project_dir.glob("*.jsonl"))
    for child in project_dir.glob("*/*.jsonl"):
        if child.parent.name == "subagents":
            continue
        files.append(child)
    return files


def peek_claude_cwd(files: list[Path]) -> str | None:
    if not files:
        return None
    newest = max(files, key=lambda p: p.stat().st_mtime if p.exists() else 0)
    for i, obj in enumerate(iter_jsonl_objects(newest)):
        if i > 40:
            break
        cwd = obj.get("cwd")
        if isinstance(cwd, str) and cwd.startswith("/"):
            return cwd
    return None


def iter_claude() -> list[tuple[str, str, list[Path]]]:
    rows = []
    for root in agent_roots(".claude"):
        proj = root / "projects"
        if not proj.is_dir():
            continue
        for d in proj.iterdir():
            if not d.is_dir():
                continue
            files = claude_jsonl(d)
            if not files:
                continue
            cwd = peek_claude_cwd(files) or decode_hyphen(d.name)
            rows.append((cwd, "claude", files))
    return rows


def iter_codex() -> list[tuple[str, str, list[Path]]]:
    by_cwd: dict[str, list[Path]] = defaultdict(list)
    for root in agent_roots(".codex"):
        sess = root / "sessions"
        if not sess.is_dir():
            continue
        for f in sess.rglob("rollout-*.jsonl"):
            obj = first_jsonl_object(f)
            payload = (
                obj.get("payload") if isinstance(obj.get("payload"), dict) else None
            )
            cwd = payload.get("cwd") if payload else None
            key = cwd if isinstance(cwd, str) and cwd else f"(codex:{f.name})"
            by_cwd[key].append(f)
    return [(cwd, "codex", files) for cwd, files in by_cwd.items()]


def iter_grok() -> list[tuple[str, str, list[Path]]]:
    rows = []
    for root in agent_roots(".grok"):
        sess = root / "sessions"
        if not sess.is_dir():
            continue
        for d in sess.iterdir():
            if not d.is_dir():
                continue
            cwd = urllib.parse.unquote(d.name)
            kids = [k for k in d.iterdir() if k.is_dir()]
            if kids:
                for k in kids:
                    hist = k / "chat_history.jsonl"
                    if hist.is_file():
                        rows.append((cwd, "grok", [hist]))
            else:
                hist = d / "chat_history.jsonl"
                if hist.is_file():
                    rows.append((cwd, "grok", [hist]))
    return rows


def iter_cursor() -> list[tuple[str, str, list[Path]]]:
    rows = []
    for root in agent_roots(".cursor"):
        proj = root / "projects"
        if not proj.is_dir():
            continue
        for d in proj.iterdir():
            if not d.is_dir():
                continue
            transcripts = d / "agent-transcripts"
            files = (
                [p for p in transcripts.rglob("*.jsonl") if "subagents" not in p.parts]
                if transcripts.is_dir()
                else []
            )
            if not files:
                continue
            cwd = (
                decode_hyphen(d.name)
                if d.name.startswith(("Users-", "home-"))
                else f"(cursor:{d.name})"
            )
            rows.append((cwd, "cursor", files))
    return rows


def iter_pi() -> list[tuple[str, str, list[Path]]]:
    rows = []
    for root in agent_roots(".pi"):
        sess = root / "agent" / "sessions"
        if not sess.is_dir():
            continue
        for d in sess.iterdir():
            if not d.is_dir():
                continue
            files = list(d.glob("*.jsonl"))
            if not files:
                continue
            obj = first_jsonl_object(files[0])
            cwd = obj.get("cwd") if isinstance(obj.get("cwd"), str) else None
            rows.append((cwd or decode_hyphen(d.name), "pi", files))
    return rows


def opencode_storages() -> list[Path]:
    seen: set[Path] = set()
    out = []
    for p in (
        HOME / ".local" / "share" / "opencode" / "storage",
        HOME / ".opencode" / "storage",
    ):
        if p.is_dir():
            r = p.resolve()
            if r not in seen:
                seen.add(r)
                out.append(p)
    return out


def iter_opencode() -> list[tuple[str, str, list[Path]]]:
    if any(
        database.is_file()
        for database in (
            HOME / ".local" / "share" / "opencode" / "opencode.db",
            HOME / ".opencode" / "opencode.db",
        )
    ):
        return []
    rows = []
    for storage in opencode_storages():
        sess_root = storage / "session"
        if not sess_root.is_dir():
            continue
        for f in sess_root.rglob("ses_*.json"):
            obj = read_json_object(f)
            cwd = obj.get("directory")
            key = cwd if isinstance(cwd, str) and cwd else f"(opencode:{f.stem[:12]})"
            rows.append((key, "opencode", [f]))
    return rows


def iter_openclaw() -> list[tuple[str, str, list[Path]]]:
    rows = []
    for root in agent_roots(".openclaw"):
        agents = root / "agents"
        if not agents.is_dir():
            continue
        for agent in agents.iterdir():
            if (agent / "agent" / "openclaw-agent.sqlite").is_file():
                continue
            sess = agent / "sessions"
            if not sess.is_dir():
                continue
            for f in sess.glob("*.jsonl"):
                cwd = f"(openclaw:{agent.name})"
                obj = first_jsonl_object(f)
                if isinstance(obj.get("cwd"), str):
                    cwd = obj["cwd"]
                rows.append((cwd, "openclaw", [f]))
    return rows


def iter_hermes() -> list[tuple[str, str, list[Path]]]:
    roots = agent_roots(".hermes")
    if any((root / "state.db").is_file() for root in roots):
        return []
    rows = []
    for root in roots:
        sess = root / "sessions"
        if not sess.is_dir():
            continue
        files = [p for p in sess.iterdir() if p.is_file() and p.suffix == ".json"]
        if files:
            rows.append(("(hermes)", "hermes", files))
    return rows


def count_sqlite_sessions() -> int:
    """Count SQLite-backed sessions that collect cannot normalize independently."""

    queries: list[tuple[Path, str]] = []
    for root in agent_roots(".hermes"):
        queries.append((root / "state.db", "SELECT count(*) FROM sessions"))
    for database in (
        HOME / ".local" / "share" / "opencode" / "opencode.db",
        HOME / ".opencode" / "opencode.db",
    ):
        queries.append((database, "SELECT count(*) FROM session"))
    for root in agent_roots(".openclaw"):
        agents = root / "agents"
        if agents.is_dir():
            queries.extend(
                (database, "SELECT count(DISTINCT session_id) FROM transcript_events")
                for database in agents.glob("*/agent/openclaw-agent.sqlite")
            )
    total = 0
    seen: set[Path] = set()
    for database, query in queries:
        if not database.is_file() or database.resolve() in seen:
            continue
        seen.add(database.resolve())
        with open_sqlite_read_only(database) as db:
            total += int(db.execute(query).fetchone()[0])
    return total


def all_groups() -> list[tuple[str, str, list[Path]]]:
    groups = []
    for fn in (
        iter_claude,
        iter_codex,
        iter_grok,
        iter_cursor,
        iter_pi,
        iter_opencode,
        iter_openclaw,
        iter_hermes,
    ):
        groups.extend(fn())
    return groups


# --- parsers ---


def parse_claude(path: Path, cwd: str) -> list[dict]:
    sid = path.stem
    out: list[dict] = []
    tool_names: dict[str, str] = {}
    for obj in iter_jsonl_objects(path):
        kind = obj.get("type")
        if kind not in ("user", "assistant"):
            continue
        ts = iso_from(obj.get("timestamp"), path)
        sid = str(obj.get("sessionId") or sid)
        cwd = str(obj.get("cwd") or cwd)
        msg = obj.get("message") if isinstance(obj.get("message"), dict) else {}
        role = msg.get("role") or kind
        content = msg.get("content")
        if role == "user":
            text = user_text_from_blocks(content)
            if text:
                out.append(event(sid, cwd, ts, "user", text=text))
            out.extend(results_from_blocks(sid, cwd, ts, content, tool_names))
            continue
        if role == "assistant":
            # from_blocks tags text as assistant; correct
            out.extend(from_blocks(sid, cwd, ts, content, tool_names))
    return out


def parse_cursor(path: Path, cwd: str) -> list[dict]:
    sid = path.stem
    out: list[dict] = []
    tool_names: dict[str, str] = {}
    ts = iso_from(None, path)
    for obj in iter_jsonl_objects(path):
        role = obj.get("role")
        msg = obj.get("message") if isinstance(obj.get("message"), dict) else {}
        content = msg.get("content")
        if role == "user":
            text = user_text_from_blocks(content)
            if text:
                out.append(event(sid, cwd, ts, "user", text=text))
            out.extend(results_from_blocks(sid, cwd, ts, content, tool_names))
        elif role == "assistant":
            out.extend(from_blocks(sid, cwd, ts, content, tool_names))
    return out


def parse_grok(path: Path, cwd: str) -> list[dict]:
    sid = path.parent.name
    out: list[dict] = []
    tool_names: dict[str, str] = {}
    ts = iso_from(None, path)
    for obj in iter_jsonl_objects(path):
        kind = obj.get("type")
        if kind == "user":
            text = user_text_from_blocks(obj.get("content"))
            if text:
                out.append(event(sid, cwd, ts, "user", text=text))
        elif kind == "assistant":
            text = obj.get("content")
            if isinstance(text, str) and text.strip():
                out.append(event(sid, cwd, ts, "assistant", text=text))
            elif isinstance(text, list):
                out.extend(from_blocks(sid, cwd, ts, text, tool_names))
            for tc in obj.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
                name = str(fn.get("name") or tc.get("name") or "unknown")
                raw = fn.get("arguments") or tc.get("arguments") or tc.get("input")
                remember_tool(tool_names, tc, name)
                out.append(
                    event(sid, cwd, ts, "tool", tool=name, inp=slim_input(name, raw))
                )
        elif kind == "backend_tool_call":
            kind_obj = obj.get("kind") if isinstance(obj.get("kind"), dict) else {}
            name = str(kind_obj.get("tool_type") or "backend")
            remember_tool(tool_names, obj, name)
            out.append(
                event(sid, cwd, ts, "tool", tool=name, inp=slim_input(name, kind_obj))
            )
        elif kind in ("tool", "tool_result", "toolResult", "backend_tool_result"):
            name = resolve_result_tool(tool_names, obj)
            raw = obj.get("output") or obj.get("result") or obj.get("content")
            result = tool_result_event(sid, cwd, ts, name, raw)
            if result:
                out.append(result)
    return out


def parse_codex(path: Path, cwd: str) -> list[dict]:
    sid = path.stem
    recorded: list[tuple[str, dict]] = []
    tool_names: dict[str, str] = {}
    for obj in iter_jsonl_objects(path):
        ts = iso_from(obj.get("timestamp"), path)
        payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
        otype = obj.get("type")
        if otype == "session_meta":
            sid = str(payload.get("id") or payload.get("session_id") or sid)
            if isinstance(payload.get("cwd"), str):
                cwd = payload["cwd"]
            continue
        if otype == "event_msg" and payload.get("type") == "user_message":
            text = payload.get("message") or payload.get("text")
            if isinstance(text, str) and text.strip():
                recorded.append(
                    ("legacy_message", event(sid, cwd, ts, "user", text=text))
                )
            continue
        if otype == "event_msg" and payload.get("type") == "agent_message":
            text = payload.get("message") or payload.get("text")
            if isinstance(text, str) and text.strip():
                recorded.append(
                    ("legacy_message", event(sid, cwd, ts, "assistant", text=text))
                )
            continue
        if otype != "response_item":
            continue
        ptype = payload.get("type")
        role = payload.get("role")
        if ptype == "message" and role == "user":
            text = user_text_from_blocks(payload.get("content"))
            if text:
                recorded.append(
                    ("canonical_message", event(sid, cwd, ts, "user", text=text))
                )
        elif ptype == "message" and role == "assistant":
            recorded.extend(
                ("canonical_message", item)
                for item in from_blocks(
                    sid, cwd, ts, payload.get("content"), tool_names
                )
            )
        elif ptype == "agent_message":
            recorded.extend(
                ("other", item)
                for item in from_blocks(
                    sid, cwd, ts, payload.get("content"), tool_names
                )
            )
        elif ptype in ("function_call", "custom_tool_call"):
            name = str(payload.get("name") or "unknown")
            raw = (
                payload.get("input") if "input" in payload else payload.get("arguments")
            )
            remember_tool(tool_names, payload, name)
            recorded.append(
                (
                    "other",
                    event(sid, cwd, ts, "tool", tool=name, inp=slim_input(name, raw)),
                )
            )
        elif ptype == "tool_search_call":
            recorded.append(
                (
                    "other",
                    event(
                        sid,
                        cwd,
                        ts,
                        "tool",
                        tool="tool_search",
                        inp=slim_input("tool_search", payload.get("arguments")),
                    ),
                )
            )
        elif ptype in ("function_call_output", "custom_tool_call_output"):
            name = resolve_result_tool(tool_names, payload)
            raw = payload.get("output") or payload.get("result") or payload.get("content")
            result = tool_result_event(sid, cwd, ts, name, raw)
            if result:
                recorded.append(("other", result))
        elif ptype == "web_search_call":
            raw = (
                payload.get("arguments")
                or payload.get("action")
                or payload.get("input")
            )
            recorded.append(
                (
                    "other",
                    event(
                        sid,
                        cwd,
                        ts,
                        "tool",
                        tool="web_search",
                        inp=slim_input("web_search", raw),
                    ),
                )
            )
        elif ptype == "local_shell_call":
            raw = {
                key: payload[key]
                for key in ("command", "cwd", "timeout_ms")
                if key in payload
            }
            remember_tool(tool_names, payload, "local_shell")
            recorded.append(
                ("other", event(sid, cwd, ts, "tool", tool="local_shell", inp=raw))
            )

    canonical = Counter(
        (item["role"], item["text"])
        for origin, item in recorded
        if origin == "canonical_message" and item.get("text")
    )
    skipped: Counter = Counter()
    out: list[dict] = []
    for origin, item in recorded:
        key = (item["role"], item["text"])
        if (
            origin == "legacy_message"
            and item.get("text")
            and skipped[key] < canonical[key]
        ):
            skipped[key] += 1
            continue
        out.append(item)
    return out


def parse_pi_like(path: Path, cwd: str) -> list[dict]:
    sid = path.stem
    out: list[dict] = []
    tool_names: dict[str, str] = {}
    for obj in iter_jsonl_objects(path):
        if obj.get("type") == "session":
            sid = str(obj.get("id") or sid)
            if isinstance(obj.get("cwd"), str):
                cwd = obj["cwd"]
            continue
        if obj.get("type") != "message":
            continue
        ts = iso_from(obj.get("timestamp"), path)
        msg = obj.get("message") if isinstance(obj.get("message"), dict) else {}
        role = msg.get("role")
        content = msg.get("content")
        if role == "user":
            text = user_text_from_blocks(content)
            if text:
                out.append(event(sid, cwd, ts, "user", text=text))
            out.extend(results_from_blocks(sid, cwd, ts, content, tool_names))
        elif role == "assistant":
            out.extend(from_blocks(sid, cwd, ts, content, tool_names))
        elif role in ("tool", "toolResult", "tool_result"):
            name = resolve_result_tool(tool_names, msg)
            result = tool_result_event(sid, cwd, ts, name, content)
            if result:
                out.append(result)
    return out


def parse_hermes(path: Path, cwd: str) -> list[dict]:
    obj = read_json_object(path)
    sid = str(obj.get("session_id") or path.stem)
    ts = iso_from(obj.get("timestamp"), path)
    body = (obj.get("request") or {}).get("body")
    if isinstance(body, str):
        body = decode_stored_json(body, f"{path}: request body")
    if not isinstance(body, dict):
        raise CorruptSessionError(f"{path}: missing request body object")
    out: list[dict] = []
    tool_names: dict[str, str] = {}
    for msg in body.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role == "user":
            text = user_text_from_blocks(msg.get("content"))
            if text:
                out.append(event(sid, cwd, ts, "user", text=text))
        elif role == "assistant":
            text = user_text_from_blocks(msg.get("content"))
            if text:
                out.append(event(sid, cwd, ts, "assistant", text=text))
            for tc in msg.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else tc
                name = str(fn.get("name") or "unknown")
                remember_tool(tool_names, tc, name)
                out.append(
                    event(
                        sid,
                        cwd,
                        ts,
                        "tool",
                        tool=name,
                        inp=slim_input(name, fn.get("arguments")),
                    )
                )
        elif role in ("tool", "tool_result", "toolResult"):
            name = resolve_result_tool(tool_names, msg)
            result = tool_result_event(sid, cwd, ts, name, msg.get("content"))
            if result:
                out.append(result)
    return out


PARSERS = {
    "claude": parse_claude,
    "cursor": parse_cursor,
    "grok": parse_grok,
    "codex": parse_codex,
    "pi": parse_pi_like,
    "openclaw": parse_pi_like,
    "hermes": parse_hermes,
}


def self_check() -> int:
    import tempfile

    claude_line = {
        "type": "user",
        "sessionId": "s1",
        "cwd": "/tmp/demo",
        "timestamp": "2026-01-01T00:00:00Z",
        "message": {"role": "user", "content": "use stripe not clerk"},
    }
    asst = {
        "type": "assistant",
        "sessionId": "s1",
        "cwd": "/tmp/demo",
        "timestamp": "2026-01-01T00:00:01Z",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "secret"},
                {"type": "text", "text": "ok stripe"},
                {
                    "type": "tool_use",
                    "name": "Write",
                    "input": {"path": "a.md", "content": "HUGE"},
                },
                {"type": "tool_result", "content": "NOPE"},
            ],
        },
    }
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "s1.jsonl"
        p.write_text(
            json.dumps(claude_line) + "\n" + json.dumps(asst) + "\n", encoding="utf-8"
        )
        evs = parse_claude(p, "/tmp/demo")
    roles = [e["role"] for e in evs]
    assert roles == ["user", "assistant", "tool"], roles
    assert evs[0]["text"] == "use stripe not clerk"
    assert evs[1]["text"] == "ok stripe"
    assert evs[2]["tool"] == "Write" and evs[2]["input"] == {"path": "a.md"}
    assert all(
        "secret" not in json.dumps(e)
        and "HUGE" not in json.dumps(e)
        and "NOPE" not in json.dumps(e)
        for e in evs
    )
    assert slim_input("Read", {"path": "x", "limit": 10}) == {"path": "x", "limit": 10}
    print("self-check ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if args.self_check:
        return self_check()
    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
