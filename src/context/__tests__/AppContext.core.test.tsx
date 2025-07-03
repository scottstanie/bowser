import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useAppContext } from '../AppContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('AppContext - Core Functionality', () => {
  it('provides initial state correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    expect(result.current.state).toEqual({
      datasetInfo: {},
      timeSeriesPoints: [],
      refMarkerPosition: [0, 0],
      currentDataset: '',
      currentTimeIndex: 0,
      refValues: {},
      selectedBasemap: 'esriSatellite',
      dataMode: 'md',
      colormap: 'rdbu_r',
      vmin: 0,
      vmax: 1,
      opacity: 1,
      showChart: false,
      selectedPointId: null,
      showTrends: false,
    });
  });

  it('provides dispatch function', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });
    expect(typeof result.current.dispatch).toBe('function');
  });

  it('updates vmin correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_VMIN',
        payload: -2.5,
      });
    });

    expect(result.current.state.vmin).toBe(-2.5);
  });

  it('updates vmax correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_VMAX',
        payload: 3.0,
      });
    });

    expect(result.current.state.vmax).toBe(3.0);
  });

  it('updates colormap correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_COLORMAP',
        payload: 'viridis',
      });
    });

    expect(result.current.state.colormap).toBe('viridis');
  });

  it('updates opacity correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_OPACITY',
        payload: 0.7,
      });
    });

    expect(result.current.state.opacity).toBe(0.7);
  });

  it('toggles chart visibility', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    expect(result.current.state.showChart).toBe(false);

    act(() => {
      result.current.dispatch({ type: 'TOGGLE_CHART' });
    });

    expect(result.current.state.showChart).toBe(true);

    act(() => {
      result.current.dispatch({ type: 'TOGGLE_CHART' });
    });

    expect(result.current.state.showChart).toBe(false);
  });

  it('adds time series point correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'ADD_TIME_SERIES_POINT',
        payload: {
          position: [40.7128, -74.0060],
          name: 'Test Point',
        },
      });
    });

    const points = result.current.state.timeSeriesPoints;
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      name: 'Test Point',
      position: [40.7128, -74.0060],
      visible: true,
    });
    expect(points[0].id).toBeDefined();
    expect(points[0].color).toBeDefined();
  });

  it('removes time series point correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    // Add a point first
    act(() => {
      result.current.dispatch({
        type: 'ADD_TIME_SERIES_POINT',
        payload: { position: [40.7128, -74.0060] },
      });
    });

    const pointId = result.current.state.timeSeriesPoints[0].id;

    // Remove the point
    act(() => {
      result.current.dispatch({
        type: 'REMOVE_TIME_SERIES_POINT',
        payload: pointId,
      });
    });

    expect(result.current.state.timeSeriesPoints).toHaveLength(0);
  });

  it('updates time series point correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    // Add a point first
    act(() => {
      result.current.dispatch({
        type: 'ADD_TIME_SERIES_POINT',
        payload: { position: [40.7128, -74.0060], name: 'Original Name' },
      });
    });

    const pointId = result.current.state.timeSeriesPoints[0].id;

    // Update the point
    act(() => {
      result.current.dispatch({
        type: 'UPDATE_TIME_SERIES_POINT',
        payload: {
          id: pointId,
          updates: { name: 'Updated Name', visible: false },
        },
      });
    });

    const updatedPoint = result.current.state.timeSeriesPoints[0];
    expect(updatedPoint.name).toBe('Updated Name');
    expect(updatedPoint.visible).toBe(false);
  });

  it('sets current dataset correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_CURRENT_DATASET',
        payload: 'test-dataset',
      });
    });

    expect(result.current.state.currentDataset).toBe('test-dataset');
  });

  it('sets time index correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    act(() => {
      result.current.dispatch({
        type: 'SET_TIME_INDEX',
        payload: 5,
      });
    });

    expect(result.current.state.currentTimeIndex).toBe(5);
  });

  it('toggles trends correctly', () => {
    const { result } = renderHook(() => useAppContext(), { wrapper });

    expect(result.current.state.showTrends).toBe(false);

    act(() => {
      result.current.dispatch({ type: 'TOGGLE_TRENDS' });
    });

    expect(result.current.state.showTrends).toBe(true);
  });
});
