import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { useAppContext } from '../context/AppContext';

// Color palette matching the point colors
const COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
];

export default function TimeSeriesChart() {
  const { state, dispatch } = useAppContext();

  const traces = useMemo(() => {
    // V2 point layer mode: show clicked points
    if (state.clickedPoints.length > 0) {
      return state.clickedPoints.map((cp, i) => ({
        x: cp.timeseries.map(t => t.date),
        y: cp.timeseries.map(t => t.displacement),
        type: 'scattergl' as const,
        mode: 'lines+markers' as const,
        name: `Point ${cp.pointId}`,
        marker: { color: COLORS[i % COLORS.length], size: 5 },
        line: { color: COLORS[i % COLORS.length], width: 1.5 },
      }));
    }

    // V1 raster mode: show time series points (existing behavior)
    if (state.timeSeriesPoints.length > 0 && state.currentDataset) {
      return state.timeSeriesPoints
        .filter(p => p.visible && p.data?.[state.currentDataset])
        .map(p => {
          const data = p.data![state.currentDataset];
          const info = state.datasetInfo[state.currentDataset];
          const xValues = info?.x_values || data.map((_, i) => i);
          return {
            x: xValues,
            y: data,
            type: 'scattergl' as const,
            mode: 'lines+markers' as const,
            name: p.name,
            marker: { color: p.color, size: 5 },
            line: { color: p.color, width: 1.5 },
          };
        });
    }

    return [];
  }, [state.clickedPoints, state.timeSeriesPoints, state.currentDataset, state.datasetInfo]);

  if (traces.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '250px',
      zIndex: 1000,
      background: '#1a1a2e',
      borderTop: '1px solid #333',
    }}>
      <button
        onClick={() => {
          dispatch({ type: 'TOGGLE_CHART' });
          dispatch({ type: 'CLEAR_CLICKED_POINTS' });
        }}
        style={{
          position: 'absolute', top: 4, right: 8, zIndex: 1001,
          background: 'transparent', border: 'none', color: '#888',
          cursor: 'pointer', fontSize: 16,
        }}
      >
        ✕
      </button>
      <Plot
        data={traces}
        layout={{
          autosize: true,
          margin: { l: 55, r: 15, t: 10, b: 40 },
          paper_bgcolor: '#1a1a2e',
          plot_bgcolor: '#16213e',
          font: { color: '#ccc', size: 11 },
          xaxis: {
            gridcolor: '#2a3a5e',
            title: { text: 'Date' },
          },
          yaxis: {
            gridcolor: '#2a3a5e',
            title: { text: 'Displacement (mm)' },
          },
          legend: {
            bgcolor: 'rgba(0,0,0,0.3)',
            font: { size: 10 },
          },
          showlegend: traces.length > 1,
        }}
        config={{
          displayModeBar: true,
          modeBarButtonsToRemove: ['lasso2d', 'select2d'],
          displaylogo: false,
          responsive: true,
        }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  );
}
