import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AppProvider, useAppContext } from '../AppContext';
import { AppAction } from '../../types';

// Wrapper component for testing hooks
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AppProvider>{children}</AppProvider>
);

describe('AppContext', () => {
  describe('Initial State', () => {
    it('provides correct initial state', () => {
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
  });

  describe('Dataset Management', () => {
    it('sets dataset info', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      const mockDatasets = {
        'test-dataset': {
          x_values: ['2020-01-01', '2020-01-02'],
          latlon_bounds: [-180, -90, 180, 90] as [number, number, number, number],
          file_list: [],
          mask_file_list: [],
          uses_spatial_ref: false,
        },
      };

      act(() => {
        result.current.dispatch({
          type: 'SET_DATASETS',
          payload: mockDatasets,
        });
      });

      expect(result.current.state.datasetInfo).toEqual(mockDatasets);
    });

    it('sets current dataset', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_CURRENT_DATASET',
          payload: 'new-dataset',
        });
      });

      expect(result.current.state.currentDataset).toBe('new-dataset');
    });

    it('sets time index', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_TIME_INDEX',
          payload: 5,
        });
      });

      expect(result.current.state.currentTimeIndex).toBe(5);
    });
  });

  describe('Time Series Points Management', () => {
    it('adds new time series point with correct properties', () => {
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
        data: {},
        trendData: {},
      });
      expect(points[0].id).toBeDefined();
      expect(points[0].color).toBeDefined();
      expect(result.current.state.selectedPointId).toBe(points[0].id);
    });

    it('assigns unique colors to multiple points', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add multiple points
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.7128, -74.0060] },
        });
      });

      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.7589, -73.9851] },
        });
      });

      const points = result.current.state.timeSeriesPoints;
      expect(points).toHaveLength(2);
      expect(points[0].color).not.toBe(points[1].color);
    });

    it('removes time series point', () => {
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
      expect(result.current.state.selectedPointId).toBeNull();
    });

    it('updates time series point properties', () => {
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

    it('sets point data correctly', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add a point first
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.7128, -74.0060] },
        });
      });

      const pointId = result.current.state.timeSeriesPoints[0].id;
      const mockData = [1, 2, 3, 4, 5];

      // Set point data
      act(() => {
        result.current.dispatch({
          type: 'SET_POINT_DATA',
          payload: {
            pointId,
            dataset: 'test-dataset',
            data: mockData,
          },
        });
      });

      const point = result.current.state.timeSeriesPoints[0];
      expect(point.data['test-dataset']).toEqual(mockData);
    });

    it('sets point trend data correctly', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add a point first
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.7128, -74.0060] },
        });
      });

      const pointId = result.current.state.timeSeriesPoints[0].id;
      const mockTrend = {
        slope: 0.1,
        intercept: 0.5,
        rSquared: 0.85,
        mmPerYear: 36.5,
      };

      // Set trend data
      act(() => {
        result.current.dispatch({
          type: 'SET_POINT_TREND_DATA',
          payload: {
            pointId,
            dataset: 'test-dataset',
            trend: mockTrend,
          },
        });
      });

      const point = result.current.state.timeSeriesPoints[0];
      expect(point.trendData['test-dataset']).toEqual(mockTrend);
    });

    it('sets selected point', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add a point first
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.7128, -74.0060] },
        });
      });

      const pointId = result.current.state.timeSeriesPoints[0].id;

      // Deselect first
      act(() => {
        result.current.dispatch({
          type: 'SET_SELECTED_POINT',
          payload: null,
        });
      });

      expect(result.current.state.selectedPointId).toBeNull();

      // Select the point
      act(() => {
        result.current.dispatch({
          type: 'SET_SELECTED_POINT',
          payload: pointId,
        });
      });

      expect(result.current.state.selectedPointId).toBe(pointId);
    });
  });

  describe('Color and Visualization Settings', () => {
    it('sets colormap', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_COLORMAP',
          payload: 'viridis',
        });
      });

      expect(result.current.state.colormap).toBe('viridis');
    });

    it('sets vmin and vmax', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_VMIN',
          payload: -2.5,
        });
      });

      act(() => {
        result.current.dispatch({
          type: 'SET_VMAX',
          payload: 3.0,
        });
      });

      expect(result.current.state.vmin).toBe(-2.5);
      expect(result.current.state.vmax).toBe(3.0);
    });

    it('sets opacity', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_OPACITY',
          payload: 0.7,
        });
      });

      expect(result.current.state.opacity).toBe(0.7);
    });

    it('sets basemap', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      act(() => {
        result.current.dispatch({
          type: 'SET_BASEMAP',
          payload: 'osm',
        });
      });

      expect(result.current.state.selectedBasemap).toBe('osm');
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

    it('toggles trends display', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      expect(result.current.state.showTrends).toBe(false);

      act(() => {
        result.current.dispatch({ type: 'TOGGLE_TRENDS' });
      });

      expect(result.current.state.showTrends).toBe(true);

      act(() => {
        result.current.dispatch({ type: 'TOGGLE_TRENDS' });
      });

      expect(result.current.state.showTrends).toBe(false);
    });
  });

  describe('Reference Values and Markers', () => {
    it('sets reference marker position', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      const newPosition: [number, number] = [41.0, -75.0];

      act(() => {
        result.current.dispatch({
          type: 'SET_REF_MARKER_POSITION',
          payload: newPosition,
        });
      });

      expect(result.current.state.refMarkerPosition).toEqual(newPosition);
    });

    it('sets reference values for dataset', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      const mockValues = [1.0, 1.5, 2.0];

      act(() => {
        result.current.dispatch({
          type: 'SET_REF_VALUES',
          payload: {
            dataset: 'test-dataset',
            values: mockValues,
          },
        });
      });

      expect(result.current.state.refValues['test-dataset']).toEqual(mockValues);
    });
  });

  describe('Legacy Compatibility', () => {
    it('handles legacy single point markers', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      const legacyPosition: [number, number] = [40.7128, -74.0060];

      act(() => {
        result.current.dispatch({
          type: 'SET_TS_MARKER_POSITION',
          payload: legacyPosition,
        });
      });

      const points = result.current.state.timeSeriesPoints;
      expect(points).toHaveLength(1);
      expect(points[0].name).toBe('Legacy Point');
      expect(points[0].position).toEqual(legacyPosition);
    });

    it('updates existing legacy point when position changes', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add legacy point first
      act(() => {
        result.current.dispatch({
          type: 'SET_TS_MARKER_POSITION',
          payload: [40.7128, -74.0060],
        });
      });

      const originalPointId = result.current.state.timeSeriesPoints[0].id;

      // Update position
      act(() => {
        result.current.dispatch({
          type: 'SET_TS_MARKER_POSITION',
          payload: [41.0, -75.0],
        });
      });

      const points = result.current.state.timeSeriesPoints;
      expect(points).toHaveLength(1); // Should still be one point
      expect(points[0].id).toBe(originalPointId); // Same point
      expect(points[0].position).toEqual([41.0, -75.0]); // Updated position
    });
  });

  describe('Error Handling', () => {
    it('throws error when used outside provider', () => {
      // Wrap in a try-catch to handle console errors properly
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useAppContext());
      }).toThrow('useAppContext must be used within an AppProvider');

      consoleSpy.mockRestore();
    });

    it('handles unknown action types gracefully', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      const initialState = result.current.state;

      act(() => {
        result.current.dispatch({
          type: 'UNKNOWN_ACTION' as any,
          payload: 'test',
        });
      });

      // State should remain unchanged
      expect(result.current.state).toEqual(initialState);
    });
  });

  describe('Color Assignment Logic', () => {
    it('cycles through available colors', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add 12 points to test color cycling (palette has 10 colors)
      for (let i = 0; i < 12; i++) {
        act(() => {
          result.current.dispatch({
            type: 'ADD_TIME_SERIES_POINT',
            payload: { position: [40 + i * 0.1, -74 + i * 0.1] },
          });
        });
      }

      const points = result.current.state.timeSeriesPoints;
      expect(points).toHaveLength(12);

      // Colors should cycle when exceeding palette size
      expect(points[0].color).toBe(points[10].color);
    });

    it('reuses colors when points are removed', () => {
      const { result } = renderHook(() => useAppContext(), { wrapper });

      // Add three points
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.0, -74.0] },
        });
      });

      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.1, -74.1] },
        });
      });

      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.2, -74.2] },
        });
      });

      const firstPointColor = result.current.state.timeSeriesPoints[0].color;
      const firstPointId = result.current.state.timeSeriesPoints[0].id;

      // Remove first point
      act(() => {
        result.current.dispatch({
          type: 'REMOVE_TIME_SERIES_POINT',
          payload: firstPointId,
        });
      });

      // Add another point - should reuse the first color
      act(() => {
        result.current.dispatch({
          type: 'ADD_TIME_SERIES_POINT',
          payload: { position: [40.3, -74.3] },
        });
      });

      const newPoints = result.current.state.timeSeriesPoints;
      const newPointColor = newPoints[newPoints.length - 1].color;
      expect(newPointColor).toBe(firstPointColor);
    });
  });
});
