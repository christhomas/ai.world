import base64
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    from PIL import Image, ImageDraw
    import parity
except ImportError:  # the iOS prepare step runs the system Python, which has no Pillow
    Image = None

LIMITS = {
    'grid': [4, 2],
    'blank': {'stddev': 8, 'colours': 32, 'background': 0.97},
    'noise': {'mae': 1.0, 'region': 1.0},
    'web': {'mae': 12, 'region': 25, 'shift': 8},
}
SKY = (40, 90, 160)
BACKGROUND = 0x285aa0


def scene(scale=1, roof=(200, 170, 90), offset=0):
    """A small picture with edges and colours in it, drawn at any size from the same coordinates."""
    image = Image.new('RGB', (240 * scale, 108 * scale), SKY)
    draw = ImageDraw.Draw(image)
    s = lambda *xy: [v * scale + (offset * scale if i % 2 == 0 else 0) for i, v in enumerate(xy)]
    draw.rectangle(s(30, 20, 110, 80), fill=roof)
    draw.ellipse(s(140, 30, 200, 90), fill=(60, 140, 60))
    for x in range(0, 240, 12):
        draw.line(s(x, 95, x + 6, 105), fill=(230, 230, 230), width=scale)
    for x in range(8, 232, 16):
        draw.rectangle(s(x, 4, x + 5, 12), fill=(250, 220, 120))
    return image


@unittest.skipIf(Image is None, 'Pillow is not installed')
class ParityTests(unittest.TestCase):
    def test_the_same_frame_drawn_at_a_phones_size_lines_up_and_passes(self):
        found = parity.compare(scene(), scene(scale=2), LIMITS, BACKGROUND, scene(scale=2))
        self.assertEqual(found['failures'], [])
        self.assertEqual((found['shift']['dx'], found['shift']['dy']), (0, 0))
        self.assertLess(found['mae'], 3)
        self.assertEqual(found['noise'], {'mae': 0.0, 'region': 0.0})

    def test_a_frame_of_nothing_but_the_clear_colour_is_blank(self):
        empty = Image.new('RGB', (480, 216), SKY)
        found = parity.compare(scene(), empty, LIMITS, BACKGROUND, empty)
        self.assertTrue(any('blank' in why for why in found['failures']), found['failures'])
        self.assertEqual(found['native']['background'], 1.0)

    def test_light_changed_in_one_place_fails_that_region_and_not_the_whole(self):
        lit = scene(scale=2, roof=(230, 215, 150))
        found = parity.compare(scene(), lit, LIMITS, BACKGROUND, lit)
        self.assertLess(found['mae'], LIMITS['web']['mae'])
        self.assertTrue(any(why.startswith('region') for why in found['failures']), found['failures'])

    def test_a_camera_that_moved_is_measured_as_a_shift(self):
        moved = scene(scale=2, offset=12)
        found = parity.compare(scene(), moved, LIMITS, BACKGROUND, moved)
        self.assertEqual(found['shift']['dx'], 12)
        self.assertTrue(any('lines up' in why for why in found['failures']), found['failures'])

    def test_two_reads_of_one_frame_that_differ_break_the_noise_floor(self):
        found = parity.compare(scene(), scene(scale=2), LIMITS, BACKGROUND, scene(scale=2, roof=(190, 160, 80)))
        self.assertTrue(any('noise floor' in why for why in found['failures']), found['failures'])

    def test_a_scene_with_no_web_picture_is_still_held_to_blank_and_noise(self):
        found = parity.compare(None, scene(scale=2), LIMITS, BACKGROUND, scene(scale=2))
        self.assertEqual(found['failures'], [])
        self.assertNotIn('mae', found)

    def test_a_world_the_app_shows_through_is_not_a_world_frame(self):
        drawn = scene(scale=2).convert('RGBA')
        drawn.putalpha(Image.new('L', drawn.size, 255))
        self.assertEqual(parity.compare(scene(), drawn, LIMITS, BACKGROUND, drawn)['failures'], [])
        water = drawn.copy()
        water.paste((40, 90, 160, 200), (0, 0, 48, 24))
        found = parity.compare(scene(), water, LIMITS, BACKGROUND, water)
        self.assertGreater(found['translucent'], 0)
        self.assertTrue(any('not opaque' in why for why in found['failures']), found['failures'])

    def test_the_turn_that_undoes_a_portrait_screenshot_is_found(self):
        drawn = scene(scale=2)
        portrait = drawn.rotate(90, expand=True)
        self.assertEqual(parity.orientation(portrait, drawn)['rotation'], 270)
        self.assertEqual(parity.orientation(drawn, drawn)['rotation'], 0)


@unittest.skipIf(Image is None, 'Pillow is not installed')
class ReportTests(unittest.TestCase):
    def test_every_picture_is_embedded_and_decodes_with_no_file_beside_it(self):
        import hosted
        out = Path(tempfile.mkdtemp())
        kept = hosted.OUT, hosted.STATE
        self.addCleanup(lambda: setattr(hosted, 'OUT', kept[0]) or setattr(hosted, 'STATE', kept[1]))
        hosted.OUT, hosted.STATE = out, out / 'manifest.json'
        scene().save(out / 'town-web.png')
        scene(scale=2).save(out / 'town-first-framebuffer.png')
        scene(scale=2).rotate(90, expand=True).save(out / 'town-first.png')
        (out / 'native.log').write_text('HOSTED_SCENE_READY index=0 name=town')
        found = parity.compare(scene(), scene(scale=2), LIMITS, BACKGROUND, scene(scale=2))
        found.update(name='town', screenshot=parity.orientation(Image.open(out / 'town-first.png'), scene(scale=2)))
        hosted.STATE.write_text(json.dumps({'status': 'parity-passed', 'platform': 'android', 'parity': [found]}))
        with mock.patch.dict(os.environ):
            os.environ.pop('GITHUB_STEP_SUMMARY', None)   # not this job's summary
            hosted.report('android')
        page = (out / 'report.html').read_text()
        sources = re.findall(r'<img src="([^"]+)"', page)
        self.assertEqual(len(sources), 3)
        for source in sources:
            self.assertTrue(source.startswith('data:image/jpeg;base64,'), source[:40])
            with Image.open(io.BytesIO(base64.b64decode(source.split(',', 1)[1]))) as image:
                image.load()
                self.assertGreater(image.width, 0)
        self.assertIn('town: pass', page)


if __name__ == '__main__':
    unittest.main()
