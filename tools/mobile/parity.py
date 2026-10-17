"""How a native framebuffer compares with the web picture of the same frame (#569).

Pure functions over Pillow images, so the measurements can be held to in tests without a phone.
Every number is in 8-bit channel units (0..255) unless it says otherwise.

The two pictures are aligned by construction rather than by search: both renderers draw the same
recorded camera, which maps the scene to the same normalised device coordinates, and a viewport maps
those to pixels linearly. So the native target, whatever its size, is resampled to the web canvas's
size and every pixel then answers for the same place. `shift` is measured anyway, as evidence that
nothing moved; a camera or depth fault shows up there and in the regions, not as a silent offset.
"""
import json
from pathlib import Path
from statistics import median

from PIL import Image, ImageChops, ImageStat

THRESHOLDS = Path(__file__).with_name('parity-thresholds.json')


def thresholds():
    return json.loads(THRESHOLDS.read_text())


def boxes(size, cols, rows):
    """The grid of regions a picture is judged in, left to right and then down."""
    width, height = size
    return [(width * c // cols, height * r // rows, width * (c + 1) // cols, height * (r + 1) // rows)
            for r in range(rows) for c in range(cols)]


def mean_rgb(image, box=None):
    return ImageStat.Stat(image.crop(box) if box else image).mean[:3]


def region_deltas(a, b, cols, rows):
    """Per region, the largest difference between the two pictures' mean channel values."""
    return [round(max(abs(x - y) for x, y in zip(mean_rgb(a, box), mean_rgb(b, box))), 2)
            for box in boxes(a.size, cols, rows)]


def mae(a, b):
    """Mean absolute difference over every pixel and channel."""
    return round(sum(ImageStat.Stat(ImageChops.difference(a, b)).mean[:3]) / 3, 3)


def aligned(native, web):
    """The native target resampled to the web canvas: the same NDC lands on the same pixel."""
    native = native.convert('RGB')
    return native if native.size == web.size else native.resize(web.size, Image.Resampling.BOX)


def best_shift(a, b, scale=4, reach=4):
    """The offset of b against a, in full-size pixels, that best lines them up within the reach."""
    small = (max(1, a.width // scale), max(1, a.height // scale))
    sa = a.convert('L').resize(small, Image.Resampling.BOX)
    sb = b.convert('L').resize(small, Image.Resampling.BOX)
    best = None
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            # a's pixel (x, y) against b's (x + dx, y + dy), over the part where both exist
            left, top = max(0, -dx), max(0, -dy)
            right, bottom = min(small[0], small[0] - dx), min(small[1], small[1] - dy)
            if right - left < small[0] // 2 or bottom - top < small[1] // 2:
                continue
            here = ImageStat.Stat(ImageChops.difference(
                sa.crop((left, top, right, bottom)),
                sb.crop((left + dx, top + dy, right + dx, bottom + dy)))).mean[0]
            if best is None or here < best[0] - 1e-9 or (abs(here - best[0]) <= 1e-9 and abs(dx) + abs(dy) < abs(best[1]) + abs(best[2])):
                best = (here, dx, dy)
    return {'dx': best[1] * scale, 'dy': best[2] * scale, 'mae': round(best[0], 3)}


def blankness(image, background=None):
    """How little there is in a picture: its spread, its colours, and how much is the clear colour."""
    rgb = image.convert('RGB')
    width, height = rgb.size
    centre = rgb.crop((width // 5, height // 5, width * 4 // 5, height * 4 // 5))
    found = {
        'stddev': round(max(ImageStat.Stat(centre).stddev[:3]), 2),
        'colours': len(centre.resize((128, 128)).getcolors(16384) or []),
    }
    if background is not None:
        clear = ((background >> 16) & 255, (background >> 8) & 255, background & 255)
        small = rgb.resize((160, max(1, 160 * height // width)))
        pixels = list(small.getdata())
        found['background'] = round(sum(all(abs(p - c) <= 3 for p, c in zip(pixel, clear))
                                        for pixel in pixels) / len(pixels), 4)
    return found


def is_blank(found, limits):
    return (found['stddev'] < limits['stddev'] or found['colours'] < limits['colours']
            or found.get('background', 0) > limits['background'])


def orientation(screenshot, framebuffer):
    """Which turn of the device's screenshot shows the framebuffer, judged by which matches it best.

    The iPhone simulator photographs its portrait frame even when the app is held landscape, so the
    picture of the screen is the drawn frame turned a quarter. This says which quarter, rather than
    assuming one, and how well the turned screenshot then matches what was drawn.
    """
    target = framebuffer.convert('RGB').resize((160, 72))
    scores = {}
    for turn in (0, 90, 180, 270):
        turned = screenshot.convert('RGB').rotate(turn, expand=True).resize(target.size)
        scores[turn] = mae(turned, target)
    turn = min(scores, key=scores.get)
    return {'rotation': turn, 'mae': scores[turn], 'scores': scores}


def compare(web, native, limits, background=None, repeat=None):
    """Every measurement of one scene, and the reasons it fails, if it does."""
    cols, rows = limits['grid']
    found = {'native': blankness(native, background)}
    if web is not None:
        found['web'] = blankness(web, background)
    failures = []
    if native.mode == 'RGBA':
        # Flutter puts the world's texture over the app: anything short of opaque is the app showing through
        alpha = native.getchannel('A').histogram()
        found['translucent'] = round(sum(alpha[:255]) / (native.width * native.height), 5)
        if found['translucent'] > 0:
            failures.append(f'{found["translucent"] * 100:.2f}% of the native frame is not opaque, so the app shows through the world')
    if is_blank(found['native'], limits['blank']):
        failures.append(f'native frame is blank: {found["native"]}')
    if repeat is not None:
        noise = {'mae': mae(native.convert('RGB'), repeat.convert('RGB')),
                 'region': max(region_deltas(native.convert('RGB'), repeat.convert('RGB'), cols, rows))}
        found['noise'] = noise
        if noise['mae'] > limits['noise']['mae'] or noise['region'] > limits['noise']['region']:
            failures.append(f'repeat frames differ beyond the noise floor: {noise}')
    if web is not None:
        web = web.convert('RGB')
        drawn = aligned(native, web)
        deltas = region_deltas(web, drawn, cols, rows)
        found.update({
            'mae': mae(web, drawn), 'regions': deltas, 'region_max': max(deltas),
            'region_median': median(deltas), 'shift': best_shift(web, drawn),
        })
        if found['mae'] > limits['web']['mae']:
            failures.append(f'mean difference from the web picture {found["mae"]} > {limits["web"]["mae"]}')
        if found['region_max'] > limits['web']['region']:
            worst = deltas.index(found['region_max'])
            failures.append(f'region {worst} differs from the web picture by {found["region_max"]} > {limits["web"]["region"]}')
        moved = max(abs(found['shift']['dx']), abs(found['shift']['dy']))
        if moved > limits['web']['shift']:
            failures.append(f'the native frame lines up {found["shift"]} pixels away from the web picture')
    found['failures'] = failures
    return found


def difference_picture(web, native, gain=4):
    """Where the two disagree, brightened so a small difference can be seen."""
    web = web.convert('RGB')
    return ImageChops.difference(web, aligned(native, web)).point(lambda value: min(255, value * gain))
