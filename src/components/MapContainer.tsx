import { useEffect, useState } from 'react';
import { MapContainer as LeafletMapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi } from '../hooks/useApi';
import { useAppContext } from '../context/AppContext';
import { baseMaps } from '../basemap';
import { MousePositionControl } from '../mouse';
import MeasureTool from './MeasureTool';
import ProfileTool from './ProfileTool';
import RefPointChart from './RefPointChart';

// Fix for default markers in React Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const fontAwesomeIcon = L.divIcon({
  html: '<i class="fa-solid fa-location-dot fa-3x" style="color:#111; text-shadow: 0 0 4px white, 0 0 4px white;"></i>',
  iconSize: [20, 20],
  className: 'myDivIcon'
});

function MapEvents() {
  const { state, dispatch } = useAppContext();

  useMapEvents({
    click: (e) => {
      if (!state.pickingEnabled) return;
      dispatch({
        type: 'ADD_TIME_SERIES_POINT',
        payload: {
          position: [e.latlng.lat, e.latlng.lng],
          name: `Point ${Date.now().toString().slice(-4)}`
        }
      });
    },
  });

  return null;
}

function MousePosition() {
  const map = useMap();

  useEffect(() => {
    const mousePositionControl = new MousePositionControl();
    mousePositionControl.addTo(map);

    return () => {
      mousePositionControl.remove();
    };
  }, [map]);

  return null;
}

function ScaleBar() {
  const map = useMap();

  useEffect(() => {
    const scale = L.control.scale({ position: 'bottomleft', imperial: true, metric: true, maxWidth: 150 });
    scale.addTo(map);
    return () => { scale.remove(); };
  }, [map]);

  return null;
}

function RasterTileLayer() {
  const { state } = useAppContext();
  const [tileUrl, setTileUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!state.currentDataset || !state.datasetInfo[state.currentDataset] || !state.dataMode) {
      return;
    }
    // dataMode starts as 'md' default; wait until datasets are loaded (which confirms mode is set)
    if (state.dataMode !== 'md' && state.dataMode !== 'cog') {
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    const updateTileLayer = async () => {
      const currentDatasetInfo = state.datasetInfo[state.currentDataset];

      // Use ONLY state — DO NOT read localStorage here
      const colormap = state.colormap;
      const vmin = state.vmin;
      const vmax = state.vmax;

      // Ensure time index is within bounds
      const maxIdx = currentDatasetInfo.x_values.length - 1;
      const timeIdx = Math.max(0, Math.min(state.currentTimeIndex, maxIdx));

      // Build parameters
      const params: Record<string, string> = {
        variable: state.currentDataset,
        time_idx: timeIdx.toString(),
        rescale: `${vmin},${vmax}`,
        colormap_name: colormap,
      };

      // Add algorithm if needed
      if (currentDatasetInfo.algorithm) {
        params.algorithm = currentDatasetInfo.algorithm;
      }

      // Add shift for reference point if available and re-referencing is enabled
      if (state.refEnabled && state.refValues[state.currentDataset] && currentDatasetInfo.algorithm === 'shift') {
        const refArr = state.refValues[state.currentDataset];
        // For 2D variables (no time dim) the ref array has only one element; fall back to index 0
        const shift = refArr[timeIdx] ?? refArr[0];
        if (shift !== undefined) {
          params.algorithm_params = JSON.stringify({ shift });
        }
      }

      // Add URL parameter for COG mode
      if (state.dataMode === 'cog') {
        const url = currentDatasetInfo.file_list[timeIdx];
        const maskUrl = currentDatasetInfo.mask_file_list[timeIdx];
        const maskMinValue = currentDatasetInfo.mask_min_value;

        params.url = url;
        if (maskUrl) params.mask = maskUrl;
        if (maskMinValue !== undefined) params.mask_min_value = maskMinValue.toString();
        if (state.customMaskPath) params.custom_mask = state.customMaskPath;
        params.time_idx = timeIdx.toString();
      }

      // Layer masks (both modes)
      if (state.layerMasks.length > 0) {
        params.layer_masks = JSON.stringify(
          state.layerMasks.map(m => ({ dataset: m.dataset, threshold: m.threshold, mode: m.mode }))
        );
      }

      // MD mode: custom mask path
      if (state.dataMode === 'md') {
        if (state.customMaskPath) params.custom_mask_path = state.customMaskPath;
      }

      const urlParams = new URLSearchParams(params).toString();
      const endpoint = state.dataMode === 'md'
        ? `/md/WebMercatorQuad/tilejson.json?${urlParams}`
        : `/cog/WebMercatorQuad/tilejson.json?${urlParams}`;

      try {
        const response = await fetch(endpoint, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const tileInfo = await response.json();
        // Only set if not aborted
        if (!signal.aborted) setTileUrl(tileInfo.tiles[0]);
      } catch (err) {
        if ((err as any).name !== 'AbortError') {
          console.error('Error fetching tile info:', err);
        }
      }
    };

    // Debounce: collapse rapid state changes (histogram → rescale → ref point)
    // into a single request to avoid transient 500s from concurrent opens.
    const debounceTimer = setTimeout(() => updateTileLayer(), 80);
    return () => { clearTimeout(debounceTimer); controller.abort(); };
  }, [
    state.currentDataset,
    state.currentTimeIndex,
    state.datasetInfo,
    state.dataMode,
    state.refValues,
    state.refMarkerPosition,
    state.refEnabled,
    state.colormap,
    state.vmin,
    state.vmax,
    state.layerMasks,
    state.customMaskPath,
  ]);

  if (!tileUrl) return null;

  return (
    <TileLayer
      key={tileUrl}  // force refresh if URL changes
      url={tileUrl}
      opacity={state.opacity}
      maxZoom={19}
    />
  );
}

/** Draw radius circles on the map for buffer-enabled points and reference marker. */
function RadiusCircles() {
  const { state } = useAppContext();
  const map = useMap();

  useEffect(() => {
    const circles: L.Circle[] = [];

    // Time-series point buffer circles
    if (state.bufferEnabled && state.bufferRadius > 0) {
      state.timeSeriesPoints.filter(p => p.visible).forEach(point => {
        circles.push(L.circle([point.position[0], point.position[1]], {
          radius: state.bufferRadius,
          color: point.color,
          fillColor: point.color,
          fillOpacity: 0.08,
          weight: 1.5,
          dashArray: '4 3',
        }).addTo(map));
      });
    }

    // Reference marker buffer circle
    if (state.refEnabled && state.refBufferEnabled && state.refBufferRadius > 0) {
      const [lat, lng] = state.refMarkerPosition;
      circles.push(L.circle([lat, lng], {
        radius: state.refBufferRadius,
        color: '#e05d6a',
        fillColor: '#e05d6a',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '4 3',
      }).addTo(map));
    }

    return () => { circles.forEach(c => c.remove()); };
  }, [
    map,
    state.bufferEnabled,
    state.bufferRadius,
    state.refEnabled,
    state.refBufferEnabled,
    state.refBufferRadius,
    state.refMarkerPosition,
    JSON.stringify(state.timeSeriesPoints.map(p => ({ id: p.id, pos: p.position, vis: p.visible }))),
  ]);

  return null;
}

function MarkerEventHandlers() {
  const { state, dispatch } = useAppContext();
  const { fetchPointTimeSeries, fetchBufferTimeSeries } = useApi();
  const map = useMap();

  const handleMarkerClick = (position: [number, number], pointName?: string) => {
    const [lat, lng] = position;
    const content = pointName
      ? `${pointName} (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`
      : `Reference (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`;
    L.popup()
      .setLatLng([lat, lng])
      .setContent(content)
      .openOn(map);
  };

  const handleTsMarkerDragEnd = (pointId: string) => (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    dispatch({
      type: 'UPDATE_TIME_SERIES_POINT',
      payload: {
        id: pointId,
        updates: { position: [position.lat, position.lng] }
      }
    });
  };

  const handleRefMarkerDragEnd = async (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    const lat = position.lat;
    const lng = position.lng;
    // 1) update position in state
    dispatch({ type: 'SET_REF_MARKER_POSITION', payload: [lat, lng] });

    // 2) if current dataset uses the "shift" algo, recompute ref values
    const ds = state.currentDataset;
    const info = ds ? state.datasetInfo[ds] : null;
    if (ds && info?.algorithm === 'shift') {
      try {
        let values: number[] | undefined;
        if (state.refBufferEnabled && state.refBufferRadius > 0) {
          const result = await fetchBufferTimeSeries(lng, lat, ds, state.refBufferRadius, 0);
          if (result?.median) {
            const xValues = state.datasetInfo[ds]?.x_values?.map(String) ?? result.labels?.map(String) ?? [];
            const byX = Object.fromEntries(result.median.map((pt: { x: string; y: number }) => [String(pt.x), pt.y]));
            values = xValues.map((x: string) => byX[x] ?? NaN);
          }
        }
        if (!values) {
          values = await fetchPointTimeSeries(lng, lat, ds);
        }
        if (values) {
          dispatch({ type: 'SET_REF_VALUES', payload: { dataset: ds, values } });
        }
      } catch (err) {
        console.error('Error updating reference values after drag:', err);
      }
    }
  };

  const handleTsMarkerDoubleClick = (pointId: string) => () => {
    // Double-click to remove point
    dispatch({ type: 'REMOVE_TIME_SERIES_POINT', payload: pointId });
  };

  // Create custom colored icons for each point
  const createColoredIcon = (color: string, isSelected: boolean = false) => {
    const iconSize = isSelected ? 25 : 20;
    return L.divIcon({
      html: `<div style="
        width: ${iconSize}px;
        height: ${iconSize}px;
        background-color: ${color};
        border: ${isSelected ? '3px solid white' : '2px solid white'};
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      "></div>`,
      iconSize: [iconSize, iconSize],
      className: 'custom-colored-marker'
    });
  };

  return (
    <>
      {/* Time Series Points */}
      {state.timeSeriesPoints.filter(p => p.visible).map((point) => (
        <Marker
          key={point.id}
          position={point.position}
          icon={createColoredIcon(point.color, state.selectedPointId === point.id)}
          draggable
          title={`${point.name} - Double-click to remove`}
          eventHandlers={{
            click: () => {
              handleMarkerClick(point.position, point.name);
              dispatch({ type: 'SET_SELECTED_POINT', payload: point.id });
            },
            dragend: handleTsMarkerDragEnd(point.id),
            dblclick: handleTsMarkerDoubleClick(point.id),
          }}
        />
      ))}

      {/* Reference Marker */}
      <Marker
        position={state.refMarkerPosition}
        icon={fontAwesomeIcon}
        draggable
        title="Reference Location"
        eventHandlers={{
          click: () => handleMarkerClick(state.refMarkerPosition),
          dragend: handleRefMarkerDragEnd,
        }}
      />
    </>
  );
}

export default function MapContainer() {
  const { state } = useAppContext();

  // Calculate initial center from first dataset bounds
  const getInitialCenter = (): [number, number] => {
    if (state.currentDataset && state.datasetInfo[state.currentDataset]) {
      const bounds = state.datasetInfo[state.currentDataset].latlon_bounds;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const centerLng = (bounds[0] + bounds[2]) / 2;
      return [centerLat, centerLng];
    }

    // If no current dataset, try to get bounds from any available dataset
    const datasets = Object.values(state.datasetInfo);
    if (datasets.length > 0) {
      const bounds = datasets[0].latlon_bounds;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const centerLng = (bounds[0] + bounds[2]) / 2;
      return [centerLat, centerLng];
    }

    return [0, 0];
  };

  const selectedBasemap = baseMaps[state.selectedBasemap] || baseMaps.esriSatellite;

  const center = getInitialCenter();
  const hasDatasets = Object.keys(state.datasetInfo).length > 0;
  const [measureActive, setMeasureActive] = useState(false);
  const [profileActive, setProfileActive] = useState(false);

  return (
    <div className="map-container">
      <div className="map-toolbar">
        <button
          className={`map-tool-btn${measureActive ? ' active' : ''}`}
          title="Measure distance (click points, double-click to finish)"
          onClick={() => { setMeasureActive(v => !v); setProfileActive(false); }}
        >
          <i className="fa-solid fa-ruler"></i>
        </button>
        <button
          className={`map-tool-btn${profileActive ? ' active' : ''}`}
          title="Draw profile line (click start, click end, double-click to extract)"
          onClick={() => { setProfileActive(v => !v); setMeasureActive(false); }}
        >
          <i className="fa-solid fa-chart-area"></i>
        </button>
      </div>
    <LeafletMapContainer
      key={hasDatasets ? 'with-data' : 'no-data'} // Force re-render when data loads
      center={center}
      zoom={9}
      style={{ height: '100%', width: '100%' }}
      doubleClickZoom={false}
    >
      <TileLayer
        url={selectedBasemap.url}
        attribution={selectedBasemap.attribution}
        maxZoom={19}
      />
      <RasterTileLayer />
      <RadiusCircles />
      <MarkerEventHandlers />
      <MapEvents />
      <MousePosition />
      <ScaleBar />
      <MeasureTool active={measureActive} onDeactivate={() => setMeasureActive(false)} />
      <ProfileTool active={profileActive} onDeactivate={() => setProfileActive(false)} />
      <RefPointChart />
    </LeafletMapContainer>
    </div>
  );
}
