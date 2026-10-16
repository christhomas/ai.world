"""Hosted-only native renderer smoke; never certifies installed gameplay."""
import base64
import hashlib
import html
import json
import os
from pathlib import Path
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


def output(args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


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
         requested_render_time_ms=1000,
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

        def advance(index):
            # The app waits on this file before drawing the next scene, so each is photographed whole.
            name = f'parity-advance-{index}'
            if platform == 'android':
                command([*adb, 'shell', f"run-as world.ai.ai_world_flutter sh -c 'mkdir -p files/ai-world && touch files/ai-world/{name}'"])
            else:
                data = Path(output([*sim, 'get_app_container', device, 'world.ai.aiWorldFlutter', 'data']))
                root = data / 'Library/Application Support/ai-world'
                root.mkdir(parents=True, exist_ok=True)
                (root / name).touch()

        for index, scene in enumerate(json.loads(STATE.read_text())['scenes']):
            name = scene['name']
            save(status=f'waiting-scene-{name}')
            wait_for(f'HOSTED_SCENE_READY index={index} ', 240, f'{name} scene')
            save(status=f'capturing-{name}')
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


def report(platform):
    state = json.loads(STATE.read_text()) if STATE.exists() else {'status': 'provisioning-failed', 'platform': platform}
    state.setdefault('gameplay', 'pending')
    state['gameplay_dependencies'] = ['#558 shared contract', '#563 bundled session', '#564 offline host',
                                      '#571 touch controls', '#572 entry flows and save/restart']
    save(**state)
    sections = ['<!doctype html><html><meta charset="utf-8"><title>Hosted mobile evidence</title>',
                '<h1>Native renderer evidence</h1><p>Installed gameplay: PENDING. Renderer smoke does not satisfy #584 or full #569 parity.</p>',
                '<pre>' + html.escape(json.dumps(state, indent=2)) + '</pre>']
    for png in sorted(OUT.glob('*.png')):
        sections.append('<h2>' + html.escape(png.name) + '</h2><img style="max-width:100%" src="data:image/png;base64,' +
                        base64.b64encode(png.read_bytes()).decode() + '">')
    for log in sorted(OUT.glob('*.log')):
        sections.append('<details><summary>' + html.escape(log.name) + '</summary><pre>' +
                        html.escape(log.read_text(errors='replace')) + '</pre></details>')
    (OUT / 'report.html').write_text('\n'.join(sections) + '</html>')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f'Native renderer: **{state["status"]}**. Installed gameplay: **pending** (#584). Full parity: **pending** (#569). See evidence artifact.\n')


if __name__ == '__main__':
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('This runner is hosted-only; dispatch mobile-playtests.yml on GitHub.')
    action, platform = sys.argv[1:]
    try:
        {'prepare': prepare, 'capture': capture, 'report': report}[action](platform)
    except Exception as error:
        save(status='failed', failure_stage=action, error=str(error))
        raise
