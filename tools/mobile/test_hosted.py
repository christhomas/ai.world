import unittest
import xml.etree.ElementTree as ET

from hosted import validate_android_ui


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


if __name__ == '__main__':
    unittest.main()
