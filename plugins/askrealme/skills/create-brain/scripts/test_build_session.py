"""Behavior checks for preparation and exact worker accounting."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import build_session as build


class BuildTests(unittest.TestCase):
    def test_selection_deduplicates_and_rejects_conflicts(self):
        row = {'id': 'source-a', 'cwd': '/selected'}
        self.assertEqual(build.select([row, row, {'id': 'other', 'cwd': '/other'}], ['/selected']), [row])
        with self.assertRaises(ValueError):
            build.select([row, dict(row, provider='different')], ['/selected'])
        with self.assertRaises(ValueError):
            build.select([row], ['/missing'])

    def test_batch_limits_and_exact_coverage(self):
        rows = [{'id': str(i), 'bytes': 90000} for i in range(50)]
        rows.append({'id': 'large', 'bytes': build.MAX_BYTES + 1})
        batches = build.pack(rows)
        self.assertEqual(sorted(x['id'] for b in batches for x in b), sorted(x['id'] for x in rows))
        for batch in batches:
            self.assertLessEqual(len(batch), build.MAX_SOURCES)
            self.assertTrue(sum(x['bytes'] for x in batch) <= build.MAX_BYTES or len(batch) == 1)

    def test_real_prepare_retain_account_and_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'session.jsonl'
            source.write_text(json.dumps({'type': 'user', 'timestamp': '2026-09-15T00:00:00Z',
                'cwd': '/selected', 'message': {'role': 'user', 'content': 'I checked the render before publishing.'}}) + '\n')
            base = build.collector.load_base()
            relative = build.collector.session_relative_path(base, 'claude', source)
            sid = build.collector.source_id('conversation', 'claude', str(relative))
            row = {'id': sid, 'provider': 'claude', 'cwd': '/selected', 'original_path': str(source)}
            discovery = root / 'discovery.json'
            discovery.write_text(json.dumps({'sources': [row, row]}))
            args = SimpleNamespace(brain=str(root / 'brain'), discovery=str(discovery), directory=['/selected'], scope='render verification')
            stream = io.StringIO()
            original = tempfile.mkdtemp
            with patch.object(build.tempfile, 'mkdtemp', side_effect=lambda **kw: original(dir=root, **kw)), contextlib.redirect_stdout(stream):
                self.assertEqual(build.prepare(args), 0)
            result = json.loads(stream.getvalue())
            run = Path(result['run'])
            assignment = json.loads(Path(result['assignments'][0]).read_text())
            self.assertEqual(len(assignment['sources']), 1)
            staged = Path(assignment['sources'][0]['staged_path'])
            self.assertTrue(staged.is_file())
            self.assertTrue(build.inspect(run)[1])  # Missing worker result blocks.
            target = Path(assignment['result'])
            decision = {'id': sid, 'decision': 'relevant', 'reason': 'Observed render verification.'}
            target.write_text(json.dumps([decision]))
            self.assertTrue(build.inspect(run)[1])  # Relevant without artifacts blocks.
            with contextlib.redirect_stdout(io.StringIO()):
                build.collector.cmd_retain(base, SimpleNamespace(path=str(source), provider='claude', id=sid,
                    cwd='/selected', normalized=str(staged), output=str(root / 'brain/raw')))
            pages = root / 'brain/output/sources'
            pages.mkdir(parents=True)
            (pages / f'{sid}.md').write_text('The owner checked the render before publishing.\n')
            self.assertFalse(build.inspect(run)[1])
            target.write_text(json.dumps([decision, decision]))
            self.assertTrue(build.inspect(run)[1])  # Duplicate decision blocks.
            target.write_text(json.dumps([dict(decision, decision='irrelevant')]))
            self.assertTrue(build.inspect(run)[1])  # Retained irrelevant artifact blocks.
            target.write_text(json.dumps([decision]))
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(build.check(SimpleNamespace(run=str(run), cleanup=True)), 0)
            self.assertFalse(staged.exists())
            self.assertTrue(source.exists())
            self.assertTrue((pages / f'{sid}.md').exists())


if __name__ == '__main__':
    unittest.main()
