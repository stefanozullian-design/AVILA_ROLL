# Power BI model — AVILA Roll star-schema export

The **PUSH TO BI** button in AVILA Roll writes one XLSX containing 5 dimension sheets, 6 fact
sheets and a `meta` notes sheet. This is the model you build on top of it: **32 relationships**,
all one-to-many, all single cross-filter direction, dim → fact. **Three must be created
inactive.**

Every fact row carries `scenario_type` (`actual` | `forecast`) plus `as_of_date` and
`scenario_run_id`, so actuals and forecast live in the same tables and are separated by filter,
not by table.

---

## 1. Before you build anything (Power Query)

Relationships will not bind — or will bind and silently return blanks — until these are done.

1. **Retype the date columns.** They export as ISO `YYYY-MM-DD` **text**, not dates. Set to type
   **Date** in Power Query:
   - `dim_date[date]`
   - `fact_production[date]`, `fact_inventory[date]`, `fact_demand[date]`,
     `fact_unloading[date]`, `fact_stop_events[date]`
   - `fact_rail_movement[departure_date]` **and** `fact_rail_movement[arrival_date]`

   Use **Locale → English (United States)** if Power BI guesses the format wrong; the source is
   always unambiguous ISO.

2. **Mark the date table.** `Model view → dim_date → Mark as date table → [date]`. Without this,
   `DATESYTD`, `SAMEPERIODLASTYEAR` and every other time-intelligence function is unreliable.
   `dim_date` is emitted as a contiguous day-by-day calendar spanning every date any fact can
   reference (including rail arrivals past the simulation horizon), so it is safe to mark.

3. **Keep the id columns as Text.** All ids are strings. Power BI sometimes types a
   numeric-looking id column as Whole Number on one side and Text on the other, and the
   relationship then refuses to create. Check both sides of every pair below.

4. **Leave "Assume referential integrity" off.** Fact rows whose key did not resolve carry a
   blank, which is valid and lands in the dimension's blank member.

5. **Do not remove columns you think are unused.** `origin`, `product_key`, `element_type` and
   `ship_to` are the trace back to the source row when a key does not resolve.

---

## 2. The relationships

All 32 are **one-to-many (1:\*)** with **single** cross-filter direction, from the dimension to
the fact.

### `dim_date[date]` → 7

| # | Fact column | Active |
|---|---|---|
| 1 | `fact_production[date]` | ✅ |
| 2 | `fact_inventory[date]` | ✅ |
| 3 | `fact_demand[date]` | ✅ |
| 4 | `fact_unloading[date]` | ✅ |
| 5 | `fact_stop_events[date]` | ✅ |
| 6 | `fact_rail_movement[departure_date]` | ✅ |
| 7 | `fact_rail_movement[arrival_date]` | ⬜ **inactive** |

### `dim_facility[facility_id]` → 7

| # | Fact column | Active |
|---|---|---|
| 8 | `fact_production[facility_id]` | ✅ |
| 9 | `fact_inventory[facility_id]` | ✅ |
| 10 | `fact_demand[facility_id]` | ✅ |
| 11 | `fact_unloading[facility_id]` | ✅ |
| 12 | `fact_stop_events[facility_id]` | ✅ |
| 13 | `fact_rail_movement[from_facility_id]` | ✅ |
| 14 | `fact_rail_movement[to_facility_id]` | ⬜ **inactive** |

`dim_facility` already carries `sub_region`, `region` and `country` as columns, so the whole
org hierarchy is available without relating to any other table.

### `dim_element[element_id]` → 7

Three of these do **not** use the column name `element_id` on the fact side. This is the most
commonly missed group.

| # | Fact column | Active |
|---|---|---|
| 15 | `fact_production[element_id]` | ✅ |
| 16 | `fact_inventory[element_id]` | ✅ |
| 17 | `fact_stop_events[element_id]` | ✅ |
| 18 | `fact_unloading[berth_id]` | ✅ |
| 19 | `fact_demand[demand_point_id]` | ✅ |
| 20 | `fact_rail_movement[dispatch_id]` | ✅ |
| 21 | `fact_rail_movement[berth_id]` | ⬜ **inactive** |

`dim_element` holds every element of every type — kilns, mills, silos, berths, dispatch points
and demand points — so slice it by `element_type` rather than expecting separate tables.

### `dim_product[product_id]` → 5

| # | Fact column | Active |
|---|---|---|
| 22 | `fact_production[product_id]` | ✅ |
| 23 | `fact_inventory[product_id]` | ✅ |
| 24 | `fact_demand[product_id]` | ✅ |
| 25 | `fact_unloading[product_id]` | ✅ |
| 26 | `fact_rail_movement[product_id]` | ✅ |

Roll up with `product_family` (Cement = bulk + packed, SCM = additive) or `category`. `scm_type`
splits `category = additive` into slag vs. ash, which `category` alone cannot do.

### `dim_scenario[scenario_run_id]` → 6

| # | Fact column | Active |
|---|---|---|
| 27 | `fact_production[scenario_run_id]` | ✅ |
| 28 | `fact_inventory[scenario_run_id]` | ✅ |
| 29 | `fact_demand[scenario_run_id]` | ✅ |
| 30 | `fact_unloading[scenario_run_id]` | ✅ |
| 31 | `fact_rail_movement[scenario_run_id]` | ✅ |
| 32 | `fact_stop_events[scenario_run_id]` | ✅ |

A single export has one scenario row, so these do nothing on their own. They exist so several
exports can be **appended** in Power Query (one query per fact, `Append Queries`, plus an append
of the `dim_scenario` sheets) and then compared run against run with a `scenario_run_id` slicer.

---

## 3. Relationships to deliberately NOT create

**`dim_element[facility_id] → dim_facility[facility_id]`** and
**`dim_product[facility_id] → dim_facility[facility_id]`.**

Both look reasonable and both break the model. Every fact already relates to `dim_facility`
directly, so adding a dim→dim hop creates a second path from each fact to `dim_facility`. Power
BI reports an ambiguous path and deactivates one of the relationships — usually not the one you
expected, and the filter behaviour then depends on which survived.

You do not need them: `dim_product` already carries `facility_name`, and `dim_element` carries
`facility_id`. If `dim_element` needs `facility_name` or the region columns, **merge** them in
Power Query (Merge Queries on `facility_id`, expand the columns you want) rather than relate.

**Anything bidirectional.** Every relationship above is single-direction. If a slicer needs to
filter across two facts, use a disconnected slicer table with a measure, or filter on a shared
dimension. Bidirectional filters on a model with this many shared dimensions produce ambiguity
errors and hard-to-trace measure results.

---

## 4. Role-playing dimensions

`fact_rail_movement` is the only fact that needs them, and it needs three: a movement has a
departure and an arrival date, an origin and a destination facility, and both a dispatch point
and a receiving berth. Only one relationship per table pair can be active, hence #7, #14, #21.

**Default: inactive + `USERELATIONSHIP`.** Measures in §5 activate each one where needed. This
keeps a single `dim_date`, a single `dim_facility` and a single `dim_element`.

**When you need a slicer, not a measure:** a slicer cannot activate an inactive relationship. To
slice by arrival date (e.g. "what lands in week 32"), add a physical copy:

1. Power Query → right-click `dim_date` → **Reference** → rename `dim_date_arrival`.
2. Relate `dim_date_arrival[date]` → `fact_rail_movement[arrival_date]`, **active**.
3. Do **not** mark it as a date table — a model has one date table, and marking a second one
   makes time intelligence ambiguous. Use it for slicing and grouping only.

The same pattern gives you `dim_facility_destination` for `to_facility_id` if you want a
destination slicer next to an origin slicer on the same page.

---

## 5. Starter DAX

Measures that make the inactive relationships reachable:

```dax
Rail Tonnes =
SUM ( fact_rail_movement[tonnes] )                      -- by departure date, origin facility

Rail Tonnes (Arrival) =
CALCULATE (
    SUM ( fact_rail_movement[tonnes] ),
    USERELATIONSHIP ( dim_date[date], fact_rail_movement[arrival_date] )
)

Rail Tonnes Inbound =
CALCULATE (
    SUM ( fact_rail_movement[tonnes] ),
    USERELATIONSHIP ( dim_facility[facility_id], fact_rail_movement[to_facility_id] )
)

-- What actually lands at a facility on a date: both role-playing keys at once.
Rail Tonnes Inbound on Arrival =
CALCULATE (
    SUM ( fact_rail_movement[tonnes] ),
    USERELATIONSHIP ( dim_date[date],              fact_rail_movement[arrival_date] ),
    USERELATIONSHIP ( dim_facility[facility_id],   fact_rail_movement[to_facility_id] )
)

Rail Tonnes to Berth =
CALCULATE (
    SUM ( fact_rail_movement[tonnes] ),
    USERELATIONSHIP ( dim_element[element_id], fact_rail_movement[berth_id] )
)
```

The actual-vs-forecast pattern — put both on one chart instead of filtering the whole page:

```dax
Production Actual =
CALCULATE ( SUM ( fact_production[tonnes] ), fact_production[scenario_type] = "actual" )

Production Forecast =
CALCULATE ( SUM ( fact_production[tonnes] ), fact_production[scenario_type] = "forecast" )

Demand Actual =
CALCULATE ( SUM ( fact_demand[demand_t] ), fact_demand[scenario_type] = "actual" )

Demand Forecast =
CALCULATE ( SUM ( fact_demand[demand_t] ), fact_demand[scenario_type] = "forecast" )
```

Inventory is **semi-additive** — a stock level, not a flow. Summing `tonnes_eod` across dates
adds the same tonnes once per day and is meaningless. Take the closing balance:

```dax
Inventory EOD =
CALCULATE ( SUM ( fact_inventory[tonnes_eod] ), LASTDATE ( dim_date[date] ) )

-- Safe when the last date in context has no reading (a silo with no activity):
Inventory EOD (carried) =
CALCULATE (
    SUM ( fact_inventory[tonnes_eod] ),
    LASTNONBLANK ( dim_date[date], CALCULATE ( COUNTROWS ( fact_inventory ) ) )
)
```

Across facilities or products it still sums correctly on a single date, because the
non-additivity is only over time.

---

## 6. Notes on the data

- **Forecast scope.** Forecast rows cover only the facility the simulation last ran for. Actuals
  span every facility in the catalog. Run a sim per facility before exporting if you want
  forecast coverage everywhere. The active facility is in `dim_scenario`.
- **Blank keys.** A blank fact key means the source row had no catalog match and the row lands
  in the dimension's blank member. `fact_demand` keeps `origin` and `product_key` as raw text
  precisely so those rows can be traced back.
- **Forecast inventory** is the silo total attributed to the silo's primary product — the
  per-product split is not retained after a simulation run. Actual inventory carries its own
  `product_id`.
- **Forecast mill tonnes** are estimated as rated tpd for the chosen product on running days.
  Kiln tonnes are real simulation output.
- **`fact_demand` mixes two grains:** planned/forecast demand (`demand_t`, keyed on a demand
  point) and shipped actuals from the sales upload (`shipped_t`, with `customer_type`,
  `sales_manager`, `ship_to`). Measure over the column that matches the question; do not add
  them together.
- The `meta` sheet carries these notes with the export itself. It is key/value text and is **not**
  part of the model — do not relate it.
