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
}

export interface BaseMapItem {
  url: string;
  attribution: string;
}

export interface AppState {
  datasetInfo: { [key: string]: RasterGroup };
  tsMarkerPosition: [number, number];
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
}

export type AppAction =
  | { type: 'SET_DATASETS'; payload: { [key: string]: RasterGroup } }
  | { type: 'SET_TS_MARKER_POSITION'; payload: [number, number] }
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
  | { type: 'TOGGLE_CHART' };
