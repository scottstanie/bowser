import { useEffect, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { baseMaps } from '../basemap';
import { useApi } from '../hooks/useApi';
import Histogram from './Histogram';

const colormapOptions = [
  { value: 'rdbu', label: 'Blue–Red' },
  { value: 'twilight', label: 'Twilight (cyclic)' },
  { value: 'cfastie', label: 'CFastie' },
  { value: 'rplumbo', label: 'RPlumbo' },
  { value: 'schwarzwald', label: 'Schwarzwald' },
  { value: 'viridis', label: 'Viridis' },
  { value: 'bugn', label: 'Blue–Green' },
  { value: 'ylgn', label: 'Yellow–Green' },
  { value: 'magma', label: 'Magma' },
  { value: 'gist_earth', label: 'Earth' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'terrain', label: 'Terrain' },
  { value: 'gray', label: 'Grays' },
  { value: 'jet', label: 'Jet' },
];

export default function ControlPanel() {
  const { state, dispatch } = useAppContext();
  const { fetchPointTimeSeries } = useApi();
  const [draftVmin, setDraftVmin] = useState(String(state.vmin));
  const [draftVmax, setDraftVmax] = useState(String(state.vmax));

  useEffect(() => setDraftVmin(String(state.vmin)), [state.vmin]);
  useEffect(() => setDraftVmax(String(state.vmax)), [state.vmax]);

  useEffect(() => {
    const datasetName = state.currentDataset;
    if (!datasetName) return;

    const safeNumToString = (x: number) => (Object.is(x, -0) ? '-0' : String(x));

    localStorage.setItem(`${datasetName}-colormap_name`, state.colormap);
    localStorage.setItem(`${datasetName}-vmin`, safeNumToString(state.vmin));
    localStorage.setItem(`${datasetName}-vmax`, safeNumToString(state.vmax));
  }, [state.colormap, state.vmin, state.vmax]);

  useEffect(() => {
    const ds = state.currentDataset;
    if (!ds) return;
    const info = state.datasetInfo[ds];
    const isPhase = info?.algorithm === 'phase' || info?.algorithm === 'rewrap';
    const colormap = localStorage.getItem(`${ds}-colormap_name`);
    const vminStr = localStorage.getItem(`${ds}-vmin`);
    const vmaxStr = localStorage.getItem(`${ds}-vmax`);
    if (colormap) dispatch({ type: 'SET_COLORMAP', payload: colormap });
    if (vminStr !== null) {
      const v = Number(vminStr);
      if (!Number.isNaN(v)) dispatch({ type: 'SET_VMIN', payload: v });
    } else if (isPhase) {
      dispatch({ type: 'SET_VMIN', payload: -Math.PI });
    }
    if (vmaxStr !== null) {
      const v = Number(vmaxStr);
      if (!Number.isNaN(v)) dispatch({ type: 'SET_VMAX', payload: v });
    } else if (isPhase) {
      dispatch({ type: 'SET_VMAX', payload: Math.PI });
    }
  }, [state.currentDataset, dispatch]);

  const handleDatasetChange = (ds: string) => {
    dispatch({ type: 'SET_CURRENT_DATASET', payload: ds });
    const info = state.datasetInfo[ds];
    if (info?.uses_spatial_ref && !state.refValues[ds]) setRefValues(ds);
  };

  const commitVmin = useCallback(() => {
    const v = Number(draftVmin);
    if (!Number.isNaN(v)) dispatch({ type: 'SET_VMIN', payload: v });
  }, [draftVmin, dispatch]);

  const commitVmax = useCallback(() => {
    const v = Number(draftVmax);
    if (!Number.isNaN(v)) dispatch({ type: 'SET_VMAX', payload: v });
  }, [draftVmax, dispatch]);

  const setRefValues = async (ds: string) => {
    const [lat, lng] = state.refMarkerPosition;
    try {
      const values = await fetchPointTimeSeries(lng, lat, ds);
      if (values) dispatch({ type: 'SET_REF_VALUES', payload: { dataset: ds, values } });
    } catch (error) {
      console.error('Error setting reference values:', error);
    }
  };

  const currentDatasetInfo = state.currentDataset ? state.datasetInfo[state.currentDataset] : null;
  const currentTimeValue = currentDatasetInfo
    ? currentDatasetInfo.x_values[state.currentTimeIndex]
    : '';

  return (
    <div id="menu">
      {/* ── LAYERS ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-layer-group"></i> Layers
        </div>
        <select
          className="sidebar-select"
          value={state.currentDataset}
          onChange={e => handleDatasetChange(e.target.value)}
        >
          {Object.keys(state.datasetInfo).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {currentDatasetInfo && (
          <div className="slider-group">
            <div className="slider-label">
              <span>Time step</span>
              <span className="slider-value">{currentTimeValue}</span>
            </div>
            <input
              type="range"
              className="sidebar-range"
              min="0"
              max={currentDatasetInfo.x_values.length - 1}
              step="1"
              value={state.currentTimeIndex}
              onChange={e => dispatch({ type: 'SET_TIME_INDEX', payload: parseInt(e.target.value) })}
            />
          </div>
        )}
      </div>

      {/* ── COLORMAP ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-palette"></i> Colormap
        </div>
        <div className="colormap-row">
          <select
            className="sidebar-select"
            value={state.colormap.endsWith('_r') ? state.colormap.slice(0, -2) : state.colormap}
            onChange={e => {
              const base = e.target.value;
              const inverted = state.colormap.endsWith('_r');
              dispatch({ type: 'SET_COLORMAP', payload: inverted ? `${base}_r` : base });
            }}
          >
            {colormapOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className={`invert-btn${state.colormap.endsWith('_r') ? ' active' : ''}`}
            title="Invert colormap"
            onClick={() => {
              const cm = state.colormap;
              dispatch({ type: 'SET_COLORMAP', payload: cm.endsWith('_r') ? cm.slice(0, -2) : `${cm}_r` });
            }}
          >⇅</button>
        </div>
        <img
          src={`/colorbar/${state.colormap}`}
          className="colorbar-img"
          alt="Colormap"
        />
        <div className="minmax-row">
          <div className="minmax-field">
            <label className="minmax-label">Min</label>
            <input
              className="sidebar-input"
              type="text"
              inputMode="decimal"
              value={draftVmin}
              onChange={e => setDraftVmin(e.target.value)}
              onBlur={commitVmin}
              onKeyDown={e => e.key === 'Enter' && commitVmin()}
            />
          </div>
          <div className="minmax-field">
            <label className="minmax-label">Max</label>
            <input
              className="sidebar-input"
              type="text"
              inputMode="decimal"
              value={draftVmax}
              onChange={e => setDraftVmax(e.target.value)}
              onBlur={commitVmax}
              onKeyDown={e => e.key === 'Enter' && commitVmax()}
            />
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-label">
            <span>Opacity</span>
            <span className="slider-value">{Math.round(state.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            className="sidebar-range"
            min="0" max="1" step="0.01"
            value={state.opacity}
            onChange={e => dispatch({ type: 'SET_OPACITY', payload: parseFloat(e.target.value) })}
          />
        </div>
      </div>

      {/* ── BASEMAP ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-map"></i> Basemap
        </div>
        <select
          className="sidebar-select"
          value={state.selectedBasemap}
          onChange={e => dispatch({ type: 'SET_BASEMAP', payload: e.target.value })}
        >
          {Object.keys(baseMaps).map(key => (
            <option key={key} value={key}>{key}</option>
          ))}
        </select>
      </div>

      {/* ── VALUE DISTRIBUTION ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-chart-bar"></i> Value Distribution
        </div>
        <Histogram />
      </div>

      {/* ── MASKING ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-mask"></i> Masking
        </div>

        {/* Layer masks list */}
        {state.layerMasks.map(mask => (
          <div key={mask.id} className="layer-mask-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <select
                className="sidebar-select"
                style={{ flex: 1, fontSize: '0.78em' }}
                value={mask.dataset}
                onChange={e => dispatch({ type: 'UPDATE_LAYER_MASK', payload: { id: mask.id, updates: { dataset: e.target.value } } })}
              >
                {Object.keys(state.datasetInfo).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <select
                className="sidebar-select"
                style={{ width: 56, fontSize: '0.78em', padding: '2px 4px' }}
                value={mask.mode}
                onChange={e => dispatch({ type: 'UPDATE_LAYER_MASK', payload: { id: mask.id, updates: { mode: e.target.value as 'min' | 'max' } } })}
              >
                <option value="min">≥</option>
                <option value="max">≤</option>
              </select>
              <button
                className="hist-btn"
                style={{ color: 'var(--sb-red)', padding: '2px 6px', flexShrink: 0 }}
                onClick={() => dispatch({ type: 'REMOVE_LAYER_MASK', payload: mask.id })}
                title="Remove mask"
              ><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="slider-label">
              <span style={{ fontSize: '0.75em', color: 'var(--sb-muted)' }}>Threshold</span>
              <span className="slider-value">{mask.threshold.toFixed(2)}</span>
            </div>
            <input
              type="range" className="sidebar-range"
              min="0" max="1" step="0.01"
              value={mask.threshold}
              onChange={e => dispatch({ type: 'UPDATE_LAYER_MASK', payload: { id: mask.id, updates: { threshold: parseFloat(e.target.value) } } })}
            />
          </div>
        ))}

        {/* Add mask button */}
        {Object.keys(state.datasetInfo).length > 0 && (
          <button
            className="hist-btn"
            style={{ width: '100%', marginTop: 4 }}
            onClick={() => {
              const firstDataset = Object.keys(state.datasetInfo)[0];
              dispatch({
                type: 'ADD_LAYER_MASK',
                payload: {
                  id: `mask_${Date.now()}`,
                  dataset: firstDataset,
                  threshold: 0.5,
                  mode: 'min',
                },
              });
            }}
          >
            <i className="fa-solid fa-plus" style={{ marginRight: 5 }}></i>Add layer mask
          </button>
        )}

        {/* Custom mask upload */}
        <div className="custom-mask-row" style={{ marginTop: 8 }}>
          <label className="minmax-label" style={{ marginBottom: 4 }}>Custom mask (GeoTIFF)</label>
          <div className="custom-mask-controls">
            <label className="hist-btn" style={{ cursor: 'pointer', textAlign: 'center' }}>
              Upload
              <input
                type="file"
                accept=".tif,.tiff"
                style={{ display: 'none' }}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.append('file', f);
                  const res = await fetch('/upload_mask', { method: 'POST', body: form });
                  if (res.ok) {
                    const data = await res.json();
                    dispatch({ type: 'SET_CUSTOM_MASK_PATH', payload: data.path });
                  }
                }}
              />
            </label>
            {state.customMaskPath && (
              <button
                className="hist-btn"
                style={{ color: 'var(--sb-red)' }}
                onClick={() => dispatch({ type: 'SET_CUSTOM_MASK_PATH', payload: null })}
              >Clear</button>
            )}
          </div>
          {state.customMaskPath && (
            <div style={{ fontSize: '0.72em', color: 'var(--sb-muted)', wordBreak: 'break-all', marginTop: 2 }}>
              {state.customMaskPath.split('/').pop()}
            </div>
          )}
        </div>
      </div>

      {/* ── BUFFER SAMPLING (time series points) ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-circle-dot"></i> Point Buffer Sampling
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: '0.82em', color: 'var(--sb-muted)' }}>Enable buffer mode</span>
          <button
            className={`toggle-pill${state.bufferEnabled ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'TOGGLE_BUFFER' })}
          >
            {state.bufferEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        {state.bufferEnabled && (
          <>
            <div className="slider-group">
              <div className="slider-label">
                <span>Radius</span>
                <span className="slider-value">{state.bufferRadius} m</span>
              </div>
              <input
                type="range" className="sidebar-range"
                min="50" max="5000" step="50"
                value={state.bufferRadius}
                onChange={e => dispatch({ type: 'SET_BUFFER_RADIUS', payload: parseInt(e.target.value) })}
              />
            </div>
            <div className="slider-group">
              <div className="slider-label">
                <span>Samples shown</span>
                <span className="slider-value">{state.bufferSamples}</span>
              </div>
              <input
                type="range" className="sidebar-range"
                min="0" max="50" step="1"
                value={state.bufferSamples}
                onChange={e => dispatch({ type: 'SET_BUFFER_SAMPLES', payload: parseInt(e.target.value) })}
              />
            </div>
          </>
        )}
      </div>

      {/* ── REFERENCE POINT BUFFER ── */}
      <div className="sidebar-section">
        <div className="sidebar-section-label">
          <i className="fa-solid fa-crosshairs"></i> Reference Buffer
        </div>
        <div className="toggle-row">
          <span style={{ fontSize: '0.82em', color: 'var(--sb-muted)' }}>Sample around ref marker</span>
          <button
            className={`toggle-pill${state.refBufferEnabled ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'TOGGLE_REF_BUFFER' })}
          >
            {state.refBufferEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
        {state.refBufferEnabled && (
          <>
            <div className="slider-group">
              <div className="slider-label">
                <span>Radius</span>
                <span className="slider-value">{state.refBufferRadius} m</span>
              </div>
              <input
                type="range" className="sidebar-range"
                min="50" max="5000" step="50"
                value={state.refBufferRadius}
                onChange={e => dispatch({ type: 'SET_REF_BUFFER_RADIUS', payload: parseInt(e.target.value) })}
              />
            </div>
          </>
        )}
      </div>

      {/* ── CHART TOGGLES ── */}
      <div className="sidebar-footer">
        <button
          className={`toggle-pill${state.pickingEnabled ? ' active' : ''}`}
          style={{ width: '100%', marginBottom: 6, justifyContent: 'center' }}
          onClick={() => dispatch({ type: 'TOGGLE_PICKING' })}
          title="Toggle map-click point picking"
        >
          <i className="fa-solid fa-map-pin" style={{ marginRight: 6 }}></i>
          Point Picking: {state.pickingEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          className={`toggle-pill${state.refEnabled ? ' active' : ''}`}
          style={{ width: '100%', marginBottom: 6, justifyContent: 'center' }}
          onClick={() => dispatch({ type: 'TOGGLE_REF_ENABLED' })}
          title="Toggle spatial re-referencing"
        >
          <i className="fa-solid fa-crosshairs" style={{ marginRight: 6 }}></i>
          Re-referencing: {state.refEnabled ? 'ON' : 'OFF'}
        </button>
        <button
          className="chart-toggle-btn"
          onClick={() => dispatch({ type: 'TOGGLE_CHART' })}
        >
          <i className={`fa-solid ${state.showChart ? 'fa-chart-line' : 'fa-wave-square'}`}></i>
          {state.showChart ? 'Hide' : 'Show'} Time Series
        </button>
        <button
          className="chart-toggle-btn"
          style={{ marginTop: 4 }}
          onClick={() => dispatch({ type: 'TOGGLE_PROFILE' })}
        >
          <i className="fa-solid fa-chart-area"></i>
          {state.showProfile ? 'Hide' : 'Show'} Profile
        </button>
        {state.refBufferEnabled && (
          <button
            className="chart-toggle-btn"
            style={{ marginTop: 4 }}
            onClick={() => dispatch({ type: 'TOGGLE_REF_CHART' })}
          >
            <i className="fa-solid fa-crosshairs"></i>
            {state.showRefChart ? 'Hide' : 'Show'} Ref Buffer Chart
          </button>
        )}
      </div>
    </div>
  );
}
