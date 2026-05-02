export interface LosMetadata {
  // Satellite ground-track heading, degrees clockwise from north
  heading_deg: number;
  // Center-swath incidence angle (degrees). Near/far give the swath extent.
  incidence_deg: number;
  incidence_deg_near?: number;
  incidence_deg_far?: number;
  // Ground -> satellite ENU unit vectors. Center is the main LOS; near/far
  // trace the swath and are optional.
  los_enu_ground_to_sat?: { east: number; north: number; up: number };
  los_enu_ground_to_sat_near?: { east: number; north: number; up: number };
  los_enu_ground_to_sat_far?: { east: number; north: number; up: number };
}

export interface RasterGroup {
  name: string;
  file_list: string[];
  mask_file_list: string[];
  mask_min_value: number;
  nodata: number | null;
  uses_spatial_ref: boolean;
  algorithm: string | null;
  latlon_bounds: [number, number, number, number];
  x_values: Array<number | string>;
  available_mask_vars: string[];
  label?: string;
  unit?: string;
  reference_date?: string | null;
  los_metadata?: LosMetadata;
}

export interface TimeSeriesPoint {
  id: string;
  name: string;
  position: [number, number]; // [lat, lng]
  color: string;
  visible: boolean;
  data?: { [dataset: string]: number[] };
  trendData?: { [dataset: string]: { slope: number; intercept: number; rSquared: number; mmPerYear: number } };
}

export interface MultiPointTimeSeriesData {
  labels: string[];
  datasets: {
    label: string;
    pointId: string;
    data: Array<{ x: string; y: number }>;
    borderColor: string;
    backgroundColor: string;
    trend?: {
      slope: number;
      intercept: number;
      rSquared: number;
      mmPerYear: number;
    };
  }[];
}

export interface BaseMapItem {
  url: string;
  attribution: string;
}

export interface LayerMask {
  id: string;
  dataset: string;
  threshold: number;
  mode: 'min' | 'max';  // 'min' = keep pixels >= threshold; 'max' = keep pixels <= threshold
}

// A vector AOI uploaded by the user (KML/KMZ/SHP-zip/GeoJSON normalised
// server-side to GeoJSON). Rendered on the map as a Leaflet overlay; can
// also be passed to /polygon_stats for zonal statistics.
export interface VectorOverlay {
  id: string;            // server-assigned overlay_<uuid>
  name: string;          // original filename
  url: string;           // /vectors/<id>.geojson on the same origin
  color: string;         // user-chosen stroke / fill color
  visible: boolean;
  bbox: [number, number, number, number]; // lon_min, lat_min, lon_max, lat_max
  n_features: number;
  // Selecting a single Feature for stats (Polygon / MultiPolygon only).
  // Keyed off the GeoJSON feature index. Null = whole collection (we
  // run stats on each feature in v1; null disables stats).
  selectedFeatureIdx: number | null;
}

// Time-series statistics result for one polygon, keyed by dataset name
// to make follow-up "compare two datasets" easy. Stored on AppState so
// the chart panel can read it without re-fetching.
export interface PolygonStats {
  overlayId: string;
  featureIdx: number;
  dataset: string;
  // 2-D variables: only `summary`; 3-D variables: also `time` + `series`.
  summary: PolygonStatRow;
  time?: string[];
  series?: PolygonStatRow[];
  n_pixels: number;
}

export interface PolygonStatRow {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  count_valid: number;
  count_total: number;
}

export interface ChartWindow {
  id: string;
  dsNames: string[];  // datasets shown in this window; empty = follow currentDataset
}

export interface AppState {
  datasetInfo: { [key: string]: RasterGroup };
  timeSeriesPoints: TimeSeriesPoint[];
  chartWindows: ChartWindow[];
  refMarkerPosition: [number, number];
  currentDataset: string;
  currentTimeIndex: number;
  refValues: { [key: string]: number[] };
  selectedBasemap: string;
  dataMode: string;
  colormap: string;
  vmin: number;
  vmax: number;
  opacity: number;
  showChart: boolean;
  selectedPointId: string | null;
  showTrends: boolean;
  showResiduals: boolean;
  layerMasks: LayerMask[];
  customMaskPath: string | null;
  bufferEnabled: boolean;
  bufferRadius: number;
  bufferSamples: number;
  refEnabled: boolean;
  refBufferEnabled: boolean;
  refBufferRadius: number;
  showRefChart: boolean;
  markerSize: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  viewBounds: [number, number, number, number] | null; // [south, west, north, east]
  // Incremented each time the user explicitly applies bounds (sidebar Apply /
  // Dataset buttons). The map's flyTo effect watches this, not viewBounds
  // itself — otherwise moveend → SET_VIEW_BOUNDS → effect → setView forms a
  // loop whose setView re-centers on bounds.getCenter() (arithmetic midpoint
  // in lat), not the Mercator center, drifting the map toward the equator.
  viewBoundsApplySeq: number;
  showColorbar: boolean;
  showLosIndicator: boolean;
  graticuleMode: 'off' | 'plain' | 'zebra';
  // Uploaded vector AOI overlays. Multiple at once; rendered in order.
  vectorOverlays: VectorOverlay[];
  // Last-computed polygon stats, keyed by overlayId+featureIdx+dataset.
  // Stored as a list rather than a map so iteration is stable.
  polygonStats: PolygonStats[];
}

export type AppAction =
  | { type: 'SET_DATASETS'; payload: { [key: string]: RasterGroup } }
  | { type: 'ADD_TIME_SERIES_POINT'; payload: { position: [number, number]; name?: string } }
  | { type: 'REMOVE_TIME_SERIES_POINT'; payload: string }
  | { type: 'UPDATE_TIME_SERIES_POINT'; payload: { id: string; updates: Partial<TimeSeriesPoint> } }
  | { type: 'SET_POINT_DATA'; payload: { pointId: string; dataset: string; data: number[] } }
  | { type: 'SET_POINT_TREND_DATA'; payload: { pointId: string; dataset: string; trend: { slope: number; intercept: number; rSquared: number; mmPerYear: number } } }
  | { type: 'SET_REF_MARKER_POSITION'; payload: [number, number] }
  | { type: 'SET_CURRENT_DATASET'; payload: string }
  | { type: 'SET_TIME_INDEX'; payload: number }
  | { type: 'SET_REF_VALUES'; payload: { dataset: string; values: number[] } }
  | { type: 'SET_BASEMAP'; payload: string }
  | { type: 'SET_DATA_MODE'; payload: string }
  | { type: 'SET_COLORMAP'; payload: string }
  | { type: 'SET_VMIN'; payload: number }
  | { type: 'SET_VMAX'; payload: number }
  | { type: 'SET_OPACITY'; payload: number }
  | { type: 'TOGGLE_CHART' }
  | { type: 'SET_SELECTED_POINT'; payload: string | null }
  | { type: 'TOGGLE_TRENDS' }
  | { type: 'TOGGLE_RESIDUALS' }
  | { type: 'ADD_LAYER_MASK'; payload: LayerMask }
  | { type: 'REMOVE_LAYER_MASK'; payload: string }
  | { type: 'UPDATE_LAYER_MASK'; payload: { id: string; updates: Partial<LayerMask> } }
  | { type: 'SET_CUSTOM_MASK_PATH'; payload: string | null }
  | { type: 'TOGGLE_BUFFER' }
  | { type: 'SET_BUFFER_RADIUS'; payload: number }
  | { type: 'SET_BUFFER_SAMPLES'; payload: number }
  | { type: 'TOGGLE_REF_ENABLED' }
  | { type: 'TOGGLE_REF_BUFFER' }
  | { type: 'SET_REF_BUFFER_RADIUS'; payload: number }
  | { type: 'TOGGLE_REF_CHART' }
  | { type: 'SET_MARKER_SIZE'; payload: number }
  | { type: 'SET_DATE_RANGE_START'; payload: string | null }
  | { type: 'SET_DATE_RANGE_END'; payload: string | null }
  | { type: 'SET_VIEW_BOUNDS'; payload: [number, number, number, number] | null }
  | { type: 'APPLY_VIEW_BOUNDS'; payload: [number, number, number, number] }
  | { type: 'TOGGLE_COLORBAR' }
  | { type: 'TOGGLE_LOS_INDICATOR' }
  | { type: 'CYCLE_GRATICULE' }
  | { type: 'ADD_CHART_WINDOW'; payload: ChartWindow }
  | { type: 'REMOVE_CHART_WINDOW'; payload: string }
  | { type: 'SET_CHART_WINDOW_DS'; payload: { id: string; dsNames: string[] } }
  | { type: 'ADD_VECTOR_OVERLAY'; payload: VectorOverlay }
  | { type: 'REMOVE_VECTOR_OVERLAY'; payload: string }
  | { type: 'UPDATE_VECTOR_OVERLAY'; payload: { id: string; updates: Partial<VectorOverlay> } }
  | { type: 'SET_POLYGON_STATS'; payload: PolygonStats }
  | { type: 'CLEAR_POLYGON_STATS'; payload: { overlayId: string } };

// Backward compatibility
export type LegacyAppAction = { type: 'SET_TS_MARKER_POSITION'; payload: [number, number] };
