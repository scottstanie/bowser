import { useEffect, useState } from 'react';
import { AppProvider, useAppContext } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import MapContainer from './MapContainer';
import ControlPanel from './ControlPanel';
import TimeSeriesChart from './TimeSeriesChart';
import PointManagerPanel from './PointManagerPanel';
import '../style.css';

function AppContent() {
  const { state, dispatch } = useAppContext();
  const { fetchDatasets, fetchDataMode, fetchConfig } = useApi();
  const [appTitle, setAppTitle] = useState('');

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Fetch config (title), data mode, and datasets
        const [config, mode] = await Promise.all([fetchConfig(), fetchDataMode()]);

        if (config.title) {
          setAppTitle(config.title);
          document.title = config.title;
        }

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
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };

    initializeApp();
  }, [fetchDatasets, fetchDataMode, fetchConfig, dispatch]);

  return (
    <div className="app-container">
      <ControlPanel title={appTitle} />
      <div className="map-container">
        <MapContainer />
        <PointManagerPanel />
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
