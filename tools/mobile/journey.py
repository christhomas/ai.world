#!/usr/bin/env python3
"""The installed-app journeys and the device playtest (#584, #681; docs/mobile/installed-journey.md).

    python3 tools/mobile/journey.py android                 # on a running emulator: the journeys
    python3 tools/mobile/journey.py ios                     # makes, boots and removes its own simulator
    python3 tools/mobile/journey.py android combat doors    # only the parts named, in that order
    python3 tools/mobile/journey.py ios all                 # every part

Each part is a Flutter integration test in client/flutter/integration_test/ that drives the production
app by touch. `flutter test` uninstalls the app after each part, storage and all, so a part that needs
a new launch of the app (the journey's continue) starts it again itself. While a part runs, every
`JOURNEY_SHOT <name>` it prints is photographed with the OS's own capture, so the native world is in
the picture, and every `JOURNEY_STEP {...}` is recorded. A part passes only when it said every step it
owes. The report embeds the pictures, the steps, the commands and their output, and says whether a
failure was the device (exit 2) or the game (exit 1).
"""
import base64
import html
import io
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / 'client/flutter'
OUT = Path(os.environ.get('JOURNEY_EVIDENCE', os.environ.get('RUNNER_TEMP', '/tmp'))) / 'mobile-journey'
CROSSPLAY = 'integration_test/crossplay_test.dart'
# Each part: the test that plays it, and the steps it must say it passed. A part that exits cleanly
# without saying all of them has not shown it did anything, and fails.
PARTS = {
    'journey': ('integration_test/journey_test.dart',
                ['new game', 'world visible', 'walked by touch', 'pack open', 'pack closed', 'saved and left',
                 'continued']),
    'crossplay': (CROSSPLAY, ['joined a shared world', 'saw the web player', 'stayed for the web player',
                              'the web player saw the phone']),
    # the device playtest's parts (#681), each opening a new game: flutter test uninstalls the app between them
    'combat': ('integration_test/combat_test.dart',
               ['world open', 'stick bearings measured', 'a creature to fight', 'walked up to it', 'a blow landed',
                'guard held and let go']),
    'doors': ('integration_test/doors_test.dart',
              ['world open', 'a door to walk into', 'on the doorstep', 'walked in', 'walked out']),
    'shop': ('integration_test/shop_test.dart',
             ['world open', 'a shop to walk into', 'in the shop', 'at the counter', 'talking to the keeper',
              'bought something', 'done talking']),
    'horse': ('integration_test/horse_test.dart',
              ['world open', 'a horse to ride', 'mounted', 'rode by touch', 'got off']),
}
# what runs when nothing is named: the journeys the hosted evidence has always run
JOURNEYS = ['journey', 'crossplay']
STEPS = {step for _, steps in PARTS.values() for step in steps}


def chosen(names):
    """The parts asked for, in order, or why they cannot be run."""
    if not names:
        return JOURNEYS, None
    parts = list(PARTS) if names == ['all'] else names
    unknown = [name for name in parts if name not in PARTS]
    if unknown:
        return None, f'no part called {", ".join(unknown)}; the parts are {", ".join(PARTS)}'
    return parts, None


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


# How long a part may say nothing before it is taken to have hung, and how long it may run at all. A
# part waits up to ten minutes for a world to open on a slow emulator and says so either side, so a
# silence twice that long is not slowness: on 2026-10-17 an iOS part built, said it was loading, and
# then nothing for eighty minutes, until the job's own limit took the report with it.
SILENT_MINUTES = 20
PART_MINUTES = 40
# A part whose app was built but never began its test hung while launching, not in the game: on
# 2026-10-17 the first iOS part on a newly booted simulator did that in two of four runs, and the
# next part passed on the same simulator. It is stopped this long after the build and played again.
LAUNCH_MINUTES = 8
BUILT = re.compile(r'Xcode build done|✓ Built ')
BEGUN = re.compile(r'^\d+:\d+ \+\d+.*: (?!loading )')


def run_part(platform, serial, part, record, defines=()):
    """One journey part, start to finish, photographing what it asks to be photographed. A part
    whose app never started is played once more before it counts as failed."""
    code, launched = play_part(platform, serial, part, record, defines)
    if not launched:
        launch_hung(platform, serial, part)
        code, _ = play_part(platform, serial, part, record, defines, again=True)
    return code


def launch_hung(platform, serial, part):
    """What the machine and the device were doing when a part's app never started, kept beside its
    log; then, on iOS, the simulator is started again, so a stuck install or launch is not inherited
    by the second go (a stopped `flutter test` leaves its `simctl` children running)."""
    stem = Path(part).stem
    try:
        with (OUT / f'{stem}-launch.log').open('w') as file:
            running = subprocess.run(['ps', '-ax', '-o', 'pid,etime,command'], capture_output=True, text=True,
                                     timeout=60, check=False).stdout
            file.write(''.join(line + '\n' for line in running.splitlines()
                               if re.search(r'simctl|xcodebuild|xcrun|flutter|dart|adb|Simulator', line)))
            if platform == 'ios':
                file.write('\n')
                file.flush()
                subprocess.run(['xcrun', 'simctl', 'spawn', serial, 'log', 'show', '--last', f'{LAUNCH_MINUTES + 2}m',
                                '--style', 'compact', '--predicate',
                                'process == "installd" OR process == "SpringBoard" OR process == "Runner"'
                                ' OR process == "CoreSimulatorBridge"'],
                               stdout=file, stderr=subprocess.STDOUT, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass
    if platform == 'ios':
        for args, timeout in ((['shutdown', serial], 120), (['boot', serial], 180), (['bootstatus', serial, '-b'], 600)):
            try:
                subprocess.run(['xcrun', 'simctl', *args], check=False, timeout=timeout)
            except subprocess.TimeoutExpired:
                pass


def play_part(platform, serial, part, record, defines=(), again=False):
    """One go at a part: its exit code, and whether its app launched at all."""
    args = ['flutter', 'test', part, '-d', serial, '--reporter', 'expanded', *[f'--dart-define={d}' for d in defines]]
    record['commands'].append(' '.join(args))
    log = (OUT / f'{Path(part).stem}.log').open('a' if again else 'w')
    if again:
        log.write('\n[journey.py] the app never started, so the part is played again\n')
    started = time.monotonic()
    process = subprocess.Popen(args, cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    # read on a thread of its own, so a part that goes quiet can be noticed rather than waited on
    said = queue.Queue()
    threading.Thread(target=lambda: ([said.put(line) for line in process.stdout], said.put(None)), daemon=True).start()
    heard = time.monotonic()
    built = None
    begun = False
    stopped = None
    while True:
        try:
            line = said.get(timeout=min(15, SILENT_MINUTES * 15, LAUNCH_MINUTES * 15))
        except queue.Empty:
            if time.monotonic() - heard > SILENT_MINUTES * 60:
                stopped = f'said nothing for {SILENT_MINUTES} minutes'
            elif time.monotonic() - started > PART_MINUTES * 60:
                stopped = f'ran past {PART_MINUTES} minutes'
            elif built is not None and not begun and time.monotonic() - built > LAUNCH_MINUTES * 60:
                stopped = f'never started in the {LAUNCH_MINUTES} minutes after it was built'
            if stopped:
                process.kill()
                log.write(f'\n[journey.py] {Path(part).stem} {stopped}, and was stopped\n')
                break
            continue
        if line is None:
            break
        heard = time.monotonic()
        log.write(line)
        log.flush()
        text = line.strip()
        if built is None and BUILT.search(text):
            built = heard
        if BEGUN.match(text):
            begun = True
        if text.startswith('JOURNEY_SHOT '):
            name = text.split(' ', 1)[1]
            record['shots'].append(name)
            photograph(platform, serial, name)
        elif text.startswith('JOURNEY_STEP '):
            begun = True
            record['steps'].append({**json.loads(text.split(' ', 1)[1]), 'part': Path(part).stem,
                                    'atSeconds': round(time.monotonic() - started, 1)})
    code = process.wait(timeout=120)
    log.close()
    record['parts'].append({'part': part, 'exit': code if not stopped else 1, 'seconds': round(time.monotonic() - started, 1),
                            **({'stopped': stopped} if stopped else {}), **({'again': True} if again else {})})
    # a part stopped before its test began is the only kind played again: one that began and then
    # failed or went quiet failed in the game, and another go would hide that
    return (code if not stopped else 1), begun or not stopped


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


def main(platform, names=()):
    OUT.mkdir(parents=True, exist_ok=True)
    record = {'platform': platform, 'sourceSha': os.environ.get('GITHUB_SHA') or output(['git', 'rev-parse', 'HEAD']),
              'steps': [], 'shots': [], 'parts': [], 'commands': [], 'result': 'not run'}
    parts, why = chosen(list(names))
    if parts is None:
        record['result'] = 'not run'
        record['why'] = why
        report(platform, record)
        print(why, file=sys.stderr)
        return 2
    made = None
    try:
        serial, made = device(platform)
        subprocess.run(['node', 'tools/mobile/build-engine.mjs'], cwd=ROOT, check=True, timeout=600)
        # every part is played and reported, so one that fails does not hide what the others found
        failed = []
        for part in parts:
            test, _ = PARTS[part]
            code = crossplay(platform, serial, record) if test == CROSSPLAY else run_part(platform, serial, test, record)
            said = {step['step'] for step in record['steps']}
            if code != 0 or not set(PARTS[part][1]) <= said:
                failed.append(part)
        if failed:
            device_log(platform, serial)
            record['result'] = 'failed'
            silent = sorted(step for part in failed for step in PARTS[part][1] if step not in {s['step'] for s in record['steps']})
            record['why'] = (f'{", ".join(failed)} failed; each part\'s log and the last screens say where.'
                             + (f' Steps never said: {silent}.' if silent else ''))
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
    sys.exit(main(sys.argv[1], sys.argv[2:]))
