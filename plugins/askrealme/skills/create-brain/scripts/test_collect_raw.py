#!/usr/bin/env python3
"""Self-test collect_raw.py with synthetic native conversation stores."""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

SCRIPT = Path(__file__).with_name("collect_raw.py")


def invoke(home: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ, HOME=str(home))
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )


def run(home: Path, *args: str) -> str:
    result = invoke(home, *args)
    assert result.returncode == 0, result.stderr or result.stdout
    return result.stdout


def read_index(raw: Path) -> list[dict]:
    lines = (raw / "index.jsonl").read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines]


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        selected_work = home / "selected-workdir"
        other_work = home / "other-workdir"
        selected_work.mkdir()
        other_work.mkdir()

        long_message = "A" * 7_000 + "LONG-MIDDLE-MUST-SURVIVE" + "B" * 7_000
        oversized_paragraphs = [
            f"OVERSIZED-{chr(65 + first)}{chr(65 + second)}:" + "x" * 300
            for first in range(20)
            for second in range(20)
        ]
        oversized_message = "\n\n".join(oversized_paragraphs)

        claude = home / ".claude" / "projects" / "-fake-workdir"
        claude.mkdir(parents=True)
        claude_source = claude / "s1.jsonl"
        claude_events = [
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:00:00Z",
                "message": {
                    "role": "user",
                    "content": (
                        "The password is password=hunter2hunter2 "
                        "and the email is a@b.com"
                    ),
                },
            },
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:01:00Z",
                "message": {
                    "role": "user",
                    "content": (
                        '<system-reminder source="claude">machine-only-noise'
                        "</system-reminder>\nSHORT-OWNER-MESSAGE"
                    ),
                },
            },
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:02:00Z",
                "message": {
                    "role": "user",
                    "content": "<task-id>machine-only-event</task-id>",
                },
            },
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:03:00Z",
                "message": {
                    "role": "user",
                    "content": (
                        "<system-reminder>unfinished wrapper\n"
                        "MALFORMED-WRAPPER-MUST-SURVIVE"
                    ),
                },
            },
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:04:00Z",
                "message": {"role": "user", "content": long_message},
            },
            {
                "type": "user",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:05:00Z",
                "message": {"role": "user", "content": oversized_message},
            },
            {
                "type": "assistant",
                "cwd": str(selected_work),
                "timestamp": "2026-08-01T09:06:00Z",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "thinking",
                            "thinking": "PRIVATE-THINKING" + "x" * 2_000_000,
                        },
                        {
                            "type": "image",
                            "source": {"data": "PRIVATE-IMAGE" + "y" * 2_000_000},
                        },
                        {"type": "text", "text": "VISIBLE-ASSISTANT-TEXT"},
                    ],
                },
            },
        ]
        claude_source.write_text(
            "\n".join(
                json.dumps(event, ensure_ascii=False) for event in claude_events
            )
            + "\n",
            encoding="utf-8",
        )

        codex = home / ".codex" / "sessions"
        codex.mkdir(parents=True)
        codex_source = codex / "rollout-1.jsonl"
        codex_source.write_text(
            json.dumps(
                {
                    "type": "session_meta",
                    "payload": {"id": "codex-session", "cwd": str(selected_work)},
                }
            )
            + "\n"
            + json.dumps(
                {
                    "type": "event_msg",
                    "timestamp": "2026-08-01T10:00:00Z",
                    "payload": {
                        "type": "user_message",
                        "message": "I checked the delegated work the next morning",
                    },
                }
            )
            + "\n",
            encoding="utf-8",
        )

        encoded_cwd = urllib.parse.quote(str(other_work), safe="")
        grok = home / ".grok" / "sessions" / encoded_cwd / "grok-session"
        grok.mkdir(parents=True)
        grok_source = grok / "chat_history.jsonl"
        grok_source.write_text(
            json.dumps(
                {
                    "type": "user",
                    "content": "This session ran from another work directory",
                }
            )
            + "\n",
            encoding="utf-8",
        )

        raw = home / "raw"
        discovered = json.loads(run(home, "discover"))["sources"]
        assert len(discovered) == 3, discovered
        assert {record["provider"] for record in discovered} == {"claude", "codex", "grok"}
        assert all("bytes" not in record for record in discovered), discovered
        assert all(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", record["id"]) for record in discovered)
        assert any(record.get("cwd") == str(other_work) for record in discovered), discovered
        assert not raw.exists(), "discovery must not copy candidates"

        staged_dir = home / "staged"
        rendered = {}
        staged_by_id = {}
        for record in discovered:
            staged = staged_dir / f"{record['id']}.jsonl"
            staged_by_id[record["id"]] = staged
            rendered[record["provider"]] = run(
                home,
                "read",
                "--id",
                record["id"],
                "--path",
                record["original_path"],
                "--provider",
                record["provider"],
                "--cwd",
                record["cwd"],
                "--normalized-output",
                str(staged),
            )
            assert staged.is_file()
        assert "hunter2hunter2" not in rendered["claude"]
        assert "a@b.com" not in rendered["claude"]
        assert "[secret removed]" in rendered["claude"]
        assert "[email removed]" in rendered["claude"]
        assert "This session ran from another work directory" in rendered["grok"]
        assert "SHORT-OWNER-MESSAGE" in rendered["claude"]
        assert "machine-only-noise" not in rendered["claude"]
        assert "machine-only-event" not in rendered["claude"]
        assert "<system-reminder>unfinished wrapper\nMALFORMED-WRAPPER-MUST-SURVIVE" in rendered["claude"]
        assert long_message in rendered["claude"]
        assert "… event truncated …" not in rendered["claude"]
        assert "VISIBLE-ASSISTANT-TEXT" in rendered["claude"]
        assert "PRIVATE-THINKING" not in rendered["claude"]
        assert "PRIVATE-IMAGE" not in rendered["claude"]
        assert all(rendered["claude"].count(paragraph) == 1 for paragraph in oversized_paragraphs)
        assert re.search(r"- Part: 1/\d+", rendered["claude"])

        claude_staged = staged_by_id[
            next(record["id"] for record in discovered if record["provider"] == "claude")
        ]
        window_dir = home / "windows"
        split = json.loads(
            run(
                home,
                "split-normalized",
                "--input",
                str(claude_staged),
                "--output-dir",
                str(window_dir),
                "--max-bytes",
                "20000",
            )
        )
        windows = split["windows"]
        assert len(windows) > 1, windows
        assert windows[0]["event_start"] == 0
        assert windows[-1]["event_end"] + 1 == len(
            claude_staged.read_text(encoding="utf-8").splitlines()
        )
        rebuilt = b"".join(Path(window["path"]).read_bytes() for window in windows)
        assert rebuilt == claude_staged.read_bytes()

        cleanup_target = home / "cleanup-me.jsonl"
        cleanup_target.write_text("{}\n", encoding="utf-8")
        cleanup = json.loads(
            run(home, "cleanup-staged", "--path", str(cleanup_target))
        )
        assert cleanup["removed"] == [str(cleanup_target.resolve())]
        assert not cleanup_target.exists()
        rejected_cleanup = invoke(
            home, "cleanup-staged", "--path", str(home / "not-json.txt")
        )
        assert rejected_cleanup.returncode == 1

        with claude_source.open("a", encoding="utf-8") as changed:
            changed.write(
                json.dumps(
                    {
                        "type": "user",
                        "cwd": str(selected_work),
                        "timestamp": "2026-08-01T09:07:00Z",
                        "message": {
                            "role": "user",
                            "content": "UPSTREAM-CHANGED-AFTER-SINGLE-READ",
                        },
                    }
                )
                + "\n"
            )

        for record in discovered:
            if record["provider"] in {"claude", "codex"}:
                run(
                    home,
                    "retain",
                    "--id",
                    record["id"],
                    "--path",
                    record["original_path"],
                    "--provider",
                    record["provider"],
                    "--cwd",
                    record["cwd"],
                    "--normalized",
                    str(staged_by_id[record["id"]]),
                    "--output",
                    str(raw),
                )

        records = read_index(raw)
        assert len(records) == 2, records
        assert {record["provider"] for record in records} == {"claude", "codex"}
        assert all("status" not in record for record in records)
        assert not any(record["provider"] == "grok" for record in records)
        assert not (raw / "grok").exists()
        remaining = json.loads(run(home, "discover", "--raw", str(raw)))["sources"]
        assert [record["provider"] for record in remaining] == ["grok"], remaining

        parallel_count = 24
        for index in range(parallel_count):
            source = claude / f"parallel-{index}.jsonl"
            source.write_text(
                json.dumps(
                    {
                        "type": "user",
                        "cwd": str(selected_work),
                        "timestamp": f"2026-08-02T09:{index:02d}:00Z",
                        "message": {
                            "role": "user",
                            "content": f"parallel retain {index}",
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
        parallel_records = [
            record
            for record in json.loads(run(home, "discover", "--raw", str(raw)))["sources"]
            if record["provider"] == "claude" and "parallel-" in record["original_path"]
        ]
        assert len(parallel_records) == parallel_count, parallel_records
        parallel_staged = {}
        for record in parallel_records:
            staged = staged_dir / f"{record['id']}.jsonl"
            run(
                home,
                "read",
                "--id",
                record["id"],
                "--path",
                record["original_path"],
                "--provider",
                record["provider"],
                "--cwd",
                record["cwd"],
                "--normalized-output",
                str(staged),
            )
            parallel_staged[record["id"]] = staged
        env = dict(os.environ, HOME=str(home))
        processes = [
            subprocess.Popen(
                [
                    sys.executable,
                    str(SCRIPT),
                    "retain",
                    "--id",
                    record["id"],
                    "--path",
                    record["original_path"],
                    "--provider",
                    record["provider"],
                    "--cwd",
                    record["cwd"],
                    "--normalized",
                    str(parallel_staged[record["id"]]),
                    "--output",
                    str(raw),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            for record in parallel_records
        ]
        failures = []
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            if process.returncode != 0:
                failures.append((process.returncode, stdout, stderr))
        assert not failures, failures
        indexed_ids = {record["id"] for record in read_index(raw)}
        assert {record["id"] for record in parallel_records}.issubset(indexed_ids)
        assert len(indexed_ids) == parallel_count + 2, indexed_ids

        claude_record = next(record for record in records if record["provider"] == "claude")
        codex_record = next(record for record in records if record["provider"] == "codex")
        claude_copy = raw / claude_record["raw_path"]
        codex_copy = raw / codex_record["raw_path"]
        assert claude_record["format"] == "askrealme-normalized-session-v1"
        assert codex_record["format"] == "askrealme-normalized-session-v1"
        assert claude_copy.read_bytes() != claude_source.read_bytes()
        assert codex_copy.read_bytes() != codex_source.read_bytes()
        assert claude_copy.read_bytes() == staged_by_id[claude_record["id"]].read_bytes()
        assert codex_copy.read_bytes() == staged_by_id[codex_record["id"]].read_bytes()
        assert claude_copy.stat().st_size < claude_source.stat().st_size / 10
        normalized_text = claude_copy.read_text(encoding="utf-8")
        assert "VISIBLE-ASSISTANT-TEXT" in normalized_text
        assert "PRIVATE-THINKING" not in normalized_text
        assert "PRIVATE-IMAGE" not in normalized_text
        assert "hunter2hunter2" not in normalized_text
        assert "UPSTREAM-CHANGED-AFTER-SINGLE-READ" not in normalized_text
        normalized_events = [json.loads(line) for line in normalized_text.splitlines()]
        assert all(
            set(event).issubset({"timestamp", "role", "tool", "content", "partial"})
            for event in normalized_events
        )
        assert claude_record["original_path"] == str(claude_source.resolve())
        assert claude_copy.relative_to(raw).as_posix() == f"claude/{claude_record['id']}.jsonl"
        assert codex_copy.relative_to(raw).as_posix() == f"codex/{codex_record['id']}.jsonl"
        rendered_from_raw = run(home, "read", "--raw", str(raw), "--id", claude_record["id"])
        assert rendered_from_raw == rendered["claude"]
        claude_source.unlink()
        assert run(home, "read", "--raw", str(raw), "--id", claude_record["id"]) == rendered_from_raw
        assert not (raw / "_digest").exists() and not (raw / "cards.md").exists()
        recursive_add = invoke(home, "add", "--path", str(home), "--output", str(raw))
        assert recursive_add.returncode == 1 and "must not contain" in recursive_add.stderr

        owner_doc = home / "decision.md"
        owner_doc.write_text("# Decision\n\nKeep the original document.\n", encoding="utf-8")
        added = json.loads(run(home, "add", "--path", str(owner_doc), "--output", str(raw)))
        assert added["files"] == 1, added
        assert len(added["ids"]) == 1, added
        repeated_add = json.loads(
            run(home, "add", "--path", str(owner_doc), "--output", str(raw))
        )
        assert repeated_add["ids"] == [], repeated_add
        records = read_index(raw)
        document = next(record for record in records if record["kind"] == "document")
        assert (raw / document["raw_path"]).read_bytes() == owner_doc.read_bytes()
        assert "status" not in document

        manual = raw / "files" / "manual" / "note.md"
        manual.parent.mkdir(parents=True)
        manual.write_text("# Manual note\n", encoding="utf-8")
        indexed = json.loads(run(home, "index", "--output", str(raw)))
        assert indexed["indexed"] == 1, indexed
        assert invoke(home, "verify", "--output", str(raw)).returncode == 0
        document_text = run(home, "read", "--raw", str(raw), "--id", document["id"])
        assert "Keep the original document" in document_text
        assert not any(path.name == "digest" for path in home.rglob("*"))

        claude_record = next(
            record for record in read_index(raw) if record.get("provider") == "claude"
        )
        claude_raw = raw / claude_record["raw_path"]
        original_claude_bytes = claude_raw.read_bytes()
        try:
            claude_raw.write_text("{not valid json}\n", encoding="utf-8")
            failed_read = invoke(home, "read", "--raw", str(raw), "--id", claude_record["id"])
            assert failed_read.returncode == 1, failed_read.stdout
            assert any(record["id"] == claude_record["id"] for record in read_index(raw))
        finally:
            claude_raw.write_bytes(original_claude_bytes)

        manual.write_text("# changed after indexing\n", encoding="utf-8")
        failed = invoke(home, "verify", "--output", str(raw))
        assert failed.returncode == 1 and "sha256 mismatch" in failed.stdout, failed.stdout
    print("ok")


if __name__ == "__main__":
    main()
