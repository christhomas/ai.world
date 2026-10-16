"""Hosted-only native renderer smoke; never certifies installed gameplay."""
import base64
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('MOBILE_EVIDENCE', str(Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'mobile-evidence')))
APP = ROOT / 'client/flutter'
OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT / 'manifest.json'


def save(**fields):
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    state.update(fields)
    STATE.write_text(json.dumps(state, indent=2))


def command(args, timeout=600, cwd=ROOT, check=True):
    with (OUT / 'commands.log').open('a') as log:
        log.write(json.dumps(args) + '\n')
        log.flush()
        result = subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode and check:
        raise RuntimeError(f'Command failed ({result.returncode}): {args}')
    return result.returncode


def output(args, timeout=30):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def validate_android_ui(xml):
    packages = {node.get('package') for node in ET.fromstring(xml).iter('node') if node.get('package')}
    if packages != {'world.ai.ai_world_flutter'}:
        raise RuntimeError(f'Native capture is obscured or app is absent: UI packages={sorted(packages)}')
    return sorted(packages)


LIGHTS = {'ambient', 'hemisphere', 'directional', 'point'}


def scene_manifest(fixture, frames=None):
    """What each replayed scene must decode to: the checked-in interior, then every recorded packet.

    Recorded packets come from tools/playtest-record.ts in this same run and are checked against the
    SHA256SUMS written beside them, so a truncated or substituted download is refused rather than
    drawn. Each entry carries the node count per kind the native side must decode exactly.
    """
    def entry(name, path):
        data = path.read_bytes()
        packet = json.loads(data)
        kinds = {}
        for node in packet['frame']['nodes']:
            kinds[node['kind']] = kinds.get(node['kind'], 0) + 1
        lights = sum(n for kind, n in kinds.items() if kind in LIGHTS)
        if not lights or not (kinds.get('mesh', 0) + kinds.get('instances', 0)):
            raise RuntimeError(f'{name}: recorded scene has no lights or nothing to draw: {kinds}')
        return {'name': name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                'kinds': dict(sorted(kinds.items())), 'lights': lights}
    scenes = [entry('interior-fixture', fixture)]
    if frames is None:
        return scenes
    sums_file = frames / 'SHA256SUMS'
    if not sums_file.exists():
        raise RuntimeError(f'No SHA256SUMS beside the recorded scenes in {frames}')
    sums = {}
    for line in sums_file.read_text().splitlines():
        digest, name = line.split(maxsplit=1)
        sums[name.lstrip('*')] = digest
    recorded = sorted(frames.glob('*.json'))
    if not recorded:
        raise RuntimeError(f'No recorded scenes in {frames}')
    for path in recorded:
        scene = entry(path.stem, path)
        if sums.get(path.name) != scene['sha256']:
            raise RuntimeError(f'{path.name}: checksum does not match SHA256SUMS')
        scenes.append(scene)
    return scenes


def prepare(platform):
    command(['node', 'tools/mobile/build-engine.mjs'])
    fixture = APP / 'test/fixtures/interior_frame.json'
    frames = Path(os.environ['PARITY_FRAMES']) if os.environ.get('PARITY_FRAMES') else None
    scenes = scene_manifest(fixture, frames)
    save(platform=platform, source_sha=output(['git', 'rev-parse', 'HEAD']),
         status='provisioning', gameplay='pending', seed=3,
         fixture_sha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),
         render_time='recorded with each scene; 1000 ms for the checked-in fixture',
         scenarios=[f'recorded-{scene["name"]}-native-renderer' for scene in scenes],
         scenes=scenes,
         configuration={'flutter': '3.47.1', 'android_api': 35, 'ios': '18.5',
                        'state_engine': 'QuickJS 2026-06-04' if platform == 'android' else 'JavaScriptCore',
                        'xcode': '16.4', 'backend': 'GLES3 / SwiftShader' if platform == 'android' else 'Metal simulator'},
         assertions=[], retries=0)
    # Generate only inside the disposable hosted checkout; no bundled fixture or app edits land.
    (APP / 'lib/hosted_fixture.dart').write_text('const hostedFixture = ' + json.dumps(fixture.read_text()).replace('$', '\\$') + ';\n')
    (APP / 'lib/hosted_replay.dart').write_text((ROOT / 'tools/mobile/native_replay.dart').read_text())
    # The recorded scenes travel as assets of this disposable build, never of the app in source control.
    hosted = APP / 'assets/hosted'
    hosted.mkdir(parents=True, exist_ok=True)
    for scene in scenes[1:]:
        (hosted / f'{scene["name"]}.json').write_bytes((frames / f'{scene["name"]}.json').read_bytes())
    (hosted / 'scenes.json').write_text(json.dumps(scenes))
    pubspec = APP / 'pubspec.yaml'
    pubspec.write_text(pubspec.read_text().replace('    - assets/engine/\n', '    - assets/engine/\n    - assets/hosted/\n', 1))
    if '- assets/hosted/' not in pubspec.read_text():
        raise RuntimeError('Could not list the hosted scenes as assets of the disposable build')
    command([sys.executable, '-m', 'unittest', 'discover', '-s', 'tools/mobile', '-p', 'test_*.py'])
    command(['flutter', '--version'])
    command(['flutter', 'pub', 'get'], cwd=APP)
    command(['flutter', 'test'], timeout=600, cwd=APP)
    command(['flutter', 'build', 'apk' if platform == 'android' else 'ios',
             '--debug', *(['--simulator'] if platform == 'ios' else []),
             '--target=lib/hosted_replay.dart'], timeout=1200, cwd=APP)
    artifact = APP / ('build/app/outputs/flutter-apk/app-debug.apk' if platform == 'android'
                      else 'build/ios/iphonesimulator/Runner.app/Runner')
    save(status='built', artifact_sha256=hashlib.sha256(artifact.read_bytes()).hexdigest(),
         app_version=(APP / 'pubspec.yaml').read_text().split('version: ')[1].splitlines()[0])


def capture(platform):
    from PIL import Image, ImageStat
    processes = []
    handles = []
    device = None
    sim = ['xcrun', 'simctl']
    try:
        save(status='provisioning-device')
        if platform == 'android':
            devices = output(['adb', 'devices']).splitlines()[1:]
            available = [line.split()[0] for line in devices if line.endswith('\tdevice')]
            if len(available) != 1 or not available[0].startswith('emulator-'):
                raise RuntimeError('Exactly one dedicated emulator required; refusing other devices')
            device = available[0]
            adb = ['adb', '-s', device]
            command([*adb, 'shell', 'getprop'])
            # Match Android's own CTS setup so its first-fullscreen tutorial cannot cover the scene.
            command([*adb, 'shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed'])
            if output([*adb, 'shell', 'settings', 'get', 'secure', 'immersive_mode_confirmations']) != 'confirmed':
                raise RuntimeError('Could not confirm Android fullscreen tutorial on the dedicated emulator')
            # A loaded hosted emulator raises "isn't responding" dialogs over whatever is in front, and
            # one did cover the app in two pull request runs (UI packages=['android']). Android's own
            # test harnesses switch them off; the capture still refuses anything but the app on screen.
            command([*adb, 'shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'])
            if output([*adb, 'shell', 'settings', 'get', 'global', 'hide_error_dialogs']) != '1':
                raise RuntimeError('Could not hide Android error dialogs on the dedicated emulator')
            # That stops new ones; a dialog already up when the setting lands is closed here, which
            # Android's not-responding and crash dialogs do on this broadcast.
            command([*adb, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'])
            command([*adb, 'install', '-r', str(APP / 'build/app/outputs/flutter-apk/app-debug.apk')])
            command([*adb, 'logcat', '-c'])
            logs = OUT / 'native.log'
            handles.append(logs.open('w'))
            processes.append(subprocess.Popen([*adb, 'logcat', '-v', 'threadtime'], stdout=handles[-1], stderr=subprocess.STDOUT))
            command([*adb, 'shell', 'am', 'start', '-W', '-n', 'world.ai.ai_world_flutter/.MainActivity'])
        else:
            command(['xcodebuild', '-version'])
            command([*sim, 'list', '-j'])
            device = output([*sim, 'create', f'hosted-native-{os.environ.get("GITHUB_RUN_ID", "manual")}',
                             'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
                             'com.apple.CoreSimulator.SimRuntime.iOS-18-5'])
            command([*sim, 'boot', device])
            command([*sim, 'bootstatus', device, '-b'], timeout=180)
            # Execute XCTest on this exact simulator, including production Metal runtime coverage.
            command(['xcodebuild', 'test', '-workspace', 'Runner.xcworkspace', '-scheme', 'Runner', '-configuration', 'Debug',
                     '-destination', f'id={device}', '-only-testing:RunnerTests',
                     '-resultBundlePath', str(OUT / 'RunnerTests.xcresult'), 'CODE_SIGNING_ALLOWED=NO', 'FLUTTER_TARGET=lib/hosted_replay.dart'],
                    timeout=900, cwd=APP / 'ios')
            # XCTest can shut the original device down after running on its testing clone.
            devices = json.loads(output([*sim, 'list', 'devices', '-j']))['devices']
            state = next(d['state'] for group in devices.values() for d in group if d['udid'] == device)
            if state != 'Booted':
                command([*sim, 'boot', device])
            command([*sim, 'bootstatus', device, '-b'], timeout=180)
            command([*sim, 'install', device, str(APP / 'build/ios/iphonesimulator/Runner.app')])
            logs = OUT / 'native.log'
            handles.append(logs.open('w'))
            processes.append(subprocess.Popen([*sim, 'spawn', device, 'log', 'stream', '--level', 'debug',
                                               '--predicate', 'process == "Runner"'], stdout=handles[-1], stderr=subprocess.STDOUT))
            command([*sim, 'launch', '--stdout=' + str(OUT / 'app.log'), '--stderr=' + str(OUT / 'app-error.log'),
                     device, 'world.ai.aiWorldFlutter'])
        save(status='waiting-native-ready', device=device)

        def wait_for(marker, seconds, what):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                text = '\n'.join(p.read_text(errors='replace') for p in OUT.glob('*.log'))
                if 'HOSTED_NATIVE_FAILED' in text:
                    raise RuntimeError('Native initialization/frame submission failed; inspect native.log')
                if 'HOSTED_GAME_FAILED' in text:
                    raise RuntimeError('The installed game session failed; inspect native.log')
                if marker in text:
                    return text
                time.sleep(1)
            raise TimeoutError(f'No {what} after {seconds} seconds; crash or blank initialization')

        text = wait_for(f'HOSTED_STATE_ENGINE_READY platform={platform}', 90, 'installed state engine proof')
        if f'HOSTED_HERO_CHECKPOINT_READY platform={platform}' not in text:
            raise RuntimeError('Installed file-backed hero continuation did not complete on ' + platform)
        state = json.loads(STATE.read_text())
        save(assertions=state['assertions'] + [{'name': f'installed-{platform}-hero-state-vm',
             'passed': True, 'cycles': 3, 'scope': 'hero-state-only'},
             {'name': f'installed-{platform}-hero-file-checkpoint', 'passed': True,
              'scope': 'hero-state-only', 'app_process_restart': False}])

        container = []

        def app_files():
            # The simulator's container for the app does not move while it runs, so it is asked for
            # once. Asking takes seconds on a busy runner and has run past half a minute.
            if not container:
                data = Path(output([*sim, 'get_app_container', device, 'world.ai.aiWorldFlutter', 'data'], timeout=180))
                container.append(data / 'Library/Application Support/ai-world')
            return container[0]

        def advance(index):
            # The app waits on this file before drawing the next scene, so each is photographed whole.
            name = f'parity-advance-{index}'
            if platform == 'android':
                command([*adb, 'shell', f"run-as world.ai.ai_world_flutter sh -c 'mkdir -p files/ai-world && touch files/ai-world/{name}'"])
            else:
                root = app_files()
                root.mkdir(parents=True, exist_ok=True)
                (root / name).touch()

        def pull(file):
            # what the app read back from its own render target, beside the advance cue
            if platform == 'android':
                return subprocess.run([*adb, 'exec-out', 'run-as', 'world.ai.ai_world_flutter', 'cat', f'files/ai-world/{file}'],
                                      stdout=subprocess.PIPE, check=True, timeout=180).stdout
            return (app_files() / file).read_bytes()

        for index, scene in enumerate(json.loads(STATE.read_text())['scenes']):
            name = scene['name']
            save(status=f'waiting-scene-{name}')
            text = wait_for(f'HOSTED_SCENE_READY index={index} ', 240, f'{name} scene')
            save(status=f'capturing-{name}')
            size = re.search(rf'HOSTED_SCENE_READY index={index} \S+ .*?framebuffer=(\d+)x(\d+)', text)
            if not size:
                raise RuntimeError(f'{name}: the app did not say what size it read its target back at')
            width, height = int(size.group(1)), int(size.group(2))
            for pass_name in ['first', 'repeat']:
                pixels = pull(f'parity-{index}-{pass_name}.rgba')
                if len(pixels) != width * height * 4:
                    raise RuntimeError(f'{name} {pass_name}: {len(pixels)} bytes read back for {width}x{height}')
                # alpha kept: the comparison fails a world that is not opaque over the app
                Image.frombytes('RGBA', (width, height), pixels).save(OUT / f'{name}-{pass_name}-framebuffer.png')
            for pass_name in ['first', 'repeat']:
                time.sleep(2)
                shot = f'{name}-{pass_name}'
                png = OUT / f'{shot}.png'
                if platform == 'android':
                    with png.open('wb') as file:
                        subprocess.run([*adb, 'exec-out', 'screencap', '-p'], stdout=file, check=True, timeout=30)
                    remote_ui = f'/sdcard/mobile-{shot}-ui.xml'
                    command([*adb, 'shell', 'uiautomator', 'dump', '--compressed', remote_ui], timeout=60)
                    xml = output([*adb, 'exec-out', 'cat', remote_ui])
                    (OUT / f'{shot}-ui.xml').write_text(xml)
                    packages = validate_android_ui(xml)
                    state = json.loads(STATE.read_text())
                    save(assertions=state['assertions'] + [{'name': shot + '-unobscured-app',
                         'passed': True, 'ui_packages': packages}])
                else:
                    command([*sim, 'io', device, 'screenshot', str(png)])
                # OS capture includes native Texture. No label/HUD exists in this replay target.
                with Image.open(png) as image:
                    image.load()
                    w, h = image.size
                    crop = image.convert('RGB').crop((w//5, h//5, w*4//5, h*4//5))
                    spread = max(ImageStat.Stat(crop).stddev)
                    colours = len(crop.resize((128, 128)).getcolors(16384) or [])
                    if spread < 8 or colours < 32:
                        raise RuntimeError(f'{shot}: blank/flat native scene (stddev={spread}, colours={colours})')
                    state = json.loads(STATE.read_text())
                    save(assertions=state['assertions'] + [{'name': shot + '-visible-native-geometry',
                        'passed': True, 'stddev': spread, 'colours': colours, 'width': w, 'height': h}])
            advance(index)
        wait_for('HOSTED_NATIVE_READY', 120, 'end of the replayed scenes')
        save(status='renderer-smoke-passed')

        # the whole shared game in the app's own JavaScript engine (#563), drawn by the same renderer
        save(status='waiting-installed-game')
        text = wait_for(f'HOSTED_GAME_READY platform={platform}', 1200, 'the installed game session')
        line = re.search(rf'HOSTED_GAME_READY platform={platform} [^\n]*', text).group(0)
        stats = dict(pair.split('=', 1) for pair in line.split()[1:] if '=' in pair)
        width, height = (int(n) for n in stats['framebuffer'].split('x'))
        pixels = pull('game-first.rgba')
        if len(pixels) != width * height * 4:
            raise RuntimeError(f'installed game: {len(pixels)} bytes read back for {width}x{height}')
        drawn = Image.frombytes('RGBA', (width, height), pixels)
        drawn.save(OUT / 'installed-game-framebuffer.png')
        if platform == 'android':
            with (OUT / 'installed-game.png').open('wb') as file:
                subprocess.run([*adb, 'exec-out', 'screencap', '-p'], stdout=file, check=True, timeout=30)
        else:
            command([*sim, 'io', device, 'screenshot', str(OUT / 'installed-game.png')])
        import parity
        found = parity.blankness(drawn)
        if parity.is_blank(found, parity.thresholds()['blank']):
            raise RuntimeError(f'installed game: the frame the shared session drew is blank: {found}')
        state = json.loads(STATE.read_text())
        save(installed_game={**stats, 'frame': found}, status='installed-game-passed',
             assertions=state['assertions'] + [{'name': f'installed-{platform}-shared-game-session', 'passed': True,
                                                'scope': 'whole game in the bundled engine, drawn natively', **stats}])
    finally:
        for process in processes:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        for handle in handles:
            handle.close()
        if device and platform == 'ios':
            # Preserve the real test/capture failure; an already-stopped device needs no shutdown.
            command([*sim, 'shutdown', device], check=False)
            command([*sim, 'delete', device], check=False)
        elif device:
            command(['adb', '-s', device, 'shell', 'am', 'force-stop', 'world.ai.ai_world_flutter'], check=False)


def scene_packet(name, frames):
    """The packet a scene was replayed from: the checked-in fixture, or one recorded on this commit."""
    path = APP / 'test/fixtures/interior_frame.json' if name == 'interior-fixture' else frames / f'{name}.json'
    return json.loads(path.read_text())


def limits_for(name, every):
    """The thresholds a scene is held to: the defaults, with anything its own entry overrides."""
    limits = {key: every[key] for key in ('grid', 'blank', 'noise', 'web')}
    for key, value in every.get('scenes', {}).get(name, {}).items():
        limits[key] = {**limits[key], **value} if isinstance(value, dict) else value
    return limits


def compare(platform):
    """Each replayed scene against the web picture of the same frame, and against its own repeat."""
    from PIL import Image
    import parity
    frames = Path(os.environ['PARITY_FRAMES']) if os.environ.get('PARITY_FRAMES') else None
    state = json.loads(STATE.read_text())
    every = parity.thresholds()
    sums = {}
    if frames:
        for line in (frames / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split(maxsplit=1)
            sums[name.lstrip('*')] = digest
    results, failures = [], []
    for scene in state['scenes']:
        name = scene['name']
        native = Image.open(OUT / f'{name}-first-framebuffer.png')
        repeat = Image.open(OUT / f'{name}-repeat-framebuffer.png')
        web = None
        reference = frames / 'web' / f'{name}.png' if frames else None
        if reference and reference.exists():
            if sums.get(f'web/{name}.png') != hashlib.sha256(reference.read_bytes()).hexdigest():
                raise RuntimeError(f'{name}: the web picture does not match SHA256SUMS')
            web = Image.open(reference)
            web.save(OUT / f'{name}-web.png')
            parity.difference_picture(web, native).save(OUT / f'{name}-diff.png')
        background = scene_packet(name, frames)['frame'].get('background')
        found = parity.compare(web, native, limits_for(name, every), background, repeat)
        screenshot = OUT / f'{name}-first.png'
        if screenshot.exists():
            found['screenshot'] = parity.orientation(Image.open(screenshot), native)
        found['name'] = name
        found['web_reference'] = web is not None
        results.append(found)
        failures += [f'{name}: {why}' for why in found['failures']]
    (OUT / 'parity.json').write_text(json.dumps(results, indent=2))
    save(parity=results, parity_thresholds=every, status='parity-failed' if failures else 'parity-passed')
    if failures:
        raise RuntimeError('Native frames do not match: ' + '; '.join(failures))


def thumbnail(path, width=560, turn=0):
    """A picture small enough to embed, as a data URI that needs no file beside the report."""
    from PIL import Image
    with Image.open(path) as image:
        image = image.convert('RGB').rotate(turn, expand=True)
        image.thumbnail((width, width))
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=85)
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()


def report(platform):
    state = json.loads(STATE.read_text()) if STATE.exists() else {'status': 'provisioning-failed', 'platform': platform}
    state.setdefault('gameplay', 'pending')
    state['gameplay_dependencies'] = ['#558 shared contract', '#563 bundled session', '#564 offline host',
                                      '#571 touch controls', '#572 entry flows and save/restart']
    save(**state)
    sections = ['<!doctype html><html><meta charset="utf-8"><title>Hosted mobile evidence</title>',
                '<style>td{vertical-align:top}img{max-width:100%}table{border-collapse:collapse}td,th{padding:4px}</style>',
                '<h1>Native renderer evidence</h1><p>Installed gameplay: PENDING. Renderer replay does not satisfy #584.</p>']
    try:
        import PIL  # noqa: F401  thumbnails need Pillow; without it the report still carries every number
        pictures = True
    except ImportError:
        pictures = False
        sections.append('<p>Pillow is missing, so no pictures are embedded; the PNGs are in the artifact.</p>')
    for found in state.get('parity', []):
        name = found['name']
        verdict = 'FAIL: ' + '; '.join(found['failures']) if found['failures'] else 'pass'
        sections.append(f'<h2>{html.escape(name)}: {html.escape(verdict)}</h2>')
        numbers = {key: found[key] for key in ('mae', 'region_max', 'region_median', 'shift', 'noise', 'native', 'screenshot') if key in found}
        sections.append('<pre>' + html.escape(json.dumps(numbers)) + '</pre>')
        if pictures:
            turn = found.get('screenshot', {}).get('rotation', 0)
            cells = [(label, OUT / file, angle) for label, file, angle in (
                ('web', f'{name}-web.png', 0), ('native target', f'{name}-first-framebuffer.png', 0),
                ('difference x4', f'{name}-diff.png', 0), (f'device screenshot, turned {turn}', f'{name}-first.png', turn))]
            sections.append('<table><tr>' + ''.join(f'<th>{html.escape(label)}</th>' for label, path, _ in cells if path.exists()) + '</tr><tr>' +
                            ''.join(f'<td><img src="{thumbnail(path, turn=angle)}"></td>' for _, path, angle in cells if path.exists()) + '</tr></table>')
    if state.get('installed_game'):
        sections.append('<h2>installed game</h2><pre>' + html.escape(json.dumps(state['installed_game'])) + '</pre>')
        if pictures:
            sections.append('<table><tr>' + ''.join(f'<td><img src="{thumbnail(OUT / file)}"></td>'
                            for file in ('installed-game-framebuffer.png', 'installed-game.png') if (OUT / file).exists()) + '</tr></table>')
    sections.append('<details><summary>manifest</summary><pre>' + html.escape(json.dumps(state, indent=2)) + '</pre></details>')
    for log in sorted(OUT.glob('*.log')):
        sections.append('<details><summary>' + html.escape(log.name) + '</summary><pre>' +
                        html.escape(log.read_text(errors='replace')) + '</pre></details>')
    (OUT / 'report.html').write_text('\n'.join(sections) + '</html>')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f'Native renderer: **{state["status"]}**. Installed gameplay: **pending** (#584). See evidence artifact.\n')
            for found in state.get('parity', []):
                summary.write(f'- {found["name"]}: {"FAIL " + "; ".join(found["failures"]) if found["failures"] else "pass"}'
                              f' (mae {found.get("mae", "-")}, worst region {found.get("region_max", "-")}, noise {found.get("noise", {}).get("mae", "-")})\n')


if __name__ == '__main__':
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('This runner is hosted-only; dispatch mobile-playtests.yml on GitHub.')
    action, platform = sys.argv[1:]
    try:
        {'prepare': prepare, 'capture': capture, 'compare': compare, 'report': report}[action](platform)
    except Exception as error:
        save(status='failed', failure_stage=action, error=str(error))
        raise
