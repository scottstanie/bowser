import { useEffect, useState, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { useAppContext } from '../context/AppContext';
import { usePointsApi, PointData } from '../hooks/usePointsApi';

// Color scale: map a value in [vmin, vmax] to RdBu_r-like RGB
function valueToRdBuR(value: number, vmin: number, vmax: number): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, (value - vmin) / (vmax - vmin || 1)));
  // RdBu_r: blue (low/negative) → white (zero) → red (high/positive)
  // Reversed so negative = red, positive = blue (subsidence convention)
  const r = t < 0.5 ? Math.round(33 + (255 - 33) * (t * 2)) : Math.round(255 - (255 - 33) * ((t - 0.5) * 2));
  const g = t < 0.5 ? Math.round(102 + (255 - 102) * (t * 2)) : Math.round(255 - (255 - 102) * ((t - 0.5) * 2));
  const b = t < 0.5 ? Math.round(172 + (255 - 172) * (t * 2)) : Math.round(255 - (255 - 172) * ((t - 0.5) * 2));
  return [r, g, b, 220];
}

const BASEMAPS: Record<string, { url: string; maxZoom: number }> = {
  satellite: {
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    maxZoom: 21,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{y}/{x}.png',
    maxZoom: 19,
  },
  dark: {
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    maxZoom: 20,
  },
};

export default function MapContainer() {
  const { state, dispatch } = useAppContext();
  const { fetchPoints, fetchPointTimeseries } = usePointsApi();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);

  const [pointData, setPointData] = useState<PointData | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [pointCount, setPointCount] = useState<number>(0);

  // Read point viz state from global state (controlled by PointControlsPanel)
  const colorBy = state.pointColorBy;
  const pointVmin = state.pointVmin;
  const pointVmax = state.pointVmax;

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'basemap': {
            type: 'raster',
            tiles: [BASEMAPS.satellite.url],
            tileSize: 256,
            maxzoom: BASEMAPS.satellite.maxZoom,
          }
        },
        layers: [{
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
        }],
      },
      center: [-99.077, 19.315], // Default; will be overridden by data bounds
      zoom: 12,
      maxZoom: 22,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Add deck.gl overlay
    const deckOverlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
    });
    map.addControl(deckOverlay as unknown as maplibregl.IControl);
    deckOverlayRef.current = deckOverlay;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      deckOverlayRef.current = null;
    };
  }, []);

  // Fit map to data bounds from point layer or raster dataset
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Try point layers first (from manifest loaded via state)
    if (state.pointLayerBounds) {
      const [west, south, east, north] = state.pointLayerBounds;
      map.fitBounds([[west, south], [east, north]], { padding: 50 });
      return;
    }

    // Fallback to raster dataset bounds
    if (state.currentDataset && state.datasetInfo[state.currentDataset]) {
      const bounds = state.datasetInfo[state.currentDataset].latlon_bounds;
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 50 });
    }
  }, [state.pointLayerBounds, state.currentDataset, state.datasetInfo]);

  // Load points when point layer is available
  useEffect(() => {
    if (!state.activePointLayer) return;

    const loadPoints = async () => {
      try {
        const data = await fetchPoints(state.activePointLayer!, {
          colorBy,
          maxPoints: 200000,
        });
        setPointData(data);
        setPointCount(data.count);
      } catch (err) {
        console.error('Error loading points:', err);
      }
    };

    loadPoints();
  }, [state.activePointLayer, colorBy, fetchPoints]);

  // Handle point click → fetch timeseries
  const onPointClick = useCallback(async (pointId: number) => {
    if (!state.activePointLayer) return;
    setSelectedPointId(pointId);

    try {
      const ts = await fetchPointTimeseries(state.activePointLayer, pointId);
      dispatch({
        type: 'SET_CLICKED_POINT_TIMESERIES',
        payload: { pointId, timeseries: ts },
      });
    } catch (err) {
      console.error('Error fetching timeseries:', err);
    }
  }, [state.activePointLayer, fetchPointTimeseries, dispatch]);

  // Update deck.gl layers whenever point data changes
  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay || !pointData) return;

    const positions = new Float64Array(pointData.count * 2);
    for (let i = 0; i < pointData.count; i++) {
      positions[i * 2] = pointData.lon[i];
      positions[i * 2 + 1] = pointData.lat[i];
    }

    const layer = new ScatterplotLayer({
      id: 'point-cloud',
      data: {
        length: pointData.count,
        attributes: {
          getPosition: { value: positions, size: 2 },
        },
      },
      getPosition: (_, { index }) => [pointData.lon[index], pointData.lat[index]],
      getFillColor: (_, { index }) => {
        const v = pointData.colorValues[index];
        if (selectedPointId !== null && pointData.point_id[index] === selectedPointId) {
          return [255, 255, 0, 255]; // Highlight selected
        }
        return valueToRdBuR(v, pointVmin, pointVmax);
      },
      getRadius: 3,
      radiusMinPixels: 2,
      radiusMaxPixels: 10,
      pickable: true,
      onClick: (info) => {
        if (info.index >= 0) {
          onPointClick(pointData.point_id[info.index]);
        }
      },
      updateTriggers: {
        getFillColor: [pointVmin, pointVmax, selectedPointId],
      },
    });

    overlay.setProps({ layers: [layer] });
  }, [pointData, pointVmin, pointVmax, selectedPointId, onPointClick]);

  // Raster tile layer for V1 datasets
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !state.currentDataset || !state.datasetInfo[state.currentDataset]) return;

    const currentDatasetInfo = state.datasetInfo[state.currentDataset];
    const maxIdx = currentDatasetInfo.x_values.length - 1;
    const timeIdx = Math.max(0, Math.min(state.currentTimeIndex, maxIdx));

    const params: Record<string, string> = {
      variable: state.currentDataset,
      time_idx: timeIdx.toString(),
      rescale: `${state.vmin},${state.vmax}`,
      colormap_name: state.colormap,
    };

    if (currentDatasetInfo.algorithm) {
      params.algorithm = currentDatasetInfo.algorithm;
    }

    if (state.refValues[state.currentDataset] && currentDatasetInfo.algorithm === 'shift') {
      const shift = state.refValues[state.currentDataset][timeIdx];
      if (shift !== undefined) {
        params.algorithm_params = JSON.stringify({ shift });
      }
    }

    if (state.dataMode === 'cog') {
      params.url = currentDatasetInfo.file_list[timeIdx];
      const maskUrl = currentDatasetInfo.mask_file_list[timeIdx];
      if (maskUrl) params.mask = encodeURIComponent(maskUrl);
      if (currentDatasetInfo.mask_min_value !== undefined) {
        params.mask_min_value = currentDatasetInfo.mask_min_value.toString();
      }
    }

    const urlParams = new URLSearchParams(params).toString();
    const endpoint = state.dataMode === 'md' ? 'md' : 'cog';
    const tileUrl = `/${endpoint}/WebMercatorQuad/tiles/{z}/{x}/{y}.png?${urlParams}`;

    // Add or update raster source
    if (map.getSource('raster-tiles')) {
      (map.getSource('raster-tiles') as maplibregl.RasterTileSource).setTiles([tileUrl]);
    } else {
      map.addSource('raster-tiles', {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
      });
      map.addLayer({
        id: 'raster-layer',
        type: 'raster',
        source: 'raster-tiles',
        paint: { 'raster-opacity': state.opacity },
      }, map.getLayer('basemap') ? undefined : undefined);
    }

    // Update opacity
    if (map.getLayer('raster-layer')) {
      map.setPaintProperty('raster-layer', 'raster-opacity', state.opacity);
    }
  }, [state.currentDataset, state.currentTimeIndex, state.datasetInfo, state.dataMode,
      state.refValues, state.colormap, state.vmin, state.vmax, state.opacity]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Stats overlay */}
      {pointCount > 0 && (
        <div style={{
          position: 'absolute', bottom: 30, left: 10,
          background: 'rgba(0,0,0,0.7)', color: '#fff',
          padding: '6px 10px', borderRadius: 4, fontSize: 12,
          zIndex: 10, fontFamily: 'monospace',
        }}>
          {pointCount.toLocaleString()} points | color: {colorBy}
          | [{pointVmin.toFixed(1)}, {pointVmax.toFixed(1)}]
        </div>
      )}
    </div>
  );
}
