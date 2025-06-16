import { useAppContext } from '../context/AppContext';
import { baseMaps } from '../basemap';
import { useApi } from '../hooks/useApi';

const colormapOptions = [
  { value: 'rdbu_r', label: 'Blue-Red' },
  { value: 'twilight', label: 'Twilight (cyclic)' },
  { value: 'cfastie', label: 'CFastie' },
  { value: 'rplumbo', label: 'RPlumbo' },
  { value: 'schwarzwald', label: 'Schwarzwald (elevation)' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'bugn', label: 'Blue-Green' },
  { value: 'ylgn', label: 'Yellow-Green' },
  { value: 'magma', label: 'Magma' },
  { value: 'gist_earth', label: 'Earth' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'terrain', label: 'Terrain' },
];

export default function ControlPanel() {
  const { state, dispatch } = useAppContext();
  const { fetchPointTimeSeries } = useApi();

  const handleDatasetChange = (datasetName: string) => {
    // Save current preferences
    savePreferences(state.currentDataset);

    dispatch({ type: 'SET_CURRENT_DATASET', payload: datasetName });

    // Load preferences for new dataset
    loadPreferences(datasetName);

    // Set reference values if needed
    const currentDatasetInfo = state.datasetInfo[datasetName];
    if (currentDatasetInfo?.uses_spatial_ref && !state.refValues[datasetName]) {
      setRefValues(datasetName);
    }
  };

  const handleTimeIndexChange = (newIndex: number) => {
    dispatch({ type: 'SET_TIME_INDEX', payload: newIndex });
  };

  const handleColormapChange = (colormap: string) => {
    dispatch({ type: 'SET_COLORMAP', payload: colormap });
    savePreferences(state.currentDataset);
  };

  const handleVminChange = (vmin: number) => {
    dispatch({ type: 'SET_VMIN', payload: vmin });
    savePreferences(state.currentDataset);
  };

  const handleVmaxChange = (vmax: number) => {
    dispatch({ type: 'SET_VMAX', payload: vmax });
    savePreferences(state.currentDataset);
  };

  const handleOpacityChange = (opacity: number) => {
    dispatch({ type: 'SET_OPACITY', payload: opacity });
  };

  const handleBasemapChange = (basemapKey: string) => {
    dispatch({ type: 'SET_BASEMAP', payload: basemapKey });
  };

  const toggleChart = () => {
    dispatch({ type: 'TOGGLE_CHART' });
  };

  const setRefValues = async (datasetName: string) => {
    const [lat, lng] = state.refMarkerPosition;
    try {
      const values = await fetchPointTimeSeries(lng, lat, datasetName);
      if (values) {
        dispatch({
          type: 'SET_REF_VALUES',
          payload: { dataset: datasetName, values }
        });
      }
    } catch (error) {
      console.error('Error setting reference values:', error);
    }
  };

  const savePreferences = (datasetName: string) => {
    if (!datasetName) return;
    localStorage.setItem(`${datasetName}-colormap_name`, state.colormap);
    localStorage.setItem(`${datasetName}-vmin`, state.vmin.toString());
    localStorage.setItem(`${datasetName}-vmax`, state.vmax.toString());
  };

  const loadPreferences = (datasetName: string) => {
    if (!datasetName) return;

    const colormap = localStorage.getItem(`${datasetName}-colormap_name`);
    const vmin = localStorage.getItem(`${datasetName}-vmin`);
    const vmax = localStorage.getItem(`${datasetName}-vmax`);

    if (colormap) dispatch({ type: 'SET_COLORMAP', payload: colormap });
    if (vmin) dispatch({ type: 'SET_VMIN', payload: parseFloat(vmin) });
    if (vmax) dispatch({ type: 'SET_VMAX', payload: parseFloat(vmax) });
  };

  const currentDatasetInfo = state.currentDataset ? state.datasetInfo[state.currentDataset] : null;
  const currentTimeValue = currentDatasetInfo ? currentDatasetInfo.x_values[state.currentTimeIndex] : '';

  return (
    <div id="menu">
      <div id="menu-content" className="pure-form">
        {/* Dataset Selector */}
        <div className="menu-group">
          <div>
            <i className="fa-solid fa-layer-group"></i> Layers
          </div>
          <div className="select-container">
            <select
              value={state.currentDataset}
              onChange={(e) => handleDatasetChange(e.target.value)}
            >
              {Object.keys(state.datasetInfo).map((datasetName) => (
                <option key={datasetName} value={datasetName}>
                  {datasetName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Time Slider */}
        {currentDatasetInfo && (
          <div className="menu-group">
            <label htmlFor="layer-slider">
              Viewing Image: <span id="layer-slider-value">{currentTimeValue}</span>
            </label>
            <input
              id="layer-slider"
              className="input"
              type="range"
              min="0"
              max={currentDatasetInfo.x_values.length - 1}
              step="1"
              value={state.currentTimeIndex}
              onChange={(e) => handleTimeIndexChange(parseInt(e.target.value))}
            />
          </div>
        )}

        {/* Colormap Section */}
        <div className="menu-group">
          <div id="colormap-section">
            <div>
              <i className="fa-solid fa-palette"></i> Color Map
            </div>
            <div className="select-container">
              <select
                value={state.colormap}
                onChange={(e) => handleColormapChange(e.target.value)}
              >
                {colormapOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <img
              id="colormap-img"
              src={`/colorbar/${state.colormap}`}
              style={{ maxWidth: '100%', height: 'auto' }}
              alt="Colormap"
            />
          </div>

          {/* Min/Max Controls */}
          <div id="minmax-data">
            <div>Rescale color limits</div>
            <div>
              <input
                className="input"
                type="number"
                step="0.01"
                value={state.vmin}
                onChange={(e) => handleVminChange(parseFloat(e.target.value))}
              />
            </div>
            <div>
              <input
                className="input"
                type="number"
                step="0.01"
                value={state.vmax}
                onChange={(e) => handleVmaxChange(parseFloat(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Opacity Slider */}
        <div className="menu-group pure-form">
          <div id="opacity-slider-container">
            <div>
              <label htmlFor="opacity-slider">
                Opacity: <span id="opacity-slider-value">{state.opacity}</span>
              </label>
            </div>
            <input
              id="opacity-slider"
              className="input"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.opacity}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
            />
          </div>
        </div>

        {/* Basemap Selector */}
        <div className="select-container">
          Basemap:
          <select
            value={state.selectedBasemap}
            onChange={(e) => handleBasemapChange(e.target.value)}
          >
            {Object.entries(baseMaps).map(([key]) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Chart Control */}
      <div className="menu-group">
        <div id="menu-chart">
          <button
            className="pure-button pure-button-primary"
            onClick={toggleChart}
          >
            {state.showChart ? 'Hide time series' : 'Show time series'}
          </button>
        </div>
      </div>
    </div>
  );
}
