# CEM Demand View Restructuring - Mapping Summary

## Overview
Successfully restructured the CEM Demand section to display demand points with attached products instead of products under facilities.

**Status:** ✅ **COMPLETE**

---

## Changes Made

### 1. JSON Data Structure
- **File Updated:** `AVILA_Roll_BRS_2026-05-06 (3).json`
- **Backup Created:** `AVILA_Roll_BRS_2026-05-06 (3).json.backup`
- **Total Demand Points:** 40
- **Mapped with Products:** 40 (100%)

#### Example Structure:
```json
{
  "id": "el_45",
  "type": "demand_point",
  "name": "BRS/DEM/BRS_ILX/BLK/INT",
  "props": {
    "demand_mode": "Fixed Daily",
    "daily_tonnage": 26,
    "dispatch_schedule": "mon_sat",
    "products": ["brs_ilx_blk"]
  }
}
```

### 2. Dashboard Code
- **File Updated:** `AVILA_Roll.html` (pushed to GitHub)
- **Repository:** https://github.com/stefanozullian-design/AVILA_ROLL
- **Changes:**
  - Added demand point grouping with collapsible headers
  - Products now displayed as sub-rows under demand points
  - Added `_demToggleDp()` function for expand/collapse state
  - Color-coded hierarchy: green headers (demand points) → blue rows (products)

---

## Mapping Summary

### Automatic Mappings (18 demand points)
These were matched by analyzing product codes in the JSON:
- BRS_ILX → brs_ilx_blk
- BRS_SPC → brs_spc_blk
- SUT_ILX → brs_ilx_blk
- TAM_ILX → tam_ilx_blk
- MIA_ILX → mia_ilx_blk
- MIA_IL8 → mia_il8_blk
- PEV_OPC → med_opc_blk
- And more...

### Manual Mappings (22 demand points)
These required custom logic based on product code analysis:

| Product Code | Mapped To | Notes |
|---|---|---|
| SPC_XXX | brs_spc_blk | Special code, matched to BRS special cement |
| MIA_SPC | mia_spc_blk | Miami special cement |
| MIA_OPC | med_opc_blk | OPC (Ordinary Portland Cement) |
| SLG_RIZ | riz_slg | Slag/Rizolite product |
| TAM_WHT | tam_wht | Tamworth white cement (packed) |
| ASH_BOW | bwn_ash | Brown ash product |

---

## Facilities Breakdown

| Facility | Demand Points | Products |
|---|---|---|
| BRS | 8 | brs_ilx_blk, brs_spc_blk |
| JAX | 2 | brs_ilx_blk |
| ORL | 4 | brs_ilx_blk, bwn_ash |
| SUT | 8 | brs_ilx_blk, tam_ilx_blk, bwn_ash, riz_slg |
| PEV | 6 | riz_slg, tam_wht, med_opc_blk |
| WPB | 2 | riz_slg |
| MIA | 10 | mia_spc_blk, mia_ilx_blk, mia_il8_blk, med_opc_blk |
| **TOTAL** | **40** | **13 unique products** |

---

## New Display Hierarchy

**Before:**
```
Facility
  ├─ Product 1 → values
  ├─ Product 2 → values
  └─ Product 3 → values
```

**After:**
```
Facility
  ├─ Demand Point 1 ▼ (collapsible)
  │  └─ Product 1 → values
  ├─ Demand Point 2 ▼ (collapsible)
  │  ├─ Product 1 → values
  │  └─ Product 2 → values
  └─ Demand Point 3 ▼ (collapsible)
     └─ Product 1 → values
```

---

## Next Steps

1. **Import JSON**: Load the updated JSON file into the dashboard
2. **Verify Display**: Check the CEM Demand tab to see the new hierarchy
3. **Test Expand/Collapse**: Click demand point headers to toggle product visibility
4. **Input Forecast**: Enter demand values for each product

---

## Files Modified

- ✅ `AVILA_Roll_BRS_2026-05-06 (3).json` - Added products array to all 40 demand points
- ✅ `AVILA_Roll.html` - Updated renderDemandView() function and added _demToggleDp()
- ✅ GitHub repository - Changes pushed to main branch

---

## Rollback Plan

If you need to revert:
```bash
# Restore JSON backup
cp AVILA_Roll_BRS_2026-05-06 (3).json.backup AVILA_Roll_BRS_2026-05-06 (3).json

# Revert GitHub changes
git revert c3e21e6
```

---

**Generated:** 2026-05-06
**Status:** Ready for testing
