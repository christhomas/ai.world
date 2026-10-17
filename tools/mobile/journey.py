#!/usr/bin/env python3
"""The installed-app journeys on a hosted emulator or simulator (#584; docs/mobile/installed-journey.md).

    python3 tools/mobile/journey.py android    # on a running emulator, after hosted.py capture
    python3 tools/mobile/journey.py ios        # makes, boots and removes its own simulator

Each journey part is a Flutter integration test in client/flutter/integration_test/ that drives the
production app by touch. `flutter test` installs the app over itself, so the second part is a new launch
of the same app with its storage intact: a save that did not survive fails it. While a part runs, every
`JOURNEY_SHOT <name>` it prints is photographed with the OS's own capture, so the native world is in the
picture, and every `JOURNEY_STEP {...}` is recorded. The report embeds the pictures, the steps, the
commands and their output, and says whether a failure was the device (exit 2) or the game (exit 1).
"""
import base64
import html
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'client/flutter'
OUT = Path(os.environ.get('JOURNEY_EVIDENCE', os.environ.get('RUNNER_TEMP', '/tmp'))) / 'mobile-journey'
PARTS = ['integration_test/journey_test.dart', 'integration_test/continue_test.dart']
CROSSPLAY = 'integration_test/crossplay_test.dart'
STEPS = {'new game', 'world visible', 'walked by touch', 'pack open', 'pack closed', 'saved and left', 'continued',
         'joined a shared world', 'saw the web player', 'stayed for the web player'}


class Provisioning(Exception):
    """The device, not the game."""


def output(args, timeout=120):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()


def device(platform):
    if platform == 'android':
        # An emulator short of memory can drop off adb for a moment and come back: it did straight
        # after the capture on 2026-10-17, and the journey that followed found nothing and gave up.
        deadline = time.monotonic() + 120
        while True:
            lines = [line.split() for line in output(['adb', 'devices']).splitlines()[1:]]
            ready = [parts[0] for parts in lines if len(parts) == 2 and parts[1] == 'device']
            if ready:
                return ready[0], None
            if time.monotonic() > deadline:
                raise Provisioning('no Android emulator is attached')
            time.sleep(5)
    runtimes = json.loads(output(['xcrun', 'simctl', 'list', 'runtimes', '-j']))['runtimes']
    ios = [r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS')]
    if not ios:
        raise Provisioning('no iOS simulator runtime is available')
    made = output(['xcrun', 'simctl', 'create', 'ai-world-journey', 'iPhone 16', ios[-1]['identifier']])
    subprocess.run(['xcrun', 'simctl', 'boot', made], check=True, timeout=180)
    subprocess.run(['xcrun', 'simctl', 'bootstatus', made, '-b'], check=True, timeout=600)
    return made, made


def photograph(platform, serial, name):
    path = OUT / f'{name}.png'
    if platform == 'android':
        with path.open('wb') as file:
            subprocess.run(['adb', '-s', serial, 'exec-out', 'screencap', '-p'], stdout=file, check=True, timeout=60)
    else:
        subprocess.run(['xcrun', 'simctl', 'io', serial, 'screenshot', str(path)], check=True, timeout=60)
    return path


def run_part(platform, serial, part, record, defines=()):
    """One journey part, start to finish, photographing what it asks to be photographed."""
    args = ['flutter', 'test', part, '-d', serial, '--reporter', 'expanded', *[f'--dart-define={d}' for d in defines]]
    record['commands'].append(' '.join(args))
    log = (OUT / f'{Path(part).stem}.log').open('w')
    started = time.monotonic()
    process = subprocess.Popen(args, cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in process.stdout:
        log.write(line)
        log.flush()
        text = line.strip()
        if text.startswith('JOURNEY_SHOT '):
            name = text.split(' ', 1)[1]
            record['shots'].append(name)
            photograph(platform, serial, name)
        elif text.startswith('JOURNEY_STEP '):
            record['steps'].append({**json.loads(text.split(' ', 1)[1]), 'part': Path(part).stem,
                                    'atSeconds': round(time.monotonic() - started, 1)})
    code = process.wait(timeout=60 * 40)
    log.close()
    record['parts'].append({'part': part, 'exit': code, 'seconds': round(time.monotonic() - started, 1)})
    return code


def device_log(platform, serial):
    """What the device said while the journey ran, kept beside the report when a part fails."""
    if platform == 'android':
        args = ['adb', '-s', serial, 'logcat', '-d', '-t', '5000']
    else:
        args = ['xcrun', 'simctl', 'spawn', serial, 'log', 'show', '--last', '20m', '--style', 'compact',
                '--predicate', 'process == "Runner"']
    try:
        with (OUT / 'device.log').open('w') as file:
            subprocess.run(args, stdout=file, stderr=subprocess.STDOUT, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass


def crossplay(platform, serial, record):
    """The phone meets a web player in one shared world on a real world server on this machine."""
    # the emulator reaches the machine it runs on as 10.0.2.2; the simulator shares its network
    host = '10.0.2.2' if platform == 'android' else '127.0.0.1'
    invite = f'http://{host}:8787/?seed=7&world=road&server=ws://{host}:8787'
    log = (OUT / 'crossplay-web.log').open('w')
    web = subprocess.Popen(['node', 'tools/mobile/crossplay-web.cjs'], cwd=ROOT, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True, bufsize=1, start_new_session=True,
                           env={**os.environ, 'CROSSPLAY_OUT': str(OUT)})
    try:
        for line in web.stdout:
            log.write(line)
            log.flush()
            if line.startswith('CROSSPLAY_READY'):
                break
            if line.startswith('CROSSPLAY_FAILED'):
                raise Provisioning(f'the web player could not join: {line.strip()}')
        else:
            raise Provisioning('the web player stopped before it was in the world')
        # keep reading the web side's output while the phone plays, so it never blocks on a full pipe
        import threading
        threading.Thread(target=lambda: [log.write(line) for line in web.stdout], daemon=True).start()
        code = run_part(platform, serial, CROSSPLAY, record, defines=[f'CROSSPLAY_INVITE={invite}'])
    finally:
        try:
            os.killpg(web.pid, 15)
        except ProcessLookupError:
            pass
        web.wait(timeout=60)
        log.close()
    seen = json.loads((OUT / 'crossplay-web.json').read_text()) if (OUT / 'crossplay-web.json').exists() else {}
    record['crossplay'] = seen
    if (OUT / 'crossplay-web.png').exists():
        record['shots'].append('crossplay-web')
    if code == 0 and seen.get('sawPhone'):
        record['steps'].append({'step': 'the web player saw the phone', 'part': 'crossplay-web', 'others': seen.get('others')})
    return code


def thumbnail(path):
    from PIL import Image
    with Image.open(path) as image:
        image.thumbnail((640, 640))
        buffer = io.BytesIO()
        image.convert('RGB').save(buffer, 'JPEG', quality=80)
    return 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()


def report(platform, record):
    (OUT / 'journey.json').write_text(json.dumps(record, indent=2))
    rows = ''.join(f'<tr><td>{html.escape(s["part"])}</td><td>{html.escape(s["step"])}</td>'
                   f'<td>{html.escape(json.dumps({k: v for k, v in s.items() if k not in ("part", "step")}))}</td></tr>'
                   for s in record['steps'])
    shots = ''.join(f'<figure><img src="{thumbnail(OUT / (name + ".png"))}" alt="{html.escape(name)}">'
                    f'<figcaption>{html.escape(name)}</figcaption></figure>'
                    for name in record['shots'] if (OUT / f'{name}.png').exists())
    page = (f'<!doctype html><meta charset="utf-8"><title>Installed journey: {platform}</title>'
            f'<h1>Installed journey on {platform}: {html.escape(record["result"])}</h1>'
            f'<p>Source {html.escape(record["sourceSha"])}. {html.escape(record.get("why", ""))}</p>'
            f'<h2>Steps</h2><table border=1><tr><th>part</th><th>step</th><th>facts</th></tr>{rows}</table>'
            f'<h2>Screens</h2>{shots}<h2>Commands</h2><pre>{html.escape(chr(10).join(record["commands"]))}</pre>'
            f'<pre>{html.escape(json.dumps(record["parts"], indent=1))}</pre>')
    (OUT / 'journey.html').write_text(page)
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as file:
            file.write(f'Installed journey on {platform}: **{record["result"]}** '
                       f'({len(record["steps"])} steps, {len(record["shots"])} screens). {record.get("why", "")}\n')


def main(platform):
    OUT.mkdir(parents=True, exist_ok=True)
    record = {'platform': platform, 'sourceSha': os.environ.get('GITHUB_SHA') or output(['git', 'rev-parse', 'HEAD']),
              'steps': [], 'shots': [], 'parts': [], 'commands': [], 'result': 'not run'}
    made = None
    try:
        serial, made = device(platform)
        subprocess.run(['node', 'tools/mobile/build-engine.mjs'], cwd=ROOT, check=True, timeout=600)
        for part in PARTS:
            if run_part(platform, serial, part, record) != 0:
                device_log(platform, serial)
                record['result'] = 'failed'
                record['why'] = f'{part} failed; its log and the last screens say where.'
                return 1
        if crossplay(platform, serial, record) != 0:
            record['result'] = 'failed'
            record['why'] = 'the phone and the web player did not meet; crossplay_test.log and crossplay-web.log say where.'
            return 1
        missing = (STEPS | {'the web player saw the phone'}) - {step['step'] for step in record['steps']}
        if missing:
            record['result'] = 'failed'
            record['why'] = f'the journey passed without saying it did: {sorted(missing)}'
            return 1
        record['result'] = 'passed'
        return 0
    except Provisioning as error:
        record['result'] = 'device not ready'
        record['why'] = str(error)
        return 2
    except subprocess.CalledProcessError as error:
        record['result'] = 'device not ready'
        record['why'] = f'{error.cmd} failed with {error.returncode}'
        return 2
    finally:
        report(platform, record)
        if made:
            subprocess.run(['xcrun', 'simctl', 'shutdown', made], check=False, timeout=120)
            subprocess.run(['xcrun', 'simctl', 'delete', made], check=False, timeout=120)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
