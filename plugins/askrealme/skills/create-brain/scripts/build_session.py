#!/usr/bin/env python3
"""Prepare and account for a local create-brain run using the existing collector."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import collect_raw as collector

MAX_BYTES = 1572864
MAX_SOURCES = 20
COLLECT = Path(__file__).with_name('collect_raw.py')


def save(path, data):
    collector.write_bytes_atomic(path, (json.dumps(data, indent=2) + '\n').encode())


def select(records, directories):
    selected = {}
    for directory in directories:
        if not any(r.get('cwd') == directory for r in records):
            raise ValueError(f'No discovered sources for selected directory: {directory}')
    for row in records:
        if row.get('cwd') not in directories:
            continue
        sid = row['id']
        if collector.SOURCE_ID_RE.fullmatch(sid) is None:
            raise ValueError(f'Invalid source ID: {sid}')
        if sid in selected and selected[sid] != row:
            raise ValueError(f'Conflicting discovery records for source ID: {sid}')
        selected[sid] = row
    return list(selected.values())


def pack(rows):
    batches = []
    for row in sorted(rows, key=lambda r: (-r['bytes'], r['id'])):
        choices = [b for b in batches if len(b) < MAX_SOURCES
                   and sum(x['bytes'] for x in b) + row['bytes'] <= MAX_BYTES]
        if choices:
            min(choices, key=lambda b: sum(x['bytes'] for x in b)).append(row)
        else:
            batches.append([row])
    return batches


def prepare(args):
    started = time.time()
    brain = Path(args.brain).expanduser().resolve()
    raw = brain / 'raw'
    if raw.exists() and any(raw.iterdir()):
        if subprocess.run([sys.executable, str(COLLECT), 'verify', '--output', str(raw)],
                          stdout=subprocess.DEVNULL).returncode:
            raise ValueError('Existing raw verification failed; preparation was not started.')
    records = json.loads(Path(args.discovery).read_text())['sources']
    rows = select(records, args.directory)
    retained = {r['id'] for r in collector.read_index(raw)}
    rows = [r for r in rows if r['id'] not in retained]
    run = Path(tempfile.mkdtemp(prefix='create-brain-'))
    (run / 'staged').mkdir()
    (run / 'results').mkdir()

    def stage(row):
        target = run / 'staged' / (row['id'] + '.jsonl')
        command = [sys.executable, str(COLLECT), 'read', '--id', row['id'],
                   '--path', row['original_path'], '--provider', row['provider'],
                   '--cwd', row.get('cwd', ''), '--normalized-output', str(target)]
        try:
            result = subprocess.run(command, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, timeout=60, text=True)
            if result.returncode:
                raise ValueError(result.stderr.strip()[-1000:])
            return dict(row, staged_path=str(target), bytes=target.stat().st_size)
        except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
            return {'id': row['id'], 'error': str(exc)}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(stage, rows))
    failures = [r for r in results if 'error' in r]
    assignments = []
    for i, batch in enumerate(pack([r for r in results if 'error' not in r])):
        path = run / f'batch-{i:03d}.json'
        assignment = {'brain': str(brain), 'scope': args.scope,
                      'result': str(run / 'results' / path.name), 'sources': batch}
        save(path, assignment)
        assignments.append(str(path))
    manifest = {'brain': str(brain), 'started_at': datetime.fromtimestamp(started, timezone.utc).isoformat(),
                'started_epoch': started, 'preparation_seconds': round(time.time() - started, 3),
                'approved_ids': [r['id'] for r in rows], 'failures': failures,
                'assignments': assignments}
    save(run / 'run.json', manifest)
    print(json.dumps(dict(manifest, run=str(run), next='resolve_failures' if failures else 'launch_workers')))
    return 1 if failures else 0


def inspect(run):
    manifest = json.loads((run / 'run.json').read_text())
    brain = Path(manifest['brain'])
    retained = {r['id'] for r in collector.read_index(brain / 'raw')}
    errors = [f"Preparation failed: {r['id']}: {r['error']}" for r in manifest['failures']]
    seen = set()
    for name in manifest['assignments']:
        assignment = json.loads(Path(name).read_text())
        expected = {r['id'] for r in assignment['sources']}
        result = Path(assignment['result'])
        if not result.exists():
            errors.append(f'Missing result: {result}')
            continue
        decisions = json.loads(result.read_text())
        if not isinstance(decisions, list):
            errors.append(f'Result must be a list: {result}')
            continue
        local = set()
        for row in decisions:
            if not isinstance(row, dict):
                errors.append(f'Invalid decision object: {result}')
                continue
            sid = row.get('id')
            if sid not in expected or sid in local or sid in seen:
                errors.append(f'Unexpected or duplicate decision: {sid}')
                continue
            local.add(sid)
            seen.add(sid)
            status = row.get('decision')
            if status not in ('relevant', 'irrelevant', 'failed') or not str(row.get('reason', '')).strip():
                errors.append(f'Invalid decision or missing reason: {sid}')
            page = brain / 'output' / 'sources' / f'{sid}.md'
            if status == 'relevant' and (sid not in retained or not page.is_file() or not page.read_text().strip()):
                errors.append(f'Missing retained record or source page: {sid}')
            if status == 'irrelevant' and (sid in retained or page.exists()):
                errors.append(f'Irrelevant source has retained artifacts: {sid}')
            if status == 'failed':
                errors.append(f'Worker failed: {sid}')
        if local != expected:
            errors.append(f'Missing decisions: {sorted(expected - local)}')
    if seen != set(manifest['approved_ids']):
        errors.append(f'Unaccounted IDs: {sorted(set(manifest["approved_ids"]) - seen)}')
    return manifest, errors


def check(args):
    run = Path(args.run).resolve()
    manifest, errors = inspect(run)
    if not errors:
        result = subprocess.run([sys.executable, str(COLLECT), 'verify', '--output',
                                 str(Path(manifest['brain']) / 'raw')], capture_output=True, text=True)
        if result.returncode:
            errors.append(result.stdout + result.stderr)
    if args.cleanup and not errors:
        # Only delete files owned by this run; never follow assignment paths for cleanup.
        for path in (run / 'staged').glob('*.jsonl'):
            if path.is_symlink():
                errors.append(f'Refusing symlink: {path}')
            else:
                path.unlink()
    print(json.dumps({'passed': not errors, 'errors': errors,
                      'elapsed_seconds': round(time.time() - manifest['started_epoch'], 3),
                      'next': 'curate' if not errors else 'resolve_errors'}))
    return 1 if errors else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare')
    prep.add_argument('--discovery', required=True)
    prep.add_argument('--directory', action='append', required=True)
    prep.add_argument('--brain', required=True)
    prep.add_argument('--scope', required=True)
    account = sub.add_parser('check')
    account.add_argument('--run', required=True)
    account.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    try:
        return prepare(args) if args.command == 'prepare' else check(args)
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({'passed': False, 'error': str(exc)}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
