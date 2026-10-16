"""The Android renderer's GLSL, out of its Kotlin strings, through the reference compiler (#512).

`WorldRendererBridge.kt` keeps its shaders as Kotlin raw strings, one including another as
`$NAME`. This expands them the way Kotlin does and hands each stage to `glslangValidator`, which
refuses what a GLES 3.0 driver would; the hosted emulator then compiles them for real.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

BRIDGE = Path(__file__).resolve().parents[2] / 'client/flutter/android/app/src/main/kotlin/world/ai/ai_world_flutter/WorldRendererBridge.kt'
STAGES = {'VERTEX_SHADER': 'vert', 'FRAGMENT_SHADER': 'frag', 'SHADOW_VERTEX_SHADER': 'vert', 'SHADOW_FRAGMENT_SHADER': 'frag'}


def shaders(kotlin):
    """Every `private const val NAME = \"\"\"...\"\"\"` with its `$NAME` templates expanded."""
    raw = dict(re.findall(r'private const val ([A-Z_][A-Z0-9_]*) = """(.*?)"""', kotlin, re.S))
    numbers = dict(re.findall(r'private const val ([A-Z_][A-Z0-9_]*) = (\d+)\b', kotlin))
    def expand(text, depth=0):
        if depth > 8:
            raise RuntimeError('shader templates include each other without end')
        def one(match):
            name = match.group(1)
            if name in raw:
                return expand(raw[name], depth + 1)
            if name in numbers:
                return numbers[name]
            raise RuntimeError(f'shader template ${name} names nothing')
        return re.sub(r'\$\{?([A-Z_][A-Z0-9_]*)\}?', one, text)
    return {name: expand(raw[name]) for name in STAGES if name in raw}


def validate(kotlin):
    found = shaders(kotlin)
    missing = set(STAGES) - set(found)
    if missing:
        raise RuntimeError(f'shaders not found: {sorted(missing)}')
    failures = []
    with tempfile.TemporaryDirectory() as folder:
        for name, source in found.items():
            path = Path(folder) / f'{name.lower()}.{STAGES[name]}'
            path.write_text(source)
            result = subprocess.run(['glslangValidator', str(path)], capture_output=True, text=True)
            print(f'{name}: {"ok" if result.returncode == 0 else "REFUSED"}')
            if result.returncode:
                failures.append(f'{name}:\n{result.stdout}{result.stderr}')
    if failures:
        raise RuntimeError('glslangValidator refused:\n' + '\n'.join(failures))


if __name__ == '__main__':
    validate(BRIDGE.read_text())
    sys.exit(0)
