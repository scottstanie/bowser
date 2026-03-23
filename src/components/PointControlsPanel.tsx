import { useState } from 'react';
import { useAppContext } from '../context/AppContext';

export default function PointControlsPanel() {
  const { state, dispatch } = useAppContext();
  const [draftVmin, setDraftVmin] = useState(String(state.pointVmin));
  const [draftVmax, setDraftVmax] = useState(String(state.pointVmax));

  // Only show numeric (non-geometry, non-id) attributes in the dropdown
  const numericAttrs = Object.entries(state.pointAttributes).filter(
    ([name, info]) =>
      name !== 'geometry' &&
      name !== 'point_id' &&
      name !== 'longitude' &&
      name !== 'latitude' &&
      (info.type.includes('FLOAT') || info.type.includes('DOUBLE') || info.type.includes('INT'))
  );

  const handleColorByChange = (value: string) => {
    dispatch({ type: 'SET_POINT_COLOR_BY', payload: value });
    // Auto-set vmin/vmax from the attribute range
    const attr = state.pointAttributes[value];
    if (attr?.min != null && attr?.max != null) {
      // Use symmetric range around 0 for velocity-like attributes
      if (value.includes('velocity')) {
        const absMax = Math.max(Math.abs(attr.min), Math.abs(attr.max));
        dispatch({ type: 'SET_POINT_VMIN', payload: -absMax });
        dispatch({ type: 'SET_POINT_VMAX', payload: absMax });
        setDraftVmin(String(-absMax.toFixed(2)));
        setDraftVmax(String(absMax.toFixed(2)));
      } else {
        dispatch({ type: 'SET_POINT_VMIN', payload: attr.min });
        dispatch({ type: 'SET_POINT_VMAX', payload: attr.max });
        setDraftVmin(String(attr.min.toFixed(2)));
        setDraftVmax(String(attr.max.toFixed(2)));
      }
    }
  };

  const commitVmin = () => {
    const v = parseFloat(draftVmin);
    if (!isNaN(v)) dispatch({ type: 'SET_POINT_VMIN', payload: v });
  };

  const commitVmax = () => {
    const v = parseFloat(draftVmax);
    if (!isNaN(v)) dispatch({ type: 'SET_POINT_VMAX', payload: v });
  };

  const currentAttr = state.pointAttributes[state.pointColorBy];
  const pointCount = currentAttr?.count;

  return (
    <div style={{
      position: 'absolute', top: 10, left: 10, zIndex: 100,
      background: 'rgba(20, 20, 40, 0.92)', color: '#ddd',
      borderRadius: 6, padding: '10px 14px',
      fontSize: 13, fontFamily: 'system-ui, sans-serif',
      minWidth: 220, backdropFilter: 'blur(8px)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
        Point Cloud
        {pointCount != null && (
          <span style={{ fontWeight: 400, color: '#999', marginLeft: 8, fontSize: 12 }}>
            {pointCount.toLocaleString()} pts
          </span>
        )}
      </div>

      {/* Color by dropdown */}
      <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 2 }}>
        Color by
      </label>
      <select
        value={state.pointColorBy}
        onChange={e => handleColorByChange(e.target.value)}
        style={{
          width: '100%', padding: '4px 6px', marginBottom: 8,
          background: '#2a2a4a', color: '#ddd', border: '1px solid #444',
          borderRadius: 3, fontSize: 12,
        }}
      >
        {numericAttrs.map(([name, info]) => (
          <option key={name} value={name}>
            {name}
            {info.min != null ? ` [${info.min.toFixed(2)}, ${info.max!.toFixed(2)}]` : ''}
          </option>
        ))}
      </select>

      {/* Vmin / Vmax */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: '#aaa' }}>Min</label>
          <input
            type="number"
            step="any"
            value={draftVmin}
            onChange={e => setDraftVmin(e.target.value)}
            onBlur={commitVmin}
            onKeyDown={e => e.key === 'Enter' && commitVmin()}
            style={{
              width: '100%', padding: '3px 5px',
              background: '#2a2a4a', color: '#ddd', border: '1px solid #444',
              borderRadius: 3, fontSize: 12,
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, color: '#aaa' }}>Max</label>
          <input
            type="number"
            step="any"
            value={draftVmax}
            onChange={e => setDraftVmax(e.target.value)}
            onBlur={commitVmax}
            onKeyDown={e => e.key === 'Enter' && commitVmax()}
            style={{
              width: '100%', padding: '3px 5px',
              background: '#2a2a4a', color: '#ddd', border: '1px solid #444',
              borderRadius: 3, fontSize: 12,
            }}
          />
        </div>
      </div>

      {/* Current attribute stats */}
      {currentAttr?.mean != null && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          mean: {currentAttr.mean.toFixed(3)}
        </div>
      )}
    </div>
  );
}
