# GPS Explorer: Design Document

> **Status:** Proposal
> **Date:** 2026-03-31
> **Context:** Spun out from Bowser V2 GPS overlay work. The live GPS overlay in bowser revealed that raw GPS data needs significant preprocessing before it's useful alongside InSAR.

---

## Problem

InSAR researchers need GPS ground truth to validate their displacement results. But the raw GPS data from public sources (UNR, JPL) is not directly comparable to InSAR because:

1. **Different reference frames** — GPS displacements are relative to a tectonic plate model; InSAR is relative to a local reference point
2. **Different time spans** — GPS stations may have 15+ years of data; an InSAR stack might cover 2 years
3. **Noisy stations** — UNR processes everything automatically; many stations have gaps, jumps, or equipment changes that make them useless without cleanup
4. **3D vs 1D** — GPS measures East/North/Up; InSAR measures a single Line-of-Sight component. Projection requires knowing the SAR viewing geometry.
5. **No curation** — There's no easy way to browse, compare, and select "good" stations for a given area

Currently, researchers write ad-hoc scripts to download GPS data, manually inspect timeseries in matplotlib, pick reference stations, filter bad ones, and export. This takes hours and is repeated for every new study area.

---

## Solution: GPS Explorer

A lightweight web app for interactive GPS station exploration, curation, and export. The output is a clean GeoParquet file of processed GPS timeseries that can be loaded directly into bowser (or any other tool) as a point layer.

### Core Workflow

```
1. Define AOI (bbox, draw polygon, or auto-detect from InSAR data)
       ↓
2. Fetch stations from UNR/JPL → show on map
       ↓
3. Browse: click stations to see timeseries, compare multiple
       ↓
4. Curate: mark bad stations, note issues (antenna change, etc.)
       ↓
5. Set parameters: reference station, time window, smoothing
       ↓
6. Process: subtract reference, project to LOS, filter, smooth
       ↓
7. Export: GeoParquet with processed timeseries → load in bowser
```

---

## Where Should It Live?

### Option A: Subcommand of `geepers` (`geepers explore`)

**Pros:**
- geepers already has the GPS data fetching, reference selection, and LOS projection logic
- Natural home — geepers is the GPS library, this is the GPS UI
- Keeps bowser focused on InSAR viewing
- geepers users who don't use bowser still benefit

**Cons:**
- geepers is currently a pure Python library with no web dependencies
- Adding FastAPI/React would significantly change geepers's dependency footprint
- The web UI code doesn't really belong in a data library

### Option B: Standalone repo (`gps-explorer`)

**Pros:**
- Clean separation of concerns
- Can depend on both geepers (data) and borrow UI patterns from bowser (frontend)
- Independent release cycle
- Could be published as a standalone tool on PyPI

**Cons:**
- Yet another repo to maintain
- Code sharing with bowser is copy-paste rather than import

### Option C: Subcommand of `bowser` (`bowser gps-explore`)

**Pros:**
- Shares bowser's frontend build system, MapLibre, Plotly, etc.
- Users who have bowser already have everything they need
- The output GeoParquet integrates seamlessly with `bowser run --manifest`

**Cons:**
- Adds GPS data dependencies (geepers, network access) to bowser
- Muddies bowser's purpose (is it a viewer or a data processing tool?)

### Recommendation: **Option A** (`geepers explore`)

geepers is the natural home. The dependency concern is manageable:
- Make the web UI an optional extra: `pip install geepers[explorer]`
- The explorer imports FastAPI/uvicorn/maplibre only when `geepers explore` is run
- The core geepers library stays lightweight

If `geepers` maintainers prefer to keep it pure-Python, then **Option B** (standalone) is the fallback. Option C (bowser subcommand) is the least preferred because it creates a circular dependency between the viewer and the data source.

---

## Features

### Map View
- MapLibre GL JS with satellite/OSM basemap toggle
- Station markers colored by data quality or velocity
- Click to select, shift+click to multi-select
- Draw rectangle to select stations in region
- Station labels (4-char codes) at appropriate zoom levels

### Timeseries View
- Plotly chart showing E/N/U or LOS-projected timeseries
- Multi-station comparison (up to ~10 stations overlaid)
- Trend lines with mm/yr rates
- Date range selection (drag to zoom on time axis, or input fields)
- Highlight jumps/gaps automatically (if geepers provides this)

### Station Curation
- Table or list view of all stations in AOI
- Columns: name, lon, lat, start date, end date, # observations, data gaps, velocity
- Sort/filter by any column
- Checkbox to include/exclude stations
- Notes field (free text) for documenting why a station was excluded
- Automatic quality scoring: flag stations with >30% missing data, large jumps, etc.

### Reference Station Selection
- Manual: click a station to set as reference
- Auto: use geepers `auto_select_reference` (picks the station with best long-term stability)
- Visual feedback: show the effect of referencing (before/after toggle)

### Processing Pipeline
- **Time filter**: restrict to a date range (e.g., matching the InSAR epoch)
- **Reference subtraction**: subtract reference station's timeseries from all others
- **LOS projection**: project ENU to radar LOS using a provided LOS vector
- **Smoothing**: optional median filter or running average
- **Outlier removal**: optional sigma-clipping per station

### Export
- **GeoParquet**: primary output format, directly loadable as a bowser point layer
  - Schema: `station_id, geometry, velocity, velocity_std, [date columns or long-form timeseries]`
- **CSV**: for quick inspection in Excel/Google Sheets
- **JSON**: station list with metadata (for programmatic use)
- **bowser manifest snippet**: auto-generate the GPS layer config for bowser_manifest.json

---

## Technical Architecture

### Backend (Python)
```
geepers/explorer/
    __init__.py
    app.py          # FastAPI app
    routes.py       # Endpoints
    processing.py   # Reference subtraction, LOS projection, smoothing
```

### Endpoints
```
GET  /stations?bbox=...&source=unr     → station list
GET  /stations/{id}/timeseries         → raw ENU timeseries
POST /process                          → apply reference, time filter, LOS, smoothing
GET  /export?format=geoparquet&...     → download processed data
GET  /auto_reference?bbox=...          → suggest best reference station
```

### Frontend (TypeScript/React)
Reuse bowser's patterns:
- MapLibre map with station markers
- Plotly chart for timeseries
- Dark/light theme
- URL state for shareability

### Dependencies (beyond geepers core)
```
fastapi
uvicorn
maplibre (frontend)
plotly (frontend)
react (frontend)
```

These would be in `geepers[explorer]` optional extra.

---

## Integration with Bowser

The GPS Explorer outputs a GeoParquet file that bowser loads as a regular point layer. No special GPS code needed in bowser's viewer.

### Workflow
```bash
# 1. Explore and curate GPS stations
geepers explore --bbox -103,31,-102,32 --los '{"east": 0.477, "north": -0.449, "up": 0.755}'

# 2. In the explorer UI: select stations, set reference, set time window, export
#    → saves processed_gps.parquet

# 3. Add to bowser manifest
#    (or the explorer auto-generates a manifest snippet)

# 4. View in bowser alongside InSAR
bowser run --manifest my_manifest.json
```

### What Bowser Keeps
The current live GPS overlay in bowser (`/gps` endpoints) stays as a **quick-look preview** — useful for seeing what stations exist in the area, but not for publication-quality comparison. The explorer is where the real work happens.

---

## MVP Scope (v0.1)

For the first version, keep it minimal:

1. **Fetch stations** for a bbox from UNR
2. **Map + chart** with click-to-plot, multi-select
3. **Time filter** (date range inputs)
4. **Reference station** selection (manual click)
5. **LOS projection** with constant vector
6. **Export** as GeoParquet + CSV

Skip for v0.1:
- Automatic quality scoring
- Smoothing/outlier removal
- JPL source (start with UNR only)
- GeoTIFF LOS (constant vector only)
- Station notes/curation persistence

---

## Open Questions

1. **Where to build it?** geepers subcommand vs standalone repo — depends on geepers maintainer preference
2. **Frontend build system?** Vite (matching bowser) or simpler (e.g., bundled single HTML file with inline JS)?
3. **State persistence?** Save curation state (included/excluded stations, reference, time window) to a JSON file so you can resume later?
4. **Offline mode?** Cache downloaded GPS data locally so you don't need internet after first fetch?
