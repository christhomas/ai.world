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

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('MOBILE_EVIDENCE', '/tmp/mobile-evidence'))
APP = ROOT / 'client/flutter'
OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT / 'manifest.json'


def save(**fields):
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    state.update(fields)
    STATE.write_text(json.dumps(state, indent=2))


def command(args, timeout=600, cwd=ROOT):
    with (OUT / 'commands.log').open('a') as log:
        log.write(json.dumps(args) + '\n')
        log.flush()
        result = subprocess.run(args, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {args}')


def output(args):
    return subprocess.check_output(args, text=True, timeout=30).strip()


def prepare(platform):
    fixture = APP / 'test/fixtures/interior_frame.json'
    save(platform=platform, source_sha=output(['git', 'rev-parse', 'HEAD']),
         status='provisioning', gameplay='pending', seed=3,
         fixture_sha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),
         scenarios=['recorded-interior-native-renderer'],
         configuration={'flutter': '3.47.1', 'android_api': 35, 'ios': '18.5',
                        'xcode': '16.4', 'backend': 'GLES3 / SwiftShader' if platform == 'android' else 'Metal simulator'},
         assertions=[], retries=0)
    # Generate only inside the disposable hosted checkout; no bundled fixture or app edits land.
    (APP / 'lib/hosted_fixture.dart').write_text('const hostedFixture = ' + json.dumps(fixture.read_text()).replace('$', '\\$') + ';\n')
    (APP / 'lib/hosted_replay.dart').write_text((ROOT / 'tools/mobile/native_replay.dart').read_text())
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
            command(['xcodebuild', 'test', '-workspace', 'Runner.xcworkspace', '-scheme', 'Runner',
                     '-destination', f'id={device}', '-only-testing:RunnerTests',
                     '-resultBundlePath', str(OUT / 'RunnerTests.xcresult'), 'CODE_SIGNING_ALLOWED=NO'],
                    timeout=900, cwd=APP / 'ios')
            command([*sim, 'install', device, str(APP / 'build/ios/iphonesimulator/Runner.app')])
            logs = OUT / 'native.log'
            handles.append(logs.open('w'))
            processes.append(subprocess.Popen([*sim, 'spawn', device, 'log', 'stream', '--level', 'debug',
                                               '--predicate', 'process == "Runner"'], stdout=handles[-1], stderr=subprocess.STDOUT))
            command([*sim, 'launch', '--stdout=' + str(OUT / 'app.log'), '--stderr=' + str(OUT / 'app-error.log'),
                     device, 'world.ai.aiWorldFlutter'])
        save(status='waiting-native-ready', device=device)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            text = '\n'.join(p.read_text(errors='replace') for p in OUT.glob('*.log'))
            if 'HOSTED_NATIVE_FAILED' in text:
                raise RuntimeError('Native initialization/frame submission failed; inspect native.log')
            if 'HOSTED_NATIVE_READY' in text:
                break
            time.sleep(1)
        else:
            raise TimeoutError('No native readiness after 90 seconds; crash or blank initialization')
        save(status='capturing')
        for pass_name in ['first', 'repeat']:
            time.sleep(2)
            png = OUT / f'{pass_name}.png'
            if platform == 'android':
                with png.open('wb') as file:
                    subprocess.run([*adb, 'exec-out', 'screencap', '-p'], stdout=file, check=True, timeout=30)
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
                    raise RuntimeError(f'{pass_name}: blank/flat native scene (stddev={spread}, colours={colours})')
                state = json.loads(STATE.read_text())
                assertions = state['assertions'] + [{'name': pass_name + '-visible-native-geometry',
                    'passed': True, 'stddev': spread, 'colours': colours, 'width': w, 'height': h}]
                save(assertions=assertions)
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
            command([*sim, 'shutdown', device])
            command([*sim, 'delete', device])
        elif device:
            command(['adb', '-s', device, 'shell', 'am', 'force-stop', 'world.ai.ai_world_flutter'])


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
