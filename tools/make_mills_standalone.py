"""Build a self-contained Mill Balance page: AVILA_Mills.html with the data file and the
user's defaults (prices, CO2 factors, recipe and yield overrides, saved scenarios) written
inside it, so one HTML file can be handed over and opens with nothing else.

    python tools/make_mills_standalone.py <AVILA_Mills_data.js> [defaults.json] [out.html]

defaults.json is what the browser has for this page, exported from its localStorage:
    {"econ": <avila_mills_econ>, "overrides": <avila_mills_v3>.ov, "scenarios": <avila_mills_scen>}
Every part is optional. The output carries plant data: keep it where the data file lives
(the SharePoint hand-over folder), never in the public repository.
"""
import json, re, sys, os, datetime

here = os.path.dirname(os.path.abspath(__file__))
page = os.path.join(here, '..', 'AVILA_Mills.html')
data = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', 'AVILA_Mills_data.js')
defs = sys.argv[2] if len(sys.argv) > 2 else None
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(data)), 'AVILA_Mills_standalone.html')

html = open(page, 'rb').read().decode('utf-8')
js = open(data, 'rb').read().decode('utf-8').strip()
tag = '<script src="AVILA_Mills_data.js"></script>'
assert html.count(tag) == 1, 'data script tag not found once'
if '</script' in js:
    raise SystemExit('the data file contains </script>')
inline = '<script>\n' + js + '\nwindow.AVILA_MILLS_STANDALONE=true;\n'   # the page then never reads a Roll scenario on the same machine
if defs:
    d = json.load(open(defs, encoding='utf-8'))
    d = {k: v for k, v in d.items() if k in ('econ', 'overrides', 'scenarios') and v}
    d['made'] = datetime.date.today().isoformat()
    inline += 'window.AVILA_MILLS_DEFAULTS=' + json.dumps(d, separators=(',', ':')).replace('</', '<\\/') + ';\n'
inline += '</script>'
html = html.replace(tag, inline)
open(out, 'wb').write(html.encode('utf-8'))
print('wrote', out, len(html) // 1024, 'kB', 'with defaults' if defs else 'without defaults')
