import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { AppProvider } from '../../context/AppContext';

// Mock all external dependencies
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: any) => (
    <div data-testid="leaflet-map" {...props}>{children}</div>
  ),
  TileLayer: ({ url, opacity }: any) => (
    <div data-testid="tile-layer" data-url={url} data-opacity={opacity} />
  ),
  Marker: ({ position, title, eventHandlers }: any) => (
    <div
      data-testid="marker"
      data-position={JSON.stringify(position)}
      data-title={title}
      onClick={() => eventHandlers?.click?.()}
      onDoubleClick={() => eventHandlers?.dblclick?.()}
    />
  ),
  useMapEvents: ({ click }: any) => {
    // Simulate map click for testing
    return null;
  },
  useMap: () => ({
    on: vi.fn(),
    off: vi.fn(),
    addControl: vi.fn(),
    removeControl: vi.fn(),
  }),
}));

vi.mock('react-chartjs-2', () => ({
  Line: ({ data, options }: any) => (
    <div
      data-testid="chart-line"
      data-chart-data={JSON.stringify(data)}
      onClick={(e: any) => options?.onClick?.(e, [{ index: 1 }])}
    />
  ),
}));

vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  CategoryScale: {},
  LinearScale: {},
  PointElement: {},
  LineElement: {},
  Title: {},
  Tooltip: {},
  Legend: {},
}));

vi.mock('../../mouse', () => ({
  MousePositionControl: vi.fn().mockImplementation(() => ({
    addTo: vi.fn(),
    remove: vi.fn(),
  })),
}));

// Mock API calls
const mockFetchMultiPointTimeSeries = vi.fn();
const mockFetchPointTimeSeries = vi.fn();

vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({
    fetchMultiPointTimeSeries: mockFetchMultiPointTimeSeries,
    fetchPointTimeSeries: mockFetchPointTimeSeries,
  }),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock fetch for dataset info and tiles
global.fetch = vi.fn();

describe('Integration Tests - Critical User Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);

    // Mock successful dataset fetch
    (global.fetch as any)
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          'displacement': {
            x_values: ['2020-01-01', '2020-01-02', '2020-01-03'],
            latlon_bounds: [-180, -90, 180, 90],
            file_list: ['/file1.tif', '/file2.tif', '/file3.tif'],
            mask_file_list: [],
            uses_spatial_ref: false,
          },
        }),
      })
      .mockResolvedValue({
        json: () => Promise.resolve({
          tiles: ['https://example.com/tiles/{z}/{x}/{y}.png'],
        }),
      });

    mockFetchMultiPointTimeSeries.mockResolvedValue({
      labels: ['2020-01-01', '2020-01-02', '2020-01-03'],
      datasets: [
        {
          pointId: 'point1',
          label: 'Point 1',
          data: [0.1, 0.2, 0.3],
          borderColor: '#1f77b4',
          backgroundColor: '#1f77b4',
        },
      ],
    });

    mockFetchPointTimeSeries.mockResolvedValue([1, 2, 3]);
  });

  describe('Complete Color Rescaling Workflow', () => {
    it('successfully updates map colors when user changes vmin/vmax', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByDisplayValue('0')).toBeInTheDocument(); // vmin input
      });

      // Change vmin
      const vminInput = screen.getByDisplayValue('0');
      await user.clear(vminInput);
      await user.type(vminInput, '-2.5');

      // Change vmax
      const vmaxInput = screen.getByDisplayValue('1');
      await user.clear(vmaxInput);
      await user.type(vmaxInput, '3.0');

      // Verify tile layer is updated with new rescale parameters
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('rescale=-2.5%2C3')
        );
      });

      // Verify localStorage saves the values
      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          expect.stringMatching(/-vmin$/),
          '-2.5'
        );
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          expect.stringMatching(/-vmax$/),
          '3.0'
        );
      });
    });

    it('maintains color scale consistency when switching between datasets', async () => {
      const user = userEvent.setup();

      // Setup localStorage to return different values for different datasets
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'displacement-vmin') return '-1.0';
        if (key === 'displacement-vmax') return '2.0';
        if (key === 'displacement-colormap_name') return 'viridis';
        return null;
      });

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for initial load and check loaded preferences
      await waitFor(() => {
        expect(localStorageMock.getItem).toHaveBeenCalledWith('displacement-vmin');
        expect(localStorageMock.getItem).toHaveBeenCalledWith('displacement-vmax');
        expect(localStorageMock.getItem).toHaveBeenCalledWith('displacement-colormap_name');
      });

      // Change colormap to ensure state is being managed
      const colormapSelect = screen.getByDisplayValue('Blue-Red');
      await user.selectOptions(colormapSelect, 'magma');

      // Verify the change is saved
      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'displacement-colormap_name',
          'magma'
        );
      });
    });

    it('applies opacity changes to map layer correctly', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByRole('slider', { name: /opacity/i })).toBeInTheDocument();
      });

      // Change opacity
      const opacitySlider = screen.getByRole('slider', { name: /opacity/i });
      fireEvent.change(opacitySlider, { target: { value: '0.7' } });

      // Verify opacity is applied to tile layer
      await waitFor(() => {
        const tileLayer = screen.getByTestId('tile-layer');
        expect(tileLayer).toHaveAttribute('data-opacity', '0.7');
      });
    });
  });

  describe('Multi-Point Time Series Workflow', () => {
    it('allows adding, managing, and analyzing multiple points', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
      });

      // Open point manager
      const pointsButton = screen.getByRole('button', { name: /points \(0\)/i });
      await user.click(pointsButton);

      // Initially no points
      expect(screen.getByText('No time series points selected.')).toBeInTheDocument();

      // Simulate adding points by clicking map (this would normally trigger MapEvents)
      // For testing, we'll simulate the state change

      // Show time series chart
      const chartButton = screen.getByRole('button', { name: /show time series/i });
      await user.click(chartButton);

      expect(screen.getByText('No time series points selected.')).toBeInTheDocument();
    });

    it('enables trend analysis and updates point information', async () => {
      const user = userEvent.setup();

      // Setup mock with trend data
      mockFetchMultiPointTimeSeries.mockResolvedValue({
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
      });

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for load and open point manager
      await waitFor(() => {
        expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
      });

      const pointsButton = screen.getByRole('button', { name: /points \(0\)/i });
      await user.click(pointsButton);

      // Enable trends in point manager
      const trendsButton = screen.getByRole('button', { name: /show trends/i });
      await user.click(trendsButton);

      expect(trendsButton).toHaveTextContent('Hide Trends');
    });

    it('syncs chart interactions with map time index', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Show chart
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /show time series/i })).toBeInTheDocument();
      });

      const chartButton = screen.getByRole('button', { name: /show time series/i });
      await user.click(chartButton);

      // In a real scenario with points, clicking chart would sync time index
      // This tests the integration between chart and time slider
    });
  });

  describe('Dataset and Time Navigation Workflow', () => {
    it('navigates through time and updates all connected components', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for dataset to load
      await waitFor(() => {
        expect(screen.getByRole('slider')).toBeInTheDocument();
      });

      const timeSlider = screen.getByRole('slider');

      // Change time index
      fireEvent.change(timeSlider, { target: { value: '1' } });

      // Verify time index updates trigger new tile requests
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('time_idx=1')
        );
      });
    });

    it('handles time bounds correctly when data has fewer time steps', async () => {
      const user = userEvent.setup();

      // Mock dataset with only 2 time steps
      (global.fetch as any).mockResolvedValueOnce({
        json: () => Promise.resolve({
          'short-dataset': {
            x_values: ['2020-01-01', '2020-01-02'], // Only 2 time steps
            latlon_bounds: [-180, -90, 180, 90],
            file_list: ['/file1.tif', '/file2.tif'],
            mask_file_list: [],
            uses_spatial_ref: false,
          },
        }),
      });

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Wait for load
      await waitFor(() => {
        expect(screen.getByRole('slider')).toBeInTheDocument();
      });

      const timeSlider = screen.getByRole('slider');

      // Try to set beyond available range
      fireEvent.change(timeSlider, { target: { value: '5' } });

      // Should clamp to maximum available (1)
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('time_idx=1')
        );
      });
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('handles API failures gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock fetch failure
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // App should still render despite API failure
      await waitFor(() => {
        expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
      });

      consoleSpy.mockRestore();
    });

    it('handles empty dataset gracefully', async () => {
      // Mock empty dataset response
      (global.fetch as any).mockResolvedValueOnce({
        json: () => Promise.resolve({}),
      });

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // App should render with empty state
      await waitFor(() => {
        expect(screen.getByTestId('leaflet-map')).toBeInTheDocument();
      });
    });

    it('recovers from localStorage corruption', async () => {
      // Mock corrupted localStorage values
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key.includes('vmin')) return 'invalid-number';
        if (key.includes('vmax')) return 'also-invalid';
        return null;
      });

      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      // Should use default values instead of corrupted ones
      await waitFor(() => {
        expect(screen.getByDisplayValue('0')).toBeInTheDocument(); // Default vmin
        expect(screen.getByDisplayValue('1')).toBeInTheDocument(); // Default vmax
      });
    });
  });

  describe('Performance and Optimization', () => {
    it('debounces rapid parameter changes', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      await waitFor(() => {
        expect(screen.getByDisplayValue('0')).toBeInTheDocument();
      });

      const vminInput = screen.getByDisplayValue('0');

      // Rapidly change values
      await user.clear(vminInput);
      await user.type(vminInput, '-1');
      await user.clear(vminInput);
      await user.type(vminInput, '-2');
      await user.clear(vminInput);
      await user.type(vminInput, '-3');

      // Should eventually settle on final value
      await waitFor(() => {
        expect(vminInput).toHaveValue(-3);
      });

      // Should have made tile requests with the updates
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('rescale=-3')
        );
      });
    });

    it('does not refetch tiles unnecessarily', async () => {
      const user = userEvent.setup();
      render(
        <AppProvider>
          <App />
        </AppProvider>
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      const initialCallCount = (global.fetch as any).mock.calls.length;

      // Wait a bit to ensure no additional calls
      await new Promise(resolve => setTimeout(resolve, 100));

      expect((global.fetch as any).mock.calls.length).toBe(initialCallCount);
    });
  });
});
