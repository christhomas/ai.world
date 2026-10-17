#!/usr/bin/env python3
"""Play the installed game by touch on hosted phones, from here (#682; docs/mobile/installed-journey.md).

    chore device-playtest                      # every part, on this branch
    chore device-playtest -- combat doors      # only those parts, in that order

Nothing here plays anything: this machine has neither an iPhone simulator nor an emulator it could
run. It asks GitHub to run the Device playtest workflow on this branch's pushed commit, waits for it,
downloads both phones' reports into docs/reports/device-playtest/<run>/, and says what each found.
"""
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = 'device-playtest.yml'
REPO = 'christhomas/ai.world'
PLATFORMS = ('android', 'ios')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def gh_json(*args):
    return json.loads(subprocess.check_output(['gh', *args, '-R', REPO], cwd=ROOT, text=True))


def dispatched(runs, sha, since):
    """The run that dispatch started: on this commit, made after it was asked for, newest first."""
    mine = [run for run in runs if run['headSha'] == sha and run['createdAt'] >= since]
    return max(mine, key=lambda run: run['createdAt'])['databaseId'] if mine else None


def summary(folder):
    """What each phone's report says, one line each, and whether both passed."""
    lines, passed = [], True
    for platform in PLATFORMS:
        found = folder / f'device-playtest-{platform}' / 'journey.json'
        if not found.exists():
            lines.append(f'{platform}: no report')
            passed = False
            continue
        record = json.loads(found.read_text())
        steps = len(record.get('steps', []))
        lines.append(f'{platform}: {record.get("result")} — {steps} steps, {len(record.get("shots", []))} screens. '
                     f'{record.get("why", "")} ({found.parent / "journey.html"})'.rstrip())
        passed = passed and record.get('result') == 'passed'
    return lines, passed


def main(parts):
    branch = git('rev-parse', '--abbrev-ref', 'HEAD')
    sha = git('rev-parse', 'HEAD')
    git('fetch', '-q', 'origin', branch)
    if git('rev-parse', f'origin/{branch}') != sha:
        print(f'{branch} is not pushed as it stands here; the phones play what GitHub has, so push first', file=sys.stderr)
        return 2
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 5))
    subprocess.run(['gh', 'workflow', 'run', WORKFLOW, '-R', REPO, '--ref', branch, '-f', f'parts={" ".join(parts) or "all"}'],
                   check=True, cwd=ROOT)
    run = None
    for _ in range(30):
        time.sleep(5)
        run = dispatched(gh_json('run', 'list', '--workflow', WORKFLOW, '--branch', branch, '--event', 'workflow_dispatch',
                                 '--limit', '10', '--json', 'databaseId,headSha,createdAt'), sha, since)
        if run:
            break
    if not run:
        print('GitHub did not start the run; look in the Actions tab', file=sys.stderr)
        return 2
    print(f'playing {" ".join(parts) or "every part"} on {branch} ({sha[:8]}): https://github.com/{REPO}/actions/runs/{run}')
    said = {}
    while True:
        state = gh_json('run', 'view', str(run), '--json', 'status,conclusion,jobs')
        for job in state['jobs']:
            now = f'{job["status"]} {job.get("conclusion") or ""}'.strip()
            if said.get(job['name']) != now:
                said[job['name']] = now
                print(f'  {job["name"]}: {now}')
        if state['status'] == 'completed':
            break
        time.sleep(60)
    folder = ROOT / 'docs' / 'reports' / 'device-playtest' / str(run)
    folder.mkdir(parents=True, exist_ok=True)
    subprocess.run(['gh', 'run', 'download', str(run), '-R', REPO, '-D', str(folder)], check=False, cwd=ROOT)
    lines, passed = summary(folder)
    for line in lines:
        print(line)
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
