import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import type { PolygonStats, VectorOverlay } from '../types';

const DEFAULT_PALETTE = [
  '#e63946', '#1d9bf0', '#2a9d8f', '#f4a261', '#7b2cbf',
  '#06d6a0', '#ef476f', '#118ab2', '#ffd166', '#073b4c',
];

/** Sidebar section: upload + manage vector AOIs.
 *
 * Mirrors the existing custom-mask flow (Upload button → POST file →
 * server returns a path) but also keeps a multi-AOI list with toggles,
 * color pickers, and a Stats action that hits /polygon_stats.
 */
export default function VectorOverlayPanel() {
  const { state, dispatch } = useAppContext();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/upload_vector', { method: 'POST', body: form });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `Upload failed: ${res.status}`);
      }
      const data = await res.json();
      const color = DEFAULT_PALETTE[state.vectorOverlays.length % DEFAULT_PALETTE.length];
      dispatch({
        type: 'ADD_VECTOR_OVERLAY',
        payload: {
          id: data.id,
          name: data.name ?? file.name,
          url: data.url,
          color,
          visible: true,
          bbox: data.bbox,
          n_features: data.n_features,
          // Auto-select feature 0 when there's only one — saves a click
          // when the user uploads a single landslide outline etc.
          selectedFeatureIdx: data.n_features === 1 ? 0 : null,
        },
      });
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="vector-overlay-panel">
      <label className="hist-btn vector-upload-btn"
             style={{ cursor: 'pointer', textAlign: 'center', display: 'block' }}>
        {uploading ? 'Uploading…' : <><i className="fa-solid fa-upload" style={{ marginRight: 6 }} />Upload AOI (.geojson, .kml, .kmz, .shp.zip)</>}
        <input type="file" accept=".geojson,.json,.kml,.kmz,.zip,.gpkg"
               style={{ display: 'none' }}
               onChange={async e => {
                 const f = e.target.files?.[0];
                 if (f) await onUpload(f);
                 // Reset the input so re-uploading the same file fires onChange.
                 e.target.value = '';
               }} />
      </label>
      {error && <div className="vector-upload-error" style={{ color: 'var(--sb-red, #c44)', fontSize: '0.78em', marginTop: 6 }}>{error}</div>}
      {state.vectorOverlays.length > 0 && (
        <div className="vector-overlay-list" style={{ marginTop: 8 }}>
          {state.vectorOverlays.map(o => (
            <VectorOverlayRow key={o.id} overlay={o} />
          ))}
        </div>
      )}
    </div>
  );
}


function VectorOverlayRow({ overlay }: { overlay: VectorOverlay }) {
  const { state, dispatch } = useAppContext();
  const [busy, setBusy] = useState(false);
  const stat = state.polygonStats.find(s => s.overlayId === overlay.id);

  const fitToOverlay = () => {
    const [lonMin, latMin, lonMax, latMax] = overlay.bbox;
    dispatch({ type: 'APPLY_VIEW_BOUNDS', payload: [latMin, lonMin, latMax, lonMax] });
  };

  const fetchStats = async () => {
    if (!state.currentDataset) {
      alert('Select a dataset first.');
      return;
    }
    if (overlay.selectedFeatureIdx === null) {
      alert('Click a feature on the map to select it for stats.');
      return;
    }
    setBusy(true);
    try {
      // Fetch the GeoJSON to pull the chosen feature's geometry.
      const res = await fetch(overlay.url);
      const fc = await res.json();
      const feat = fc.features[overlay.selectedFeatureIdx];
      if (!feat) throw new Error('Feature index out of range');
      const body = {
        dataset_name: state.currentDataset,
        geometry: feat.geometry,
        geometry_crs: 'EPSG:4326',
        layer_masks: state.layerMasks,
      };
      const r2 = await fetch('/polygon_stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r2.ok) {
        const d = await r2.text();
        throw new Error(d || `polygon_stats failed: ${r2.status}`);
      }
      const result = await r2.json();
      const stats: PolygonStats = {
        overlayId: overlay.id,
        featureIdx: overlay.selectedFeatureIdx,
        dataset: state.currentDataset,
        summary: result.summary,
        time: result.time,
        series: result.series,
        n_pixels: result.n_pixels,
      };
      dispatch({ type: 'SET_POLYGON_STATS', payload: stats });
    } catch (e: any) {
      alert(`Stats failed: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async () => {
    if (overlay.selectedFeatureIdx === null || !state.currentDataset) {
      alert('Select a feature and a dataset first.');
      return;
    }
    const res = await fetch(overlay.url);
    const fc = await res.json();
    const feat = fc.features[overlay.selectedFeatureIdx];
    const body = {
      dataset_name: state.currentDataset,
      geometry: feat.geometry,
      geometry_crs: 'EPSG:4326',
      layer_masks: state.layerMasks,
    };
    const r = await fetch('/polygon_stats/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      alert(`CSV export failed: ${r.status}`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${overlay.name.replace(/\.[^.]+$/, '')}_${state.currentDataset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vector-overlay-row" style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderBottom: '1px solid var(--sb-border, #2c2f33)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          className="toggle-pill"
          title={overlay.visible ? 'Hide' : 'Show'}
          style={{ minWidth: 32 }}
          onClick={() => dispatch({ type: 'UPDATE_VECTOR_OVERLAY', payload: { id: overlay.id, updates: { visible: !overlay.visible } } })}>
          <i className={`fa-solid ${overlay.visible ? 'fa-eye' : 'fa-eye-slash'}`} />
        </button>
        <input
          type="color"
          value={overlay.color}
          onChange={e => dispatch({ type: 'UPDATE_VECTOR_OVERLAY', payload: { id: overlay.id, updates: { color: e.target.value } } })}
          style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent' }}
          title="Overlay color"
        />
        <span title={overlay.name} style={{ flex: 1, fontSize: '0.82em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {overlay.name}
        </span>
        <button className="hist-btn" title="Fit map to AOI" style={{ padding: '2px 6px' }} onClick={fitToOverlay}>
          <i className="fa-solid fa-crosshairs" />
        </button>
        <button className="hist-btn" title="Remove" style={{ padding: '2px 6px', color: 'var(--sb-red, #c44)' }}
                onClick={() => dispatch({ type: 'REMOVE_VECTOR_OVERLAY', payload: overlay.id })}>
          <i className="fa-solid fa-xmark" />
        </button>
      </div>
      <div style={{ fontSize: '0.72em', color: 'var(--sb-muted)' }}>
        {overlay.n_features} feature{overlay.n_features !== 1 ? 's' : ''}
        {overlay.selectedFeatureIdx !== null && ` · selected #${overlay.selectedFeatureIdx}`}
        {overlay.selectedFeatureIdx === null && overlay.n_features > 1 && ' · click a feature on map to pick'}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="hist-btn" disabled={busy} onClick={fetchStats} style={{ flex: 1 }}>
          {busy ? 'Computing…' : <><i className="fa-solid fa-chart-column" style={{ marginRight: 4 }} />Stats</>}
        </button>
        <button className="hist-btn" onClick={downloadCsv} style={{ flex: 1 }}>
          <i className="fa-solid fa-file-csv" style={{ marginRight: 4 }} />CSV
        </button>
      </div>
      {stat && <PolygonStatSummary stat={stat} />}
    </div>
  );
}


function PolygonStatSummary({ stat }: { stat: PolygonStats }) {
  const fmt = (v: number) => Number.isFinite(v) ? v.toPrecision(4) : '–';
  const s = stat.summary;
  const isTimeSeries = (stat.series?.length ?? 0) > 0;
  return (
    <div className="polygon-stat-summary" style={{ background: 'var(--sb-elev1, #1c1f23)', padding: 6, borderRadius: 4, fontSize: '0.74em' }}>
      <div style={{ color: 'var(--sb-muted)', marginBottom: 4 }}>
        {stat.dataset} · {stat.n_pixels} px{isTimeSeries && ` · ${stat.series!.length} steps`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', columnGap: 8, rowGap: 2 }}>
        <span>median</span><span style={{ textAlign: 'right' }}>{fmt(s.median)}</span>
        <span>mean</span><span style={{ textAlign: 'right' }}>{fmt(s.mean)}</span>
        <span>std</span><span style={{ textAlign: 'right' }}>{fmt(s.std)}</span>
        <span>p5–p95</span><span style={{ textAlign: 'right' }}>{fmt(s.p5)} … {fmt(s.p95)}</span>
        <span>min/max</span><span style={{ textAlign: 'right' }}>{fmt(s.min)} / {fmt(s.max)}</span>
      </div>
      {isTimeSeries && <PolygonStatSparkline series={stat.series!} />}
    </div>
  );
}


/** Tiny inline SVG sparkline of the median across timesteps.
 *
 * Reasons it's an SVG and not chart.js: ChartWindows already exists for
 * the heavier point-time-series plot; adding polygon stats to it would
 * collide with point-keyed datasets. A single-purpose sparkline keeps
 * the panel self-contained and dependency-free.
 */
function PolygonStatSparkline({ series }: { series: { median: number }[] }) {
  if (!series.length) return null;
  const values = series.map(r => Number.isFinite(r.median) ? r.median : NaN);
  const finite = values.filter(v => Number.isFinite(v));
  if (!finite.length) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const range = hi - lo || 1;
  const w = 180;
  const h = 32;
  const stepX = w / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => Number.isFinite(v) ? `${(i * stepX).toFixed(1)},${(h - ((v - lo) / range) * h).toFixed(1)}` : null)
    .filter(Boolean) as string[];
  return (
    <svg width={w} height={h} style={{ display: 'block', marginTop: 6 }} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke="var(--sb-accent, #4cc2ff)" strokeWidth={1.5} points={points.join(' ')} />
    </svg>
  );
}
