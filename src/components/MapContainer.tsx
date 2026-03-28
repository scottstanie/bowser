import { useEffect, useState, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { useAppContext } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { usePointsApi, PointData } from '../hooks/usePointsApi';
import { useGpsApi } from '../hooks/useGpsApi';
import { valueToColor } from '../colorscales';
import { parseUrlState } from '../hooks/useUrlState';

const BASEMAPS: Record<string, { url: string; maxZoom: number }> = {
  satellite: {
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    maxZoom: 21,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
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
  const { fetchPointTimeSeries: fetchRasterPixelTS } = useApi();
  const { fetchGpsStations, fetchGpsTimeseries } = useGpsApi();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckLayersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setDeckLayers = useCallback((layers: any[]) => {
    deckLayersRef.current = layers;
    deckOverlayRef.current?.setProps({ layers });
  }, []);
  const refMarkerRef = useRef<maplibregl.Marker | null>(null);
  const tsMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [pointData, setPointData] = useState<PointData | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [pointCount, setPointCount] = useState<number>(0);

  // Read point viz state from global state (controlled by PointControlsPanel)
  const colorBy = state.pointColorBy;
  const pointVmin = state.pointVmin;
  const pointVmax = state.pointVmax;
  const pointFilter = state.pointFilter;
  const pointBasemap = state.pointBasemap;
  const pointColormap = state.pointColormap;

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
      center: (() => {
        const url = parseUrlState();
        if (url.lon && url.lat) return [parseFloat(url.lon), parseFloat(url.lat)] as [number, number];
        return [0, 0] as [number, number];
      })(),
      zoom: (() => {
        const url = parseUrlState();
        return url.zoom ? parseFloat(url.zoom) : 12;
      })(),
      maxZoom: 22,
      // @ts-expect-error preserveDrawingBuffer is a valid WebGL option, not in MapLibre types
      preserveDrawingBuffer: true, // Needed for map canvas export to PNG
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // Sync viewport to URL (debounced to avoid writing during fitBounds)
    let urlSyncEnabled = false;
    setTimeout(() => { urlSyncEnabled = true; }, 2000);
    map.on('moveend', () => {
      if (!urlSyncEnabled) return;
      const center = map.getCenter();
      const z = map.getZoom();
      const params = new URLSearchParams(window.location.search);
      params.set('lat', center.lat.toFixed(4));
      params.set('lon', center.lng.toFixed(4));
      params.set('zoom', z.toFixed(1));
      window.history.replaceState(null, '', `?${params}`);
    });

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

  // Raster mode: click on map → add time series point → fetch pixel values
  const hasRasters = Object.keys(state.datasetInfo).length > 0;
  const hasPointLayer = state.activePointLayer != null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasRasters) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // In point layer mode, deck.gl handles clicks — skip raster click
      if (hasPointLayer) return;

      const { lng, lat } = e.lngLat;
      dispatch({
        type: 'ADD_TIME_SERIES_POINT',
        payload: { position: [lat, lng] },
      });
      if (!state.showChart) {
        dispatch({ type: 'TOGGLE_CHART' });
      }
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [hasRasters, hasPointLayer, state.showChart, dispatch]);

  // Raster mode: fetch pixel timeseries for points that don't have data yet
  useEffect(() => {
    if (!hasRasters || !state.currentDataset) return;

    for (const point of state.timeSeriesPoints) {
      if (!point.data?.[state.currentDataset]) {
        // Fetch pixel values for this point
        fetchRasterPixelTS(point.position[1], point.position[0], state.currentDataset)
          .then(values => {
            if (values) {
              dispatch({
                type: 'SET_POINT_DATA',
                payload: { pointId: point.id, dataset: state.currentDataset, data: values },
              });
            }
          });
      }
    }
  }, [state.timeSeriesPoints, state.currentDataset, hasRasters, fetchRasterPixelTS, dispatch]);

  // Raster mode: draggable reference marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasRasters) return;

    // Create or update reference marker
    if (!refMarkerRef.current) {
      const el = document.createElement('div');
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '50%';
      el.style.background = '#ff4444';
      el.style.border = '3px solid white';
      el.style.cursor = 'grab';
      el.title = 'Reference point (drag to move)';

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([state.refMarkerPosition[1], state.refMarkerPosition[0]])
        .addTo(map);

      marker.on('dragend', async () => {
        const lngLat = marker.getLngLat();
        dispatch({
          type: 'SET_REF_MARKER_POSITION',
          payload: [lngLat.lat, lngLat.lng],
        });

        // Fetch reference pixel values for all raster datasets
        for (const [dsName] of Object.entries(state.datasetInfo)) {
          const values = await fetchRasterPixelTS(lngLat.lng, lngLat.lat, dsName);
          if (values) {
            dispatch({
              type: 'SET_REF_VALUES',
              payload: { dataset: dsName, values },
            });
          }
        }
      });

      refMarkerRef.current = marker;

      // Initial ref value fetch for all datasets
      for (const [dsName] of Object.entries(state.datasetInfo)) {
        if (!state.refValues[dsName]) {
          fetchRasterPixelTS(
            state.refMarkerPosition[1], state.refMarkerPosition[0], dsName,
          ).then(values => {
            if (values) {
              dispatch({ type: 'SET_REF_VALUES', payload: { dataset: dsName, values } });
            }
          });
        }
      }
    } else {
      refMarkerRef.current.setLngLat([state.refMarkerPosition[1], state.refMarkerPosition[0]]);
    }

    return () => {
      // Don't remove on re-render, only on unmount
    };
  }, [hasRasters, state.refMarkerPosition, state.datasetInfo, state.refValues, dispatch, fetchRasterPixelTS]);

  // Raster mode: show markers for time series points
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old markers
    tsMarkersRef.current.forEach(m => m.remove());
    tsMarkersRef.current = [];

    // Add draggable markers for each time series point
    for (const point of state.timeSeriesPoints) {
      if (!point.visible) continue;
      const el = document.createElement('div');
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.background = point.color;
      el.style.border = '2px solid white';
      el.style.cursor = 'grab';

      const pointId = point.id;
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([point.position[1], point.position[0]])
        .addTo(map);

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        dispatch({
          type: 'UPDATE_TIME_SERIES_POINT',
          payload: {
            id: pointId,
            updates: { position: [lngLat.lat, lngLat.lng], data: {} },
          },
        });
      });

      tsMarkersRef.current.push(marker);
    }
  }, [state.timeSeriesPoints, dispatch]);

  // Switch basemap tiles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const basemap = BASEMAPS[pointBasemap];
    const source = map.getSource('basemap') as maplibregl.RasterTileSource | undefined;
    if (source) {
      source.setTiles([basemap.url]);
    }
  }, [pointBasemap]);

  // Fit map to data bounds from point layer or raster dataset
  // Skip if URL already specifies a viewport (shared link)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const url = parseUrlState();
    if (url.lat && url.lon && url.zoom) return; // URL has viewport, skip fitBounds

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
          filter: pointFilter || undefined,
          maxPoints: 200000,
        });
        setPointData(data);
        setPointCount(data.count);

        // Compute histogram for controls panel
        if (data.count > 0) {
          const vals = data.colorValues;
          const min = vals.reduce((a, b) => Math.min(a, b), Infinity);
          const max = vals.reduce((a, b) => Math.max(a, b), -Infinity);
          const nBins = 40;
          const binWidth = (max - min) / nBins || 1;
          const counts = new Array(nBins).fill(0);
          const edges = Array.from({ length: nBins + 1 }, (_, i) => min + i * binWidth);
          for (const v of vals) {
            const idx = Math.min(Math.floor((v - min) / binWidth), nBins - 1);
            counts[idx]++;
          }
          dispatch({ type: 'SET_POINT_HISTOGRAM', payload: { edges, counts } });
        }
      } catch (err) {
        console.error('Error loading points:', err);
      }
    };

    loadPoints();
  }, [state.activePointLayer, colorBy, pointFilter, fetchPoints]);

  // Track which point IDs are currently displayed in the chart
  const clickedPointIds = new Set(state.clickedPoints.map(p => p.pointId));

  // Handle point click → fetch timeseries
  // shiftKey=true adds to selection, ctrlKey=true sets reference point
  const onPointClick = useCallback(async (pointId: number, shiftKey: boolean, ctrlKey: boolean) => {
    if (!state.activePointLayer) return;
    setSelectedPointId(pointId);

    try {
      const ts = await fetchPointTimeseries(state.activePointLayer, pointId);

      if (ctrlKey) {
        // Ctrl+click → set as reference point
        dispatch({ type: 'SET_REFERENCE_POINT', payload: { pointId, timeseries: ts } });
        return;
      }

      // If not shift-clicking, clear previous selections first
      if (!shiftKey) {
        dispatch({ type: 'CLEAR_CLICKED_POINTS' });
      }

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
    if (!overlay) return;

    // If no point data or points layer hidden, remove point cloud but keep others
    if (!pointData || !state.pointLayerVisible) {
      const existing = deckLayersRef.current;
      const otherLayers = (existing as Array<{ id?: string }>).filter(l => l.id !== 'point-cloud');
      setDeckLayers(otherLayers);
      return;
    }

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
      opacity: state.pointOpacity,
      getFillColor: (_, { index }) => {
        const pid = pointData.point_id[index];
        if (pid === state.referencePointId) {
          return [0, 255, 128, 255]; // Green for reference point
        }
        if (clickedPointIds.has(pid)) {
          return [255, 255, 0, 255]; // Yellow for selected/clicked
        }
        const v = pointData.colorValues[index];
        return valueToColor(v, pointVmin, pointVmax, pointColormap);
      },
      getRadius: (_, { index }) => {
        const pid = pointData.point_id[index];
        if (pid === state.referencePointId) return 7;
        if (clickedPointIds.has(pid)) return 5;
        return 3;
      },
      radiusMinPixels: 2,
      radiusMaxPixels: 14,
      pickable: true,
      onClick: (info, event) => {
        if (info.index >= 0) {
          const srcEvent = (event as unknown as { srcEvent?: MouseEvent }).srcEvent;
          const shiftKey = srcEvent?.shiftKey ?? false;
          const ctrlKey = srcEvent?.ctrlKey ?? srcEvent?.metaKey ?? false;
          onPointClick(pointData.point_id[info.index], shiftKey, ctrlKey);
        }
      },
      updateTriggers: {
        getFillColor: [pointVmin, pointVmax, pointColormap, state.referencePointId, ...clickedPointIds],
        getRadius: [state.referencePointId, ...clickedPointIds],
      },
    });

    // Preserve GPS layer when updating point cloud layer
    const existing = deckLayersRef.current;
    const otherLayers = (existing as Array<{ id?: string }>).filter(l => l.id !== 'point-cloud');
    setDeckLayers([layer, ...otherLayers]);
  }, [pointData, pointVmin, pointVmax, pointColormap, selectedPointId, onPointClick,
      state.pointLayerVisible, state.pointOpacity]);

  // GPS: fetch stations on moveend when GPS is visible (debounced)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !state.gpsVisible) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    const fetchStations = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const bounds = map.getBounds();
        dispatch({ type: 'SET_GPS_LOADING', payload: true });
        const stations = await fetchGpsStations([
          bounds.getWest(), bounds.getSouth(),
          bounds.getEast(), bounds.getNorth(),
        ]);
        dispatch({ type: 'SET_GPS_STATIONS', payload: stations });
      }, 500);
    };

    // Fetch immediately + on subsequent moves
    fetchStations();
    map.on('moveend', fetchStations);
    return () => {
      clearTimeout(debounceTimer);
      map.off('moveend', fetchStations);
    };
  }, [state.gpsVisible, fetchGpsStations, dispatch]);

  // GPS: click handler for stations
  const onGpsStationClick = useCallback(async (stationId: string) => {
    dispatch({ type: 'SET_GPS_SELECTED_STATION', payload: stationId });
    const data = await fetchGpsTimeseries(stationId);
    if (data) {
      dispatch({ type: 'SET_GPS_TIMESERIES', payload: data.timeseries });
    }
  }, [fetchGpsTimeseries, dispatch]);

  // GPS: render station markers as a separate deck.gl layer
  useEffect(() => {
    const overlay = deckOverlayRef.current;
    if (!overlay) return;

    // Get existing layers (point cloud)
    const existingLayers = deckLayersRef.current;
    const nonGpsLayers = (existingLayers as Array<{ id?: string }>).filter(l => l.id !== 'gps-stations');

    if (!state.gpsVisible || state.gpsStations.length === 0) {
      setDeckLayers(nonGpsLayers);
      return;
    }

    const gpsLayer = new ScatterplotLayer({
      id: 'gps-stations',
      data: state.gpsStations,
      getPosition: (d) => [d.lon, d.lat],
      getFillColor: (d) =>
        d.id === state.gpsSelectedStationId
          ? [255, 255, 0, 255]   // Selected: yellow
          : [34, 170, 102, 230], // Default: green
      getRadius: 8,
      radiusMinPixels: 6,
      radiusMaxPixels: 16,
      stroked: true,
      getLineColor: [255, 255, 255, 200],
      getLineWidth: 2,
      lineWidthMinPixels: 2,
      pickable: true,
      onClick: (info) => {
        if (info.object) {
          onGpsStationClick(info.object.id);
        }
      },
      updateTriggers: {
        getFillColor: [state.gpsSelectedStationId],
      },
    });

    setDeckLayers([...nonGpsLayers, gpsLayer]);
  }, [state.gpsVisible, state.gpsStations, state.gpsSelectedStationId, onGpsStationClick]);

  // Raster tile layer visibility toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = map.getLayer('raster-layer');
    if (layer) {
      map.setLayoutProperty('raster-layer', 'visibility',
        state.rasterLayerVisible ? 'visible' : 'none');
    }
  }, [state.rasterLayerVisible]);

  // Raster tile layer for V1 datasets
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !state.currentDataset || !state.datasetInfo[state.currentDataset]) return;

    // Ensure map style is loaded before adding sources
    const addRasterLayer = () => {

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
    const tileUrl = `/${endpoint}/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${urlParams}`;

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
    };

    if (map.isStyleLoaded()) {
      addRasterLayer();
    } else {
      map.once('load', addRasterLayer);
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
          {state.clickedPoints.length > 0 && ` | ${state.clickedPoints.length} selected`}
          {state.referencePointId != null && ` | ref: ${state.referencePointId}`}
          {state.clickedPoints.length === 0 && ' | click: TS, shift: compare, ctrl: ref'}
        </div>
      )}
    </div>
  );
}
