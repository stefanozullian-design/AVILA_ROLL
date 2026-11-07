# src/roll — the source of AVILA_Roll.html

`AVILA_Roll.html` at the repository root is **built**, never edited by hand. It stays in the
repository because it is what people copy, sync and open: one file, no dependencies.

```
python tools/build_roll.py            # rebuild AVILA_Roll.html from these parts
python tools/build_roll.py --check    # fails if AVILA_Roll.html is out of step with the parts
```

The parts are plain slices of the page, in page order:

| Part | What it holds |
|---|---|
| `head.html` | `<!DOCTYPE>` to the theme pre-paint script |
| `style.css` | the page stylesheet (the build adds the `<style>` tags) |
| `body.html` | all markup between the stylesheet and the script |
| `NN-*.js` | the one page script, cut at its region banners; sorted by the two-digit prefix and concatenated into a single `<script>` |
| `tail.html` | `</body></html>` |

Because the script parts are concatenated back into one inline `<script>`, they share one
global scope exactly as before: a function defined in `05-properties-panel.js` is called from
`10-supply-view.js` without any import. Order matters only for top-level `const`/`let`
statements that run at load time, which is why the parts keep the original order.

Cut points are the script's own `// ═══` banners, so each part is a self-contained region:

| Part | Region |
|---|---|
| 01 | date helpers, colour themes, Sales-page link, pinned third-party loader |
| 02 | `DB` (the scenario database and its table schema), fast lookups, element types, `S` state |
| 03 | organization tree, facility helpers |
| 04 | topology canvas: elements, connections, pan/zoom, labels, silo-transfer links |
| 05 | properties panel |
| 06 | maintenance modal, production campaigns, finish-mill policy overrides, vessel campaign popup |
| 07 | Elements management view |
| 08 | shared filter bar and KPI strip |
| 09 | Demand view and forecast table |
| 10 | Supply / Production view (the big grid) |
| 11 | Forecast Builder popup |
| 12 | Schedules: logistics filters, resizable row-title column |
| 13 | Rail Schedule (transport planner) |
| 14 | Vessel Schedule (transport planner) |
| 15 | simulation engine: `runSimulation()`, `simulate()` |
| 16 | golden-scenario self-test, Results dashboard |
| 17 | results rendering, daily results table |
| 18 | Push to BI (Power BI workbook export) |
| 19 | results filters, full-data export, results date window |
| 20 | chart engine, modals |
| 21 | Vessel SOF (Statement of Facts) and its Claude PDF reader |
| 22 | rulebook (plain-words rules) and Simulation Rules editor |
| 23 | Sales Performance (in-Roll copy) |
| 24 | Data Sources (File System Access API, imports) |
| 25 | Demand Mapping (SAP rows to demand points), actuals into the demand grid |
| 26 | UI controls, zoom hint, tooltip, AI helpers |
| 27 | chat agent and its tools |
| 28 | save / load, init |
| 29 | shared-file merge engine, change log |
| 30 | scenarios and version history |
| 31 | access control, topology seal |
| 32 | Budget Planning module |

Adding a region: create `NN-name.js` with the next free prefix at the right place in load
order, rebuild, check. Renumbering is not needed; prefixes only have to sort correctly.
