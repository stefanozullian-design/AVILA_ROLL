"""Build AVILA_Roll.html from the parts in src/roll/.

    python tools/build_roll.py            writes AVILA_Roll.html
    python tools/build_roll.py --check    exit 1 if AVILA_Roll.html differs from what the parts build

The page is one file for the people who use it (copied, synced, opened from a folder), so the
shipped AVILA_Roll.html stays in the repository and is always produced by this script, never
edited by hand. The parts are the source: edit them, run the build, commit both.

Assembly, in order:   head.html  <style>  style.css  </style>  body.html  <script>  *.js (sorted)
                      </script>  tail.html
The <style> and <script> tags are added here, so the parts hold pure CSS / JS. Line endings in
the parts do not matter (git may check them out as LF or CRLF): every part is normalised to LF
and the page is written with CRLF, the convention of the shipped file.
"""
import glob
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'roll')
OUT = os.path.join(ROOT, 'AVILA_Roll.html')


def part(name):
    with open(os.path.join(SRC, name), 'rb') as f:
        text = f.read().decode('utf-8').replace('\r\n', '\n')
    if not text.endswith('\n'):
        text += '\n'
    return text


def build():
    js = sorted(os.path.basename(p) for p in glob.glob(os.path.join(SRC, '*.js')))
    if not js:
        sys.exit('no src/roll/*.js parts found')
    pieces = [part('head.html'), '<style>\n', part('style.css'), '</style>\n', part('body.html'), '<script>\n']
    pieces += [part(name) for name in js]
    pieces += ['</script>\n', part('tail.html')]
    return ''.join(pieces).replace('\n', '\r\n').encode('utf-8'), js


def main():
    built, js = build()
    if '--check' in sys.argv:
        try:
            with open(OUT, 'rb') as f:
                current = f.read()
        except FileNotFoundError:
            sys.exit('AVILA_Roll.html is missing: run the build')
        if current == built:
            print(f'AVILA_Roll.html matches src/roll ({len(js)} script parts, {len(built):,} bytes)')
            return
        a, b = current.split(b'\r\n'), built.split(b'\r\n')
        for i, (x, y) in enumerate(zip(a, b), 1):
            if x != y:
                print(f'AVILA_Roll.html differs from the build at line {i}:')
                print('  file :', x[:120].decode('utf-8', 'replace'))
                print('  build:', y[:120].decode('utf-8', 'replace'))
                break
        else:
            print(f'AVILA_Roll.html differs from the build in length: {len(a)} vs {len(b)} lines')
        sys.exit(1)
    with open(OUT, 'wb') as f:
        f.write(built)
    print(f'wrote AVILA_Roll.html from {len(js)} script parts: {len(built):,} bytes')


if __name__ == '__main__':
    main()
