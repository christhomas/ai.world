import hashlib
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from hosted import scene_manifest, validate_android_ui, xctest_failures


def packet(*kinds):
    return json.dumps({'frame': {'nodes': [{'kind': kind} for kind in kinds]}, 'geometries': {}}).encode()


class SceneManifestTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.fixture = self.dir / 'interior_frame.json'
        self.fixture.write_bytes(packet('mesh', 'instances', 'point'))
        self.frames = self.dir / 'frames'
        self.frames.mkdir()

    def record(self, name, data, listed=True):
        (self.frames / f'{name}.json').write_bytes(data)
        if listed:
            with (self.frames / 'SHA256SUMS').open('a') as sums:
                sums.write(f'{hashlib.sha256(data).hexdigest()}  {name}.json\n')

    def test_lists_the_fixture_first_then_every_recorded_scene_with_its_kinds(self):
        self.record('sea', packet('mesh', 'mesh', 'directional', 'ambient'))
        self.record('dungeon', packet('instances', 'point', 'point'))
        scenes = scene_manifest(self.fixture, self.frames)
        self.assertEqual([s['name'] for s in scenes], ['interior-fixture', 'dungeon', 'sea'])
        self.assertEqual(scenes[2]['kinds'], {'ambient': 1, 'directional': 1, 'mesh': 2})
        self.assertEqual(scenes[2]['lights'], 2)

    def test_refuses_a_scene_whose_bytes_do_not_match_their_checksum(self):
        self.record('sea', packet('mesh', 'ambient'))
        (self.frames / 'sea.json').write_bytes(packet('mesh', 'ambient', 'point'))
        with self.assertRaisesRegex(RuntimeError, 'checksum'):
            scene_manifest(self.fixture, self.frames)

    def test_refuses_a_scene_nobody_checksummed_and_a_recording_with_no_scenes(self):
        self.record('sea', packet('mesh', 'ambient'))
        self.record('extra', packet('mesh', 'ambient'), listed=False)
        with self.assertRaisesRegex(RuntimeError, 'extra.json'):
            scene_manifest(self.fixture, self.frames)
        empty = self.dir / 'empty'
        empty.mkdir()
        (empty / 'SHA256SUMS').write_text('')
        with self.assertRaisesRegex(RuntimeError, 'No recorded scenes'):
            scene_manifest(self.fixture, empty)

    def test_refuses_a_scene_with_nothing_to_draw_or_no_light(self):
        self.record('dark', packet('mesh', 'group'))
        with self.assertRaisesRegex(RuntimeError, 'no lights or nothing to draw'):
            scene_manifest(self.fixture, self.frames)


class AndroidCaptureUiTests(unittest.TestCase):
    def test_accepts_only_the_native_app(self):
        self.assertEqual(
            validate_android_ui('<hierarchy><node package="world.ai.ai_world_flutter"><node package="world.ai.ai_world_flutter"/></node></hierarchy>'),
            ['world.ai.ai_world_flutter'],
        )

    def test_rejects_fullscreen_tutorial_over_app(self):
        with self.assertRaisesRegex(RuntimeError, 'obscured'):
            validate_android_ui('<hierarchy><node package="world.ai.ai_world_flutter"/><node package="com.android.systemui" text="Viewing full screen"/></hierarchy>')

    def test_rejects_other_system_dialog_over_app(self):
        with self.assertRaisesRegex(RuntimeError, 'obscured'):
            validate_android_ui('<hierarchy><node package="world.ai.ai_world_flutter"/><node package="android" text="App is not responding"/></hierarchy>')

    def test_rejects_missing_app(self):
        for xml in ['<hierarchy/>', '<hierarchy><node package="com.android.launcher3"/></hierarchy>']:
            with self.subTest(xml=xml), self.assertRaises(RuntimeError):
                validate_android_ui(xml)

    def test_rejects_truncated_hierarchy(self):
        with self.assertRaises(ET.ParseError):
            validate_android_ui('<hierarchy><node package="world.ai.ai_world_flutter">')


class XCTestFailureTests(unittest.TestCase):
    def test_reads_each_failed_assertion_from_the_xcode_16_test_tree(self):
        tree = {'testNodes': [{'nodeType': 'Test Plan', 'name': 'Runner', 'children': [
            {'nodeType': 'Unit test bundle', 'name': 'RunnerTests', 'children': [
                {'nodeType': 'Test Suite', 'name': 'RunnerTests', 'children': [
                    {'nodeType': 'Test Case', 'name': 'testPasses()', 'result': 'Passed'},
                    {'nodeType': 'Test Case', 'name': 'testFails()', 'result': 'Failed', 'children': [
                        {'nodeType': 'Failure Message', 'name': 'RunnerTests.swift:31: XCTAssertTrue failed'}]}]}]}]}]}
        self.assertEqual(xctest_failures(tree), ['testFails(): RunnerTests.swift:31: XCTAssertTrue failed'])

    def test_reads_the_legacy_bundle_summary_with_its_line(self):
        legacy = {'issues': {'testFailureSummaries': {'_values': [{
            'testCaseName': {'_value': 'RunnerTests.testFails()'}, 'message': {'_value': 'XCTAssertEqual failed'},
            'documentLocationInCreatingWorkspace': {'url': {'_value': 'file:///RunnerTests.swift#EndingLineNumber=30&StartingLineNumber=30'}}}]}}}
        self.assertEqual(xctest_failures(legacy), ['RunnerTests.testFails(): line 31: XCTAssertEqual failed'])

    def test_a_passing_bundle_has_no_failures(self):
        self.assertEqual(xctest_failures({'testNodes': [{'nodeType': 'Test Case', 'name': 'testPasses()'}]}), [])


if __name__ == '__main__':
    unittest.main()
