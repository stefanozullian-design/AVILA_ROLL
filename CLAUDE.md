# AVILA Roll

Supply-and-operations planning (S&OP) tool for a cement network: plants, terminals,
kilns, finish mills, silos, packers, demand points, vessels and rail. It simulates
production, inventory and dispatch day by day and reports against real data.

Everything is plain HTML + CSS + JavaScript in single files. **No build step, no
framework, no server, no package manager, no tests folder.** The pages are opened from
a folder (OneDrive / SharePoint) in **Chrome or Edge**: they rely on the File System
Access API (`showOpenFilePicker`, `showDirectoryPicker`) to read and write scenario files.

## Files

| File | What it is |
|---|---|
| `AVILA_Roll.html` | The main app (~37,000 lines, 2.5 MB). **Built from `src/roll/`, never edited by hand.** `index.html` only redirects here. |
| `src/roll/` | The Roll's source: `head.html`, `style.css`, `body.html`, 32 numbered `NN-*.js` script parts cut at the script's region banners, `tail.html`. Its README maps each part to a feature area. |
| `tools/build_roll.py` | Concatenates `src/roll/` into `AVILA_Roll.html` (CRLF). `--check` fails when the shipped file is out of step with the parts. |
| `AVILA_Mills.html` | **Mill Balance**: a stand-alone what-if page that trades finish-mill time between cements. Reads the active Roll scenario, never writes it. Opened from the Roll's Production section in its own tab. |
| `AVILA_Sales.html` | **Sales Detail / Sales Performance**: a stand-alone page with its own Sales file. Opened from the Roll's Demand section. Shares `localStorage` with the Roll. |
| `tools/make_mills_data.py` | Builds `AVILA_Mills_data.js` (+ `.json`) from a scenario JSON: only what the Mills page needs. |
| `tools/make_mills_standalone.py` | Inlines that data file (and optional user defaults) into `AVILA_Mills.html` to produce one hand-over file. |
| `tools/smoke_load.js` | Headless Playwright load of the three pages. Run before every push (see *Verifying a change*). |
| `MAPPING_SUMMARY.md` | Historical note on the demand-point / product restructuring. Reference only. |
| `.github/workflows/claude.yml` | Claude Code GitHub Action (`@claude` on issues and PRs). |

The stray file named `Claude Code` at the root is an 80-byte fragment of that workflow,
not code. Leave it alone unless the user asks.

## The repository is public. Never commit plant data.

Scenario JSON files, `AVILA_Mills_data.js` / `.json`, `AVILA_Mills_standalone.html`,
Excel imports (production, shipments, transfers), SOF PDFs and any API key are **data
or secrets and stay out of git**. Only the three pages, `tools/`, and docs are committed.
If a task hands you a scenario file to test with, keep it in the scratchpad directory.

## How AVILA_Roll.html is organised

**Edit the parts in `src/roll/`, then run `python tools/build_roll.py`, and commit both the
parts and the rebuilt page.** The build only concatenates: `head.html`, the stylesheet, the
markup, then every `NN-*.js` in prefix order inside one `<script>`, then `tail.html`. The
script parts therefore share one global scope exactly as before, with no imports; load order
matters only for top-level `const`/`let` that run at load time. About 1,400 top-level
functions. `src/roll/README.md` says which part holds which feature.

Landmarks worth jumping to (search by name with `grep -n` across `src/roll/`):

- `const DB = {` — the **scenario database**. Every table is listed with a comment
  describing its row shape. Read this first for any data question. Collections cover
  geography (`facilities`, `sub_regions`…), topology (`elements`, `connections`,
  `topo_labels`), products and recipes, capacities and maintenance events, logistics
  (`vessel_calls`, `vessel_sof`, `rail_movements`, `silo_links`, `silo_transfer_plans`),
  demand (`demand_points`, `demand_values`), budget planning (`plan_*`, `alloc_keys`,
  `norm_rules`), simulation rules and outputs (`simulation_*`), real data
  (`real_production_daily`, `real_inventory_daily`, `real_shipments_daily`…), and
  access control (`access_users`, `change_requests`).
- `const S = {` — **UI state** (current view, facility, selection, `simCfg`, `simResults`).
  Not saved in the scenario except `simCfg`.
- `switchTopSection()` / `switchView()` — navigation. Top sections and their tabs:
  **Production** (Production/Supply grid, Products, Elements, Maintenance Calendar, Mill
  Balance ↗), **Logistics** (Vessel, Rail, Silo Transfers), **Demand** (Demand, Sales
  Detail ↗), **Results** (Dashboard, Data Table, Push to BI), **Configuration**
  (Organization, Settings, Simulation Rules, Data Sources, Demand Mapping, Budget Planning).
  Each section also has a 📘 Rules page describing what the simulator does there.
- `runSimulation()` → `simulate(elements, connections, horizon, includeProposed)` — the
  **engine**. Output goes to `S.simResults` and the transient `simulation_*` tables.
- `pushToBI()` — the **Power BI export** (an .xlsx of `fact_*` and `dim_*` sheets written
  to a chosen folder). Its `notes` sheet carries `export_version` (currently 8) and a note
  per non-obvious column; when you change what a column means, bump the version and update
  the note in the same commit (the Budget / BI dashboards downstream read these).
- `scIsPlanning()` — the only correct test for "is this a **Planning scenario**". It reads
  `simCfg.role === 'planning'`. **`simCfg.mode` is a legacy label that defaults to
  `'planning'` in every file and must never gate behaviour.**
- `// SCENARIOS` banner — each scenario is its own JSON file on disk
  (`{DB, simCfg, …}`); file handles persist in IndexedDB `avila_scenarios`, metadata
  in `localStorage`. Autosave mirrors edits into the file. `SC_TRANSIENT` lists the tables
  that are regenerated on run and therefore not saved.
- `COLOUR THEMES`, `TOPOLOGY LABELS`, `TOPOLOGY SEAL`, `ACCESS CONTROL`, `SILO TRANSFERS`
  — named sections that comments cross-reference as "see X". Search for the capitalised
  name.
- Browser-side calls to `api.anthropic.com` go through `callClaude()` (plus a streaming
  call for the SOF PDF reader). Three features use them: reading a vessel's SOF PDF into
  the time table, turning a natural-language Simulation Rule into a structured one, and
  the in-page chat agent with what-if tools (`agentTool*`). The key is the user's own,
  kept in `localStorage`; never hard-code one.

External libraries are loaded from CDNs: Chart.js 4.4.1 and SheetJS 0.20.3. Fonts
Space Mono and Syne from Google Fonts. Don't add dependencies.

## Conventions

- **Colours are CSS variables only.** Never write a hex colour in markup or JS. A new
  colour goes into `:root` **and** every `html[data-theme=…]` block (`daylight`, `slate`)
  in the page you touch, with its `--x-rgb` triplet if tints are needed. Semantic
  colours: `--real` (green, actual data), `--simulated` (amber, forecast), `--plan`
  (cyan, budget), `--total`.
- **Dates** are `'YYYY-MM-DD'` strings. Day arithmetic anchors at noon so DST never
  moves a date. Follow the existing helpers rather than `new Date(str)`.
- **Per-viewer preferences** (theme, column widths, collapsed rows, which charts are
  shown) live in `localStorage` under `avila_*` keys. **Business data** lives in `DB` and
  is saved with the scenario. Don't blur this line.
- **Comments explain the business rule**, in prose, not the syntax. Keep that voice.
  Hard-won semantics (what `day_frac` means, what counts as a stop) are written down next
  to the code; update them when behaviour changes.
- **Line endings**: the built `AVILA_Roll.html` and `AVILA_Sales.html` are CRLF; the
  `src/roll/` parts and everything else are LF (the build normalises, so a CRLF checkout
  of the parts builds the same bytes). Preserve each file's existing endings. Never
  reformat, re-indent or minify: a diff that touches thousands of lines cannot be reviewed.
- **Edit surgically.** Work in the `src/roll/` part that owns the feature; read only the
  line ranges you need (`grep -n`, then `sed -n`). Make exact string replacements. After an
  edit, re-read the surrounding 20 lines to confirm the template literal or `onclick`
  string you were inside is still closed. A new region gets its own `NN-name.js` at the
  right place in load order rather than growing an unrelated part.
- **Dead code goes, it is not kept "for reference".** Git has the history. A function that
  nothing references (check the whole file, markup and strings included) is removed.
- **Mills and Sales mirror the Roll's theme block.** A theme change in the Roll is usually
  wanted in the other two pages as well.

## Verifying a change

There is no test suite. Do this much, every time, before pushing:

1. `python tools/build_roll.py --check` — the shipped Roll must be exactly what the parts
   build. If you edited a part, run the build first; if you edited `AVILA_Roll.html`
   directly by mistake, move the change into the part and rebuild.
2. `node tools/smoke_load.js` — loads the three pages headless and fails on any uncaught
   error. Playwright and Chromium are pre-installed in the cloud environment.
3. For a **behaviour change** (engine, Supply grid, Push to BI): open the Roll in
   Playwright with a scenario the user provided, exercise the changed path, and screenshot
   the result into the scratchpad. Describe what the screenshot shows in the final message.
4. For a **bug fix**: reproduce the failure first, then show the same check passing.
5. The Roll has a built-in **golden-scenario self-test** (🧪 button in the top bar:
   `stSaveBaseline()` / `stRunCheck()`). It digests a simulation run and compares it with a
   saved baseline. Ask the user to run it after engine changes; it catches silent drift.

Report what you ran and what you saw. If you could not verify something, say so plainly.

## Working style that has worked here

- **Commit messages** are one line, `Area: what the user now sees`, written for a
  changelog, not for a developer. Examples from the history:
  `Supply: a half-day PM from the Maintenance Calendar shows the 50 % day, not a full stop`,
  `Mill Balance: scenarios belong to one plant`. No bodies needed unless a semantic changed
  that BI consumers must know about.
- **One concern per commit**, pushed to the session's `claude/…` branch. Don't open pull
  requests unless asked.
- **Batch small visual tweaks** into one commit when they arrive in one message.
- The clone is **shallow** (50 commits). `git log` does not show the project's full
  history; don't draw conclusions from where it starts.

## Vocabulary

| Term | Meaning here |
|---|---|
| Scenario | One JSON file = one full `DB` + `simCfg`. The active scenario is the source of truth for topology. |
| Element | A node on the topology canvas: kiln, finish mill, silo, packer, berth, rail dispatch, demand point… `type` + `props`. |
| Facility | A plant, terminal or purchased source. Elements belong to one. |
| Demand point | Where product leaves the network; has a demand mode (fixed daily, forecast…) and a product list with priorities. |
| Swap / substitution | Serving a demand point with a different product than asked (`demand_substitutions`). |
| Real / simulated / plan | Actual imported data (green), the engine's forecast (amber), the budget plan (cyan). |
| PM | Planned maintenance. A **half-day PM** is a 0.5-day Maintenance Calendar event or a Down PM Day campaign: the unit runs at 50 % that day (`day_frac = 0.5`), it is not a stop. |
| SOF | Statement of Facts for a vessel call (port times). Read from PDF via Claude. |
| Push to BI | One-click export of the Power BI workbook. Versioned; see above. |
| Budget / Planning scenario | A scenario with `simCfg.role === 'planning'` (see `scIsPlanning()`). It generates `plan_demand` from uploaded plan lines and reads no data slot; its Push to BI feeds the Budget dashboard, including yield-sensitivity runs. The Sales page must never see it as the active scenario. |
| Topology / Proven / Custom (Mills page) | Basis for mill yields: rated from the Roll, what the mills actually showed, or the user's own numbers. |
| Held cement (Mills page) | A cement whose annual tonnes are locked; the other levers trade around it (solved as a linear programme). |
| Golden baseline | A saved digest of a simulation run used by the 🧪 self-test. |
