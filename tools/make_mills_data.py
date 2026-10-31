"""Make the bundled data file for the Mill Balance page.

    python tools/make_mills_data.py path/to/AVILA_Roll_BRS_2026-10-30.json

Writes AVILA_Mills_data.js (and .json) next to AVILA_Mills.html with ONLY what that page reads:
the plants, the active finish mills and kilns, the cements they can make (rated capacity, clinker
share of the recipe) and their daily production tonnes over the last 12 months plus the current year.
Nothing else from the scenario (demand, customers, shipments, rail, vessels, users) is included.
NEVER commit the output: it is plant data and the repo is public. Hand it over privately (SharePoint)
in a folder together with AVILA_Mills.html; the page loads the .js by itself when opened from there.
"""
import datetime as dt
import json
import os
import sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
src = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'AVILA_Mills_data.js')

p = json.load(open(src, encoding='utf-8'))
DB = p['DB']
num = lambda v: float(v) if v not in (None, '') else 0.0

elems = [e for e in DB.get('elements', []) if e.get('type') in ('finish_mill', 'kiln') and e.get('is_active') is not False]
eids = {e['id'] for e in elems}
rows = [r for r in DB.get('real_production_daily', []) if r.get('element_id') in eids and r.get('date') and num(r.get('volume_t')) > 0]
mill_ids = {e['id'] for e in elems if e['type'] == 'finish_mill'}
to = max((r['date'] for r in rows if r['element_id'] in mill_ids), default='')
if not to:
    sys.exit('No real production for the finish mills in this scenario.')
to_d = dt.date.fromisoformat(to[:10])
frm = min(to_d.replace(month=1, day=1), to_d - dt.timedelta(days=364)).isoformat()   # YTD or 12 months, whichever starts first
rows = [{'date': r['date'][:10], 'element_id': r['element_id'], 'product_id': r.get('product_id'), 'volume_t': num(r['volume_t'])}
        for r in rows if frm <= r['date'][:10] <= to]

caps = [c for c in DB.get('element_product_capacities', []) if c.get('element_id') in eids]
pids = {r['product_id'] for r in rows} | {c.get('product_id') for c in caps}
clk = {q['id'] for q in DB.get('products', []) if q.get('category') == 'clinker'}
recipes = [{'product_id': x['product_id'], 'material_id': x['material_id'], 'pct': x.get('pct')}
           for x in DB.get('recipes', []) if x.get('product_id') in pids and x.get('material_id') in clk]
pids |= {x['material_id'] for x in recipes}
products = [{'id': q['id'], 'name': q.get('name'), 'category': q.get('category')} for q in DB.get('products', []) if q['id'] in pids]
fids = {e.get('assigned_facility_id') or e.get('facility_id') for e in elems}
facilities = [{'id': f['id'], 'name': f.get('name')} for f in DB.get('facilities', []) if f['id'] in fids]
elements = [{'id': e['id'], 'name': e.get('name'), 'type': e['type'], 'is_active': True,
             'facility_id': e.get('assigned_facility_id') or e.get('facility_id')} for e in elems]
caps = [{'element_id': c['element_id'], 'product_id': c.get('product_id'), 'capacity_tpd': c.get('capacity_tpd')} for c in caps]

label = os.path.basename(src).replace('.json', '')
data = {'_bundled': {'from': label, 'made': dt.date.today().isoformat(), 'window': [frm, to]},
        'DB': {'facilities': facilities, 'elements': elements, 'products': products, 'recipes': recipes,
               'element_product_capacities': caps, 'real_production_daily': rows}}
body = json.dumps(data, separators=(',', ':'))
open(out, 'w', encoding='utf-8', newline='\r\n').write('window.AVILA_MILLS_DATA=' + body + ';\n')   # loads by itself next to the page
open(out[:-3] + '.json', 'w', encoding='utf-8', newline='\r\n').write(body)                         # for "Open a scenario JSON" / drop
print(f'{out} (+ .json): {len(body)//1024} KB, {len(elements)} mills+kilns, {len(products)} products, {len(rows)} production rows {frm} -> {to}')
