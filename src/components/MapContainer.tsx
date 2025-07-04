import { useEffect, useState, useRef, useCallback } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppContext } from '../context/AppContext';
import { baseMaps } from '../basemap';
import { MousePositionControl } from '../mouse';

// Custom marker components for Mapbox GL JS
function CustomMarker({
  children,
  longitude,
  latitude,
  draggable = false,
  onDrag,
  onDragEnd,
  onClick,
  onDoubleClick,
  ...props
}: any) {
  return (
    <Marker
      longitude={longitude}
      latitude={latitude}
      draggable={draggable}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      {...props}
    >
      <div
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        style={{ cursor: draggable ? 'move' : 'pointer' }}
      >
        {children}
      </div>
    </Marker>
  );
}

function RasterTileLayer() {
  const { state } = useAppContext();
  const [tileUrl, setTileUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!state.currentDataset || !state.datasetInfo[state.currentDataset]) {
      return;
    }

    const updateTileLayer = async () => {
      const currentDatasetInfo = state.datasetInfo[state.currentDataset];

      // Load preferences for current dataset
      const colormap = localStorage.getItem(`${state.currentDataset}-colormap_name`) || state.colormap;
      const vmin = localStorage.getItem(`${state.currentDataset}-vmin`)
        ? parseFloat(localStorage.getItem(`${state.currentDataset}-vmin`)!)
        : state.vmin;
      const vmax = localStorage.getItem(`${state.currentDataset}-vmax`)
        ? parseFloat(localStorage.getItem(`${state.currentDataset}-vmax`)!)
        : state.vmax;

      // Ensure time index is within bounds
      const maxIdx = currentDatasetInfo.x_values.length - 1;
      const timeIdx = Math.max(0, Math.min(state.currentTimeIndex, maxIdx));

      // Build parameters
      let params: Record<string, string> = {
        variable: state.currentDataset,
        time_idx: timeIdx.toString(),
        rescale: `${vmin},${vmax}`,
        colormap_name: colormap,
      };

      // Add algorithm if needed
      if (currentDatasetInfo.algorithm) {
        params.algorithm = currentDatasetInfo.algorithm;
      }

      // Add shift for reference point if available
      if (state.refValues[state.currentDataset] && currentDatasetInfo.algorithm === 'shift') {
        const shift = state.refValues[state.currentDataset][timeIdx];
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
        if (maskUrl) params.mask = encodeURIComponent(maskUrl);
        if (maskMinValue !== undefined) params.mask_min_value = maskMinValue.toString();
      }

      const urlParams = new URLSearchParams(params).toString();
      const endpoint = state.dataMode === 'md'
        ? `/md/WebMercatorQuad/tilejson.json?${urlParams}`
        : `/cog/WebMercatorQuad/tilejson.json?${urlParams}`;

      try {
        const response = await fetch(endpoint);
        if (!response.ok) {
          console.warn('Failed to fetch tile info:', response.status, response.statusText);
          return;
        }
        const contentType = response.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          console.warn('Expected JSON response for tile info, got:', contentType);
          return;
        }
        const tileInfo = await response.json();
        if (tileInfo.tiles && tileInfo.tiles[0]) {
          setTileUrl(tileInfo.tiles[0]);
        }
      } catch (error) {
        console.error('Error fetching tile info:', error);
      }
    };

    updateTileLayer();
  }, [
    state.currentDataset,
    state.currentTimeIndex,
    state.datasetInfo,
    state.dataMode,
    state.refValues,
    state.colormap,
    state.vmin,
    state.vmax
  ]);

  if (!tileUrl) return null;

  return (
    <Source
      id="raster-tiles"
      type="raster"
      tiles={[tileUrl]}
      tileSize={256}
    >
      <Layer
        id="raster-layer"
        type="raster"
        paint={{
          'raster-opacity': state.opacity
        }}
      />
    </Source>
  );
}

function MarkerEventHandlers() {
  const { state, dispatch } = useAppContext();
  const [popup, setPopup] = useState<{ longitude: number; latitude: number; content: string } | null>(null);

  const handleMarkerClick = (position: [number, number], pointName?: string) => {
    const [lat, lng] = position;
    const content = pointName
      ? `${pointName} (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`
      : `Reference (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`;
    setPopup({ longitude: lng, latitude: lat, content });
  };

  const handleTsMarkerDragEnd = (pointId: string) => (event: any) => {
    const { lngLat } = event;
    dispatch({
      type: 'UPDATE_TIME_SERIES_POINT',
      payload: {
        id: pointId,
        updates: { position: [lngLat.lat, lngLat.lng] }
      }
    });
  };

  const handleRefMarkerDragEnd = (event: any) => {
    const { lngLat } = event;
    dispatch({ type: 'SET_REF_MARKER_POSITION', payload: [lngLat.lat, lngLat.lng] });
  };

  const handleTsMarkerDoubleClick = (pointId: string) => () => {
    // Double-click to remove point
    dispatch({ type: 'REMOVE_TIME_SERIES_POINT', payload: pointId });
  };

  // Create custom colored markers for each point
  const createColoredMarker = (color: string, isSelected: boolean = false) => {
    const iconSize = isSelected ? 25 : 20;
    return (
      <div style={{
        width: `${iconSize}px`,
        height: `${iconSize}px`,
        backgroundColor: color,
        border: `${isSelected ? '3px solid white' : '2px solid white'}`,
        borderRadius: '50%',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
      }} />
    );
  };

  return (
    <>
      {/* Time Series Points */}
      {state.timeSeriesPoints.filter(p => p.visible).map((point) => (
        <CustomMarker
          key={point.id}
          longitude={point.position[1]}
          latitude={point.position[0]}
          draggable
          onDragEnd={handleTsMarkerDragEnd(point.id)}
          onClick={() => {
            handleMarkerClick(point.position, point.name);
            dispatch({ type: 'SET_SELECTED_POINT', payload: point.id });
          }}
          onDoubleClick={handleTsMarkerDoubleClick(point.id)}
        >
          {createColoredMarker(point.color, state.selectedPointId === point.id)}
        </CustomMarker>
      ))}

      {/* Reference Marker */}
      <CustomMarker
        longitude={state.refMarkerPosition[1]}
        latitude={state.refMarkerPosition[0]}
        draggable
        onDragEnd={handleRefMarkerDragEnd}
        onClick={() => handleMarkerClick(state.refMarkerPosition)}
      >
        <i className="fa-solid fa-location-dot fa-2x" style={{ color: '#333' }} />
      </CustomMarker>

      {/* Popup */}
      {popup && (
        <div
          style={{
            position: 'absolute',
            background: 'white',
            padding: '8px',
            borderRadius: '4px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            fontSize: '12px',
            zIndex: 1000,
            pointerEvents: 'none',
            whiteSpace: 'pre-line',
          }}
          onClick={() => setPopup(null)}
        >
          {popup.content}
        </div>
      )}
    </>
  );
}

export default function MapContainer() {
  const { state, dispatch } = useAppContext();
  const mapRef = useRef<any>(null);

  // Calculate initial center from first dataset bounds
  const getInitialCenter = (): [number, number] => {
    if (state.currentDataset && state.datasetInfo[state.currentDataset]) {
      const bounds = state.datasetInfo[state.currentDataset].latlon_bounds;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const centerLng = (bounds[0] + bounds[2]) / 2;
      return [centerLng, centerLat]; // Note: Mapbox uses [lng, lat] order
    }

    // If no current dataset, try to get bounds from any available dataset
    const datasets = Object.values(state.datasetInfo);
    if (datasets.length > 0) {
      const bounds = datasets[0].latlon_bounds;
      const centerLat = (bounds[1] + bounds[3]) / 2;
      const centerLng = (bounds[0] + bounds[2]) / 2;
      return [centerLng, centerLat]; // Note: Mapbox uses [lng, lat] order
    }

    return [0, 0];
  };

  const selectedBasemap = baseMaps[state.selectedBasemap] || baseMaps.esriSatellite;
  const center = getInitialCenter();
  const hasDatasets = Object.keys(state.datasetInfo).length > 0;

  // Map click handler to add new time series points
  const handleMapClick = useCallback((event: any) => {
    const { lngLat } = event;
    dispatch({
      type: 'ADD_TIME_SERIES_POINT',
      payload: {
        position: [lngLat.lat, lngLat.lng],
        name: `Point ${Date.now().toString().slice(-4)}` // Short unique name
      }
    });
  }, [dispatch]);

  // Add mouse position control when map loads
  const handleMapLoad = useCallback((event: any) => {
    const map = event.target;
    mapRef.current = map;

    const mousePositionControl = new MousePositionControl();
    map.addControl(mousePositionControl, 'bottom-left');
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Map
        key={hasDatasets ? 'with-data' : 'no-data'} // Force re-render when data loads
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom: 9
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={{
          version: 8,
          sources: {
            'basemap': {
              type: 'raster',
              tiles: [selectedBasemap.url],
              tileSize: 256,
              attribution: selectedBasemap.attribution
            }
          },
          layers: [{
            id: 'basemap',
            type: 'raster',
            source: 'basemap'
          }]
        }}
        doubleClickZoom={false}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
      >
        <RasterTileLayer />
        <MarkerEventHandlers />
      </Map>
    </div>
  );
}
