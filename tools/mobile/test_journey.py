import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

try:
    from PIL import Image
except ImportError:  # the iOS prepare step runs the system Python, which has no Pillow
    Image = None

import journey

STEPS = ['new game', 'world visible', 'walked by touch', 'pack open', 'pack closed', 'saved and left', 'continued']
MET = ['joined a shared world', 'saw the web player', 'stayed for the web player', 'the web player saw the phone']
JOURNEY = journey.PARTS['journey'][0]


@unittest.skipIf(Image is None, 'Pillow is not installed')
class JourneyRunner(unittest.TestCase):
    """What the installed-journey runner says about a run (#584), without a device."""

    def setUp(self):
        self.out = Path(tempfile.mkdtemp())
        self.patches = [mock.patch.object(journey, 'OUT', self.out),
                        mock.patch.dict(os.environ, {'GITHUB_SHA': 'a' * 40}, clear=False)]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in reversed(self.patches):
            patch.stop()

    def run_with(self, said):
        """A journey whose parts said these steps, on a device that is there."""
        def part(platform, serial, name, record):
            for step in said.get(name, []):
                record['steps'].append({'step': step, 'part': Path(name).stem})
            Image.new('RGB', (40, 20), (90, 140, 60)).save(self.out / f'{Path(name).stem}.png')
            record['shots'].append(Path(name).stem)
            return 0
        def crossplay(platform, serial, record):
            for step in said.get('crossplay', []):
                record['steps'].append({'step': step, 'part': 'crossplay'})
            return 0
        with mock.patch.object(journey, 'device', return_value=('emulator-5554', None)), \
             mock.patch.object(journey, 'run_part', side_effect=part), \
             mock.patch.object(journey, 'crossplay', side_effect=crossplay), \
             mock.patch.object(journey.subprocess, 'run'):
            code = journey.main('android')
        return code, json.loads((self.out / 'journey.json').read_text()), (self.out / 'journey.html').read_text()

    def test_a_journey_that_said_every_step_passes_and_reports_its_screens(self):
        code, record, page = self.run_with({JOURNEY: STEPS, 'crossplay': MET})
        self.assertEqual(code, 0)
        self.assertEqual(record['result'], 'passed')
        self.assertIn('data:image/jpeg;base64,', page, 'the screens are in the page, not beside it')

    def test_a_journey_that_passed_without_saying_so_fails(self):
        code, record, _ = self.run_with({JOURNEY: STEPS[:2], 'crossplay': MET})
        self.assertEqual(code, 1)
        self.assertEqual(record['result'], 'failed')
        self.assertIn('walked by touch', record['why'])

    def test_players_who_never_met_fail_the_journey(self):
        code, record, _ = self.run_with({JOURNEY: STEPS, 'crossplay': MET[:1]})
        self.assertEqual(code, 1)
        self.assertIn('saw the web player', record['why'])

    def test_a_part_that_fails_keeps_what_the_device_said(self):
        with mock.patch.object(journey, 'device', return_value=('emulator-5554', None)), \
             mock.patch.object(journey, 'run_part', return_value=1), \
             mock.patch.object(journey, 'crossplay', return_value=1), \
             mock.patch.object(journey.subprocess, 'run') as ran:
            code = journey.main('android')
        record = json.loads((self.out / 'journey.json').read_text())
        self.assertEqual(code, 1)
        self.assertEqual(record['result'], 'failed')
        self.assertIn(['adb', '-s', 'emulator-5554', 'logcat', '-d', '-t', '5000'], [call.args[0] for call in ran.call_args_list])

    def test_an_emulator_that_drops_off_adb_for_a_moment_is_waited_for(self):
        said = iter(['List of devices attached', 'List of devices attached\nemulator-5554\toffline',
                     'List of devices attached\nemulator-5554\tdevice'])
        with mock.patch.object(journey, 'output', side_effect=lambda args: next(said)), \
             mock.patch.object(journey.time, 'sleep'):
            self.assertEqual(journey.device('android'), ('emulator-5554', None))

    def test_an_emulator_that_never_comes_back_is_not_waited_for_forever(self):
        clock = iter(range(0, 1000, 30))
        with mock.patch.object(journey, 'output', return_value='List of devices attached'), \
             mock.patch.object(journey.time, 'monotonic', side_effect=lambda: next(clock)), \
             mock.patch.object(journey.time, 'sleep'):
            with self.assertRaises(journey.Provisioning):
                journey.device('android')

    def test_a_failed_part_does_not_hide_the_others(self):
        played = []
        def part(platform, serial, name, record):
            played.append(Path(name).stem)
            return 1 if name == JOURNEY else 0
        with mock.patch.object(journey, 'device', return_value=('emulator-5554', None)), \
             mock.patch.object(journey, 'run_part', side_effect=part), \
             mock.patch.object(journey, 'crossplay', side_effect=lambda *_: played.append('crossplay') or 0), \
             mock.patch.object(journey.subprocess, 'run'):
            code = journey.main('android')
        record = json.loads((self.out / 'journey.json').read_text())
        self.assertEqual(code, 1)
        self.assertEqual(played, ['journey_test', 'crossplay'])
        self.assertIn('journey', record['why'])

    def test_the_parts_asked_for_are_played_in_the_order_asked(self):
        self.assertEqual(journey.chosen([]), (journey.JOURNEYS, None))
        self.assertEqual(journey.chosen(['all'])[0], list(journey.PARTS))
        self.assertEqual(journey.chosen(['crossplay', 'journey'])[0], ['crossplay', 'journey'])
        parts, why = journey.chosen(['combat-of-the-gods'])
        self.assertIsNone(parts)
        self.assertIn('combat-of-the-gods', why)

    def test_a_part_nobody_has_heard_of_runs_nothing(self):
        with mock.patch.object(journey, 'device') as found:
            code = journey.main('android', ['nonsense'])
        self.assertEqual(code, 2)
        found.assert_not_called()

    def test_a_part_that_goes_quiet_is_stopped_rather_than_waited_on(self):
        stop = threading.Event()
        class Quiet:
            def __init__(self):
                self.killed = False
                self.stdout = self.lines()
            def lines(self):
                yield 'JOURNEY_STEP {"step": "new game"}\n'
                stop.wait(5)
            def kill(self):
                self.killed = True
                stop.set()
            def wait(self, timeout=None):
                return -9
        quiet = Quiet()
        record = {'commands': [], 'steps': [], 'shots': [], 'parts': []}
        with mock.patch.object(journey, 'SILENT_MINUTES', 0.005), \
             mock.patch.object(journey.subprocess, 'Popen', return_value=quiet):
            code = journey.run_part('android', 'emulator-5554', 'integration_test/journey_test.dart', record)
        self.assertEqual(code, 1)
        self.assertTrue(quiet.killed, 'the part was waited on rather than stopped')
        self.assertEqual(record['steps'][0]['step'], 'new game', 'what it said before going quiet is kept')
        self.assertIn('said nothing', record['parts'][0]['stopped'])

    def test_a_missing_device_is_not_a_game_failure(self):
        with mock.patch.object(journey, 'device', side_effect=journey.Provisioning('no Android emulator is attached')):
            code = journey.main('android')
        record = json.loads((self.out / 'journey.json').read_text())
        self.assertEqual(code, 2)
        self.assertEqual(record['result'], 'device not ready')


if __name__ == '__main__':
    unittest.main()
