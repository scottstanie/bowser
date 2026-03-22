import { useEffect } from 'react';
import { AppProvider, useAppContext } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { usePointsApi } from '../hooks/usePointsApi';
import MapContainer from './MapContainer';
import ControlPanel from './ControlPanel';
import TimeSeriesChart from './TimeSeriesChart';
import PointManagerPanel from './PointManagerPanel';
import '../style.css';

function AppContent() {
  const { state, dispatch } = useAppContext();
  const { fetchDatasets, fetchDataMode } = useApi();
  const { fetchPointLayers, fetchPointAttributes } = usePointsApi();

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Try to load point layers first (V2 mode)
        let hasPointLayers = false;
        try {
          const pointLayers = await fetchPointLayers();
          const layerNames = Object.keys(pointLayers);
          if (layerNames.length > 0) {
            hasPointLayers = true;
            const firstLayer = layerNames[0];
            dispatch({ type: 'SET_ACTIVE_POINT_LAYER', payload: firstLayer });
            dispatch({ type: 'SET_DATA_MODE', payload: 'points' });

            // Get attributes to learn about the data
            const attrs = await fetchPointAttributes(firstLayer);

            // Set bounds from lon/lat ranges
            const lonAttr = attrs.attributes.longitude;
            const latAttr = attrs.attributes.latitude;
            if (lonAttr?.min != null && lonAttr?.max != null &&
                latAttr?.min != null && latAttr?.max != null) {
              dispatch({
                type: 'SET_POINT_LAYER_BOUNDS',
                payload: [lonAttr.min, latAttr.min, lonAttr.max, latAttr.max],
              });
            }
          }
        } catch {
          // No point layers endpoint — V1 mode
        }

        if (!hasPointLayers) {
          // V1 initialization: fetch data mode and datasets
          const mode = await fetchDataMode();
          dispatch({ type: 'SET_DATA_MODE', payload: mode });

          const datasets = await fetchDatasets();
          dispatch({ type: 'SET_DATASETS', payload: datasets });

          const firstDataset = Object.keys(datasets)[0];
          if (firstDataset) {
            dispatch({ type: 'SET_CURRENT_DATASET', payload: firstDataset });

            const bounds = datasets[firstDataset].latlon_bounds;
            const centerLat = (bounds[1] + bounds[3]) / 2;
            const centerLng = (bounds[0] + bounds[2]) / 2;
            dispatch({ type: 'SET_REF_MARKER_POSITION', payload: [centerLat, centerLng] });
          }
        }
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };

    initializeApp();
  }, [fetchDatasets, fetchDataMode, fetchPointLayers, fetchPointAttributes, dispatch]);

  const isPointMode = state.dataMode === 'points';

  return (
    <div className="app-container">
      {!isPointMode && <ControlPanel />}
      <div className="map-container" style={isPointMode ? { gridColumn: '1 / -1' } : undefined}>
        <MapContainer />
        {!isPointMode && <PointManagerPanel />}
        {state.showChart && <TimeSeriesChart />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
