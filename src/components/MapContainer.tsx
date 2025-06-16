import { useEffect, useState } from 'react';
import { MapContainer as LeafletMapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppContext } from '../context/AppContext';
import { baseMaps } from '../basemap';
import { MousePositionControl } from '../mouse';

// Fix for default markers in React Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const fontAwesomeIcon = L.divIcon({
  html: '<i class="fa-solid fa-location-dot fa-3x"></i>',
  iconSize: [20, 20],
  className: 'myDivIcon'
});

function MapEvents() {
  const { dispatch } = useAppContext();

  useMapEvents({
    click: (e) => {
      dispatch({ type: 'SET_TS_MARKER_POSITION', payload: [e.latlng.lat, e.latlng.lng] });
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
        const tileInfo = await response.json();
        setTileUrl(tileInfo.tiles[0]);
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
    <TileLayer
      url={tileUrl}
      opacity={state.opacity}
      maxZoom={19}
    />
  );
}

function MarkerEventHandlers() {
  const { state, dispatch } = useAppContext();
  const map = useMap();

  const handleMarkerClick = (position: [number, number]) => {
    const [lat, lng] = position;
    L.popup()
      .setLatLng([lat, lng])
      .setContent(`Marker (lon, lat):\n(${lng.toFixed(6)}, ${lat.toFixed(6)})`)
      .openOn(map);
  };

  const handleTsMarkerDragEnd = (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    dispatch({ type: 'SET_TS_MARKER_POSITION', payload: [position.lat, position.lng] });
  };

  const handleRefMarkerDragEnd = (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    dispatch({ type: 'SET_REF_MARKER_POSITION', payload: [position.lat, position.lng] });
  };

  return (
    <>
      <Marker
        position={state.tsMarkerPosition}
        draggable
        title="Time Series Point"
        eventHandlers={{
          click: () => handleMarkerClick(state.tsMarkerPosition),
          dragend: handleTsMarkerDragEnd,
        }}
      />
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
    return [0, 0];
  };

  const selectedBasemap = baseMaps[state.selectedBasemap] || baseMaps.esriSatellite;

  return (
    <LeafletMapContainer
      center={getInitialCenter()}
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
      <MarkerEventHandlers />
      <MapEvents />
      <MousePosition />
    </LeafletMapContainer>
  );
}
