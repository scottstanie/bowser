import { useEffect, useRef, useState, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import { Line } from 'react-chartjs-2';
import L from 'leaflet';
import { useAppContext } from '../context/AppContext';

interface ProfilePoint { dist: number; value: number }

// Vertex handle — defined once at module level, not recreated on each render
const VERTEX_ICON = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:50%;background:#f0a500;border:2px solid white;box-sizing:border-box;margin-left:-6px;margin-top:-6px;cursor:grab"></div>',
  iconSize: [0, 0],
});

export default function ProfileTool({ active, onDeactivate: _onDeactivate }: { active: boolean; onDeactivate: () => void }) {
  const map = useMap();
  const { state } = useAppContext();

  // All mutable map state kept in refs to avoid stale closures in Leaflet handlers
  const polyRef    = useRef<L.Polyline | null>(null);
  const previewRef = useRef<L.Polyline | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const ptsRef     = useRef<L.LatLng[]>([]);
  const modeRef    = useRef<'idle' | 'drawing' | 'ready'>('idle');

  const [profileData, setProfileData] = useState<ProfilePoint[] | null>(null);
  const [loading, setLoading]         = useState(false);

  // Always-current reference to fetchProfile so drag handlers never go stale
  const fetchFn = useCallback(async (pts: L.LatLng[]) => {
    if (pts.length < 2 || !state.currentDataset) return;
    setLoading(true);
    try {
      const res = await fetch('/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coords: pts.map(p => [p.lng, p.lat]),
          dataset_name: state.currentDataset,
          time_index: state.currentTimeIndex,
          n_samples: 200,
        }),
      });
      if (res.ok) setProfileData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [state.currentDataset, state.currentTimeIndex]);

  const fetchRef = useRef(fetchFn);
  useEffect(() => { fetchRef.current = fetchFn; }, [fetchFn]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const updatePoly = (pts: L.LatLng[]) => {
    if (polyRef.current) {
      polyRef.current.setLatLngs(pts);
    } else {
      polyRef.current = L.polyline(pts, { color: '#f0a500', weight: 2.5 }).addTo(map);
    }
  };

  const rebuildMarkers = (pts: L.LatLng[]) => {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = pts.map((pt, idx) => {
      const m = L.marker(pt, { icon: VERTEX_ICON, draggable: true }).addTo(map);
      m.on('drag', () => {
        ptsRef.current[idx] = m.getLatLng();
        updatePoly(ptsRef.current);
      });
      m.on('dragend', () => {
        ptsRef.current[idx] = m.getLatLng();
        fetchRef.current(ptsRef.current);
      });
      return m;
    });
  };

  const clearAll = useCallback(() => {
    polyRef.current?.remove();    polyRef.current = null;
    previewRef.current?.remove(); previewRef.current = null;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    ptsRef.current = [];
    modeRef.current = 'idle';
    setProfileData(null);
  }, []);

  // Re-fetch when time index changes while a profile is drawn
  useEffect(() => {
    if (active && modeRef.current === 'ready' && ptsRef.current.length >= 2) {
      fetchRef.current(ptsRef.current);
    }
  }, [state.currentTimeIndex, active]);

  // ── Main map event effect ──────────────────────────────────────────────────
  useEffect(() => {
    if (!active) {
      // Button turned off → clear everything
      clearAll();
      map.getContainer().style.cursor = '';
      return;
    }

    map.getContainer().style.cursor = 'crosshair';

    const onClick = (e: L.LeafletMouseEvent) => {
      if (modeRef.current === 'ready') {
        // Start a fresh profile on the next click
        clearAll();
        modeRef.current = 'drawing';
        map.getContainer().style.cursor = 'crosshair';
      }
      modeRef.current = 'drawing';
      ptsRef.current = [...ptsRef.current, e.latlng];
      updatePoly(ptsRef.current);
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (modeRef.current !== 'drawing' || ptsRef.current.length === 0) return;
      const preview = [...ptsRef.current, e.latlng];
      if (previewRef.current) {
        previewRef.current.setLatLngs(preview);
      } else {
        previewRef.current = L.polyline(preview, {
          color: '#f0a500', weight: 2, dashArray: '6 4',
        }).addTo(map);
      }
    };

    const onDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      if (modeRef.current !== 'drawing' || ptsRef.current.length < 2) return;
      previewRef.current?.remove(); previewRef.current = null;
      updatePoly(ptsRef.current);
      modeRef.current = 'ready';
      map.getContainer().style.cursor = 'default';
      rebuildMarkers(ptsRef.current);
      fetchRef.current(ptsRef.current);
    };

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    map.on('dblclick', onDblClick);
    map.doubleClickZoom.disable();

    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('dblclick', onDblClick);
      map.doubleClickZoom.enable();
      map.getContainer().style.cursor = '';
    };
  }, [active, map, clearAll]);

  // ── Chart panel ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="profile-panel">
        <div className="chart-placeholder"><p>Extracting profile…</p></div>
      </div>
    );
  }

  if (!profileData || profileData.length === 0 || !state.showProfile) return null;

  const chartData = {
    labels: profileData.map(p => p.dist.toFixed(0)),
    datasets: [{
      label: state.currentDataset,
      data: profileData.map(p => p.value),
      borderColor: '#4d9de0',
      backgroundColor: 'rgba(77,157,224,0.15)',
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0.2,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: { legend: { display: false } },
    scales: {
      x: {
        title: { display: true, text: 'Distance (m)', color: '#aaa' },
        ticks: { color: '#aaa', maxTicksLimit: 8 },
        grid: { color: 'rgba(255,255,255,0.1)' },
      },
      y: {
        title: { display: true, text: state.currentDataset, color: '#aaa' },
        ticks: { color: '#aaa' },
        grid: { color: 'rgba(255,255,255,0.1)' },
      },
    },
  };

  return (
    <div className="profile-panel">
      <div className="chart-header">
        <h4>Profile — {state.currentDataset}</h4>
        <button className="chart-btn" onClick={clearAll} title="Clear profile">
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div style={{ height: 180, position: 'relative' }}>
        <Line data={chartData} options={options as any} />
      </div>
    </div>
  );
}
