import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { AppProvider } from '../context/AppContext';
import { AppState } from '../types';

// Custom render function that includes AppProvider
export const renderWithProvider = (
  ui: React.ReactElement,
  options?: RenderOptions
) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
};

// Helper to create mock time series point
export const createMockPoint = (overrides = {}) => ({
  id: `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Point',
  position: [40.7128, -74.0060] as [number, number],
  color: '#1f77b4',
  visible: true,
  data: {},
  trendData: {},
  ...overrides,
});

// Helper to create mock dataset info
export const createMockDataset = (overrides = {}) => ({
  name: 'test-dataset',
  x_values: ['2020-01-01', '2020-01-02', '2020-01-03'],
  latlon_bounds: [-180, -90, 180, 90] as [number, number, number, number],
  file_list: ['/file1.tif', '/file2.tif', '/file3.tif'],
  mask_file_list: [],
  mask_min_value: 0,
  nodata: null,
  uses_spatial_ref: false,
  algorithm: null,
  ...overrides,
});

// Helper to create mock app state
export const createMockAppState = (overrides: Partial<AppState> = {}): AppState => ({
  datasetInfo: {
    'test-dataset': createMockDataset(),
  },
  timeSeriesPoints: [],
  refMarkerPosition: [40.7589, -73.9851],
  currentDataset: 'test-dataset',
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
  ...overrides,
});

// Mock fetch response helpers
export const mockSuccessfulFetch = (data: any) => {
  return Promise.resolve({
    json: () => Promise.resolve(data),
  });
};

export const mockFailedFetch = (error: string) => {
  return Promise.reject(new Error(error));
};

// Helper to wait for async updates
export const waitForAsyncUpdates = () => new Promise(resolve => setTimeout(resolve, 0));

// Helper to create mock Chart.js data
export const createMockChartData = (overrides = {}) => ({
  labels: ['2020-01-01', '2020-01-02', '2020-01-03'],
  datasets: [
    {
      pointId: 'point1',
      label: 'Test Point',
      data: [0.1, 0.2, 0.3],
      borderColor: '#1f77b4',
      backgroundColor: '#1f77b4',
      trend: {
        slope: 0.1,
        intercept: 0,
        rSquared: 0.95,
        mmPerYear: 36.5,
      },
    },
  ],
  ...overrides,
});

// Helper to create mock API responses
export const createMockApiResponse = {
  multiPointTimeSeries: (pointCount = 1) => ({
    labels: ['2020-01-01', '2020-01-02', '2020-01-03'],
    datasets: Array.from({ length: pointCount }, (_, i) => ({
      pointId: `point${i + 1}`,
      label: `Point ${i + 1}`,
      data: [0.1 + i * 0.1, 0.2 + i * 0.1, 0.3 + i * 0.1],
      borderColor: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      backgroundColor: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
      trend: {
        slope: 0.1 + i * 0.05,
        intercept: i * 0.1,
        rSquared: 0.9 - i * 0.05,
        mmPerYear: (0.1 + i * 0.05) * 365.25,
      },
    })),
  }),

  pointTimeSeries: (length = 3) =>
    Array.from({ length }, (_, i) => 0.1 + i * 0.1),

  datasetInfo: (datasets: string[] = ['test-dataset']) =>
    datasets.reduce((acc, name) => ({
      ...acc,
      [name]: createMockDataset(),
    }), {}),

  tileInfo: () => ({
    tiles: ['https://example.com/tiles/{z}/{x}/{y}.png'],
  }),
};

// Helper to simulate user interactions
export const userInteractions = {
  changeInput: async (input: HTMLElement, value: string, user: any) => {
    await user.clear(input);
    await user.type(input, value);
  },

  selectOption: async (select: HTMLElement, value: string, user: any) => {
    await user.selectOptions(select, value);
  },

  clickButton: async (button: HTMLElement, user: any) => {
    await user.click(button);
  },
};

// Re-export commonly used testing library functions
export * from '@testing-library/react';
export { userEvent } from '@testing-library/user-event';
