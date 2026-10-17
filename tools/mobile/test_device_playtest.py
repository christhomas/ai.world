import json
import tempfile
import unittest
from pathlib import Path

import device_playtest


class DevicePlaytest(unittest.TestCase):
    """What `chore device-playtest` says about a run (#682), without GitHub or a phone."""

    def test_the_run_it_started_is_the_newest_on_this_commit_since_it_asked(self):
        runs = [
            {'databaseId': 1, 'headSha': 'a', 'createdAt': '2026-10-17T09:00:00Z'},  # before it asked
            {'databaseId': 2, 'headSha': 'b', 'createdAt': '2026-10-17T10:00:05Z'},  # another commit
            {'databaseId': 3, 'headSha': 'a', 'createdAt': '2026-10-17T10:00:03Z'},
            {'databaseId': 4, 'headSha': 'a', 'createdAt': '2026-10-17T10:00:09Z'},
        ]
        self.assertEqual(device_playtest.dispatched(runs, 'a', '2026-10-17T10:00:00Z'), 4)
        self.assertIsNone(device_playtest.dispatched(runs, 'c', '2026-10-17T10:00:00Z'))

    def test_both_phones_must_pass_and_a_missing_report_is_a_failure(self):
        folder = Path(tempfile.mkdtemp())
        (folder / 'device-playtest-android').mkdir()
        (folder / 'device-playtest-android' / 'journey.json').write_text(json.dumps(
            {'result': 'passed', 'steps': [{'step': 'new game'}], 'shots': ['world']}))
        lines, passed = device_playtest.summary(folder)
        self.assertFalse(passed)
        self.assertIn('ios: no report', lines)
        self.assertTrue(lines[0].startswith('android: passed — 1 steps, 1 screens.'))
        (folder / 'device-playtest-ios').mkdir()
        (folder / 'device-playtest-ios' / 'journey.json').write_text(json.dumps(
            {'result': 'failed', 'why': 'combat failed', 'steps': [], 'shots': []}))
        lines, passed = device_playtest.summary(folder)
        self.assertFalse(passed)
        self.assertIn('combat failed', lines[1])


if __name__ == '__main__':
    unittest.main()
