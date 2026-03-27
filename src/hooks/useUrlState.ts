import { useEffect, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { AppAction } from '../types';

// Keys we serialize to URL
const URL_KEYS = [
  'colorBy', 'vmin', 'vmax', 'colormap', 'basemap', 'filter',
  'lat', 'lon', 'zoom', 'theme',
] as const;

/**
 * Parse URL search params into partial state overrides.
 * Called once on mount to restore a shared view.
 */
export function parseUrlState(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  const result: Record<string, string> = {};
  for (const key of URL_KEYS) {
    const val = params.get(key);
    if (val !== null) result[key] = val;
  }
  return result;
}

/**
 * Hook that syncs relevant app state to the URL search params.
 * Updates URL with history.replaceState (no page reload, no history spam).
 */
export function useUrlStateSync() {
  const { state } = useAppContext();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the first render — let parseUrlState handle initial load
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Read existing params (preserves lat/lon/zoom written by moveend)
    const params = new URLSearchParams(window.location.search);

    // Helper: set if non-default, delete if default
    const setOrDelete = (key: string, value: string, isDefault: boolean) => {
      if (isDefault) { params.delete(key); } else { params.set(key, value); }
    };

    // Point viz state
    setOrDelete('colorBy', state.pointColorBy, !state.pointColorBy || state.pointColorBy === 'velocity');
    setOrDelete('vmin', state.pointVmin.toFixed(2), state.pointVmin === -10);
    setOrDelete('vmax', state.pointVmax.toFixed(2), state.pointVmax === 10);
    setOrDelete('colormap', state.pointColormap, state.pointColormap === 'rdbu_r');
    setOrDelete('basemap', state.pointBasemap, state.pointBasemap === 'satellite');
    setOrDelete('filter', state.pointFilter, !state.pointFilter);
    setOrDelete('theme', state.chartTheme, state.chartTheme === 'dark');

    const search = params.toString();
    const url = search ? `?${search}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [
    state.pointColorBy, state.pointVmin, state.pointVmax,
    state.pointColormap, state.pointBasemap, state.pointFilter,
    state.chartTheme,
  ]);
}

/**
 * Apply URL params to the app state during initialization.
 * Call this after the default init in App.tsx.
 */
export function applyUrlState(
  dispatch: React.Dispatch<AppAction>,
  urlState: Record<string, string>,
) {
  if (urlState.colorBy) {
    dispatch({ type: 'SET_POINT_COLOR_BY', payload: urlState.colorBy });
  }
  if (urlState.vmin) {
    dispatch({ type: 'SET_POINT_VMIN', payload: parseFloat(urlState.vmin) });
  }
  if (urlState.vmax) {
    dispatch({ type: 'SET_POINT_VMAX', payload: parseFloat(urlState.vmax) });
  }
  if (urlState.colormap) {
    dispatch({ type: 'SET_POINT_COLORMAP', payload: urlState.colormap });
  }
  if (urlState.basemap) {
    dispatch({ type: 'SET_POINT_BASEMAP', payload: urlState.basemap as 'satellite' | 'osm' | 'dark' });
  }
  if (urlState.filter) {
    dispatch({ type: 'SET_POINT_FILTER', payload: urlState.filter });
  }
  if (urlState.theme === 'light') {
    dispatch({ type: 'SET_CHART_THEME', payload: 'light' });
  }
}
