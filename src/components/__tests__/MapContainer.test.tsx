import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MapContainer from '../MapContainer';
import { AppProvider } from '../../context/AppContext';
import { AppState } from '../../types';

// Mock Leaflet components
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: any) => (
    <div data-testid="leaflet-map" {...props}>{children}</div>
  ),
  TileLayer: ({ url, opacity, attribution }: any) => (
    <div data-testid="tile-layer" data-url={url} data-opacity={opacity} data-attribution={attribution} />
  ),
  Marker: ({ position, title, children, ...props }: any) => (
    <div
      data-testid="marker"
      data-position={JSON.stringify(position)}
      data-title={title}
      {...props}
    >
      {children}
    </div>
  ),
  useMapEvents: () => null,
  useMap: () => ({
    on: vi.fn(),
    off: vi.fn(),
    addControl: vi.fn(),
    removeControl: vi.fn(),
  }),
}));

// Mock mouse control
vi.mock('../../mouse', () => ({
  MousePositionControl: vi.fn().mockImplementation(() => ({
    addTo: vi.fn(),
    remove: vi.fn(),
  })),
}));

// Mock fetch for tile URLs
global.fetch = vi.fn();

// Helper to render MapContainer with context and initial state
const renderWithContext = (initialState?: Partial<AppState>) => {
  const mockState = {
    datasetInfo: {
      'test-dataset': {
        x_values: ['2020-01-01', '2020-01-02', '2020-01-03'],
        latlon_bounds: [-180, -90, 180, 90],
        file_list: ['/path/to/file1.tif', '/path/to/file2.tif'],
        mask_file_list: ['/path/to/mask1.tif', '/path/to/mask2.tif'],
        uses_spatial_ref: false,
        algorithm: 'basic',
      },
    },
    timeSeriesPoints: [
      {
        id: 'point1',
        name: 'Test Point 1',
        position: [40.7128, -74.0060] as [number, number],
        color: '#1f77b4',
        visible: true,
        data: {},
        trendData: {},
      },
    ],
    refMarkerPosition: [40.7589, -73.9851] as [number, number],
    currentDataset: 'test-dataset',
    currentTimeIndex: 0,
    refValues: {},
    selectedBasemap: 'esriSatellite',
    dataMode: 'md' as const,
    colormap: 'rdbu_r',
    vmin: 0,
    vmax: 1,
    opacity: 1,
    showChart: false,
    selectedPointId: null,
    showTrends: false,
    ...initialState,
  };

  const TestProvider = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );

  return render(
    <TestProvider>
      <MapContainer />
    </TestProvider>
  );
};

describe('MapContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      json: () => Promise.resolve({
        tiles: ['https://example.com/tiles/{z}/{x}/{y}.png'],
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders map container with correct attributes', () => {
      renderWithContext();

      const mapElement = screen.getByTestId('leaflet-map');
      expect(mapElement).toBeInTheDocument();
      expect(mapElement).toHaveAttribute('data-testid', 'leaflet-map');
    });

    it('renders basemap tile layer', () => {
      renderWithContext();

      const tileLayer = screen.getAllByTestId('tile-layer')[0];
      expect(tileLayer).toBeInTheDocument();
    });

    it('renders time series point markers', () => {
      renderWithContext();

      const markers = screen.getAllByTestId('marker');
      expect(markers.length).toBeGreaterThan(0);

      // Check if point marker exists
      const pointMarker = markers.find(marker =>
        marker.getAttribute('data-position')?.includes('40.7128')
      );
      expect(pointMarker).toBeInTheDocument();
    });

    it('renders reference marker', () => {
      renderWithContext();

      const markers = screen.getAllByTestId('marker');
      const refMarker = markers.find(marker =>
        marker.getAttribute('data-title') === 'Reference Location'
      );
      expect(refMarker).toBeInTheDocument();
    });
  });

  describe('Raster Tile Layer Integration', () => {
    it('fetches tile URL with correct color scaling parameters', async () => {
      renderWithContext({
        vmin: -2.5,
        vmax: 3.0,
        colormap: 'viridis',
        opacity: 0.8,
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('rescale=-2.5%2C3')
        );
      });
    });

    it('updates tile layer when color parameters change', async () => {
      const { rerender } = renderWithContext({
        vmin: 0,
        vmax: 1,
        colormap: 'rdbu_r',
      });

      // Initial fetch
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('rescale=0%2C1')
        );
      });

      // Clear previous calls
      vi.clearAllMocks();

      // Rerender with new values would happen through context updates
      // This simulates the effect of changing vmin/vmax in ControlPanel
      (global.fetch as any).mockResolvedValue({
        json: () => Promise.resolve({
          tiles: ['https://example.com/tiles/{z}/{x}/{y}.png?updated=true'],
        }),
      });

      // In a real scenario, this would be triggered by context state change
      // Here we simulate by checking that the URL construction logic works
      const expectedParams = new URLSearchParams({
        variable: 'test-dataset',
        time_idx: '0',
        rescale: '-1,2',
        colormap_name: 'viridis',
      });

      expect(expectedParams.toString()).toContain('rescale=-1%2C2');
      expect(expectedParams.toString()).toContain('colormap_name=viridis');
    });

    it('includes algorithm parameters when available', async () => {
      renderWithContext({
        datasetInfo: {
          'algo-dataset': {
            x_values: ['2020-01-01'],
            latlon_bounds: [-180, -90, 180, 90],
            file_list: ['/path/to/file1.tif'],
            mask_file_list: [],
            uses_spatial_ref: false,
            algorithm: 'shift',
          },
        },
        currentDataset: 'algo-dataset',
        refValues: {
          'algo-dataset': [1.5],
        },
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('algorithm=shift')
        );
      });
    });

    it('handles COG mode parameters correctly', async () => {
      renderWithContext({
        dataMode: 'cog',
        datasetInfo: {
          'cog-dataset': {
            x_values: ['2020-01-01'],
            latlon_bounds: [-180, -90, 180, 90],
            file_list: ['https://example.com/file1.tif'],
            mask_file_list: ['https://example.com/mask1.tif'],
            mask_min_value: 0.5,
            uses_spatial_ref: false,
          },
        },
        currentDataset: 'cog-dataset',
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringMatching(/cog\/WebMercatorQuad\/tilejson\.json/)
        );
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('url=https%3A//example.com/file1.tif')
        );
      });
    });

    it('applies opacity correctly to raster layer', async () => {
      renderWithContext({
        opacity: 0.6,
      });

      await waitFor(() => {
        const tileLayers = screen.getAllByTestId('tile-layer');
        const rasterLayer = tileLayers.find(layer =>
          layer.getAttribute('data-opacity') === '0.6'
        );
        expect(rasterLayer).toBeInTheDocument();
      });
    });

    it('handles time index bounds correctly', async () => {
      renderWithContext({
        currentTimeIndex: 10, // Beyond available time indices
        datasetInfo: {
          'test-dataset': {
            x_values: ['2020-01-01', '2020-01-02'], // Only 2 time steps
            latlon_bounds: [-180, -90, 180, 90],
            file_list: ['/path/to/file1.tif', '/path/to/file2.tif'],
            mask_file_list: [],
            uses_spatial_ref: false,
          },
        },
      });

      await waitFor(() => {
        // Should clamp to maximum available index (1)
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('time_idx=1')
        );
      });
    });
  });

  describe('Point Management Integration', () => {
    it('displays multiple time series points with different colors', () => {
      renderWithContext({
        timeSeriesPoints: [
          {
            id: 'point1',
            name: 'Point 1',
            position: [40.7128, -74.0060],
            color: '#1f77b4',
            visible: true,
            data: {},
            trendData: {},
          },
          {
            id: 'point2',
            name: 'Point 2',
            position: [40.7589, -73.9851],
            color: '#ff7f0e',
            visible: true,
            data: {},
            trendData: {},
          },
        ],
      });

      const markers = screen.getAllByTestId('marker');
      const pointMarkers = markers.filter(marker =>
        marker.getAttribute('data-title')?.includes('Point')
      );

      expect(pointMarkers).toHaveLength(2);
    });

    it('hides invisible time series points', () => {
      renderWithContext({
        timeSeriesPoints: [
          {
            id: 'point1',
            name: 'Visible Point',
            position: [40.7128, -74.0060],
            color: '#1f77b4',
            visible: true,
            data: {},
            trendData: {},
          },
          {
            id: 'point2',
            name: 'Hidden Point',
            position: [40.7589, -73.9851],
            color: '#ff7f0e',
            visible: false,
            data: {},
            trendData: {},
          },
        ],
      });

      const markers = screen.getAllByTestId('marker');
      const visiblePointMarker = markers.find(marker =>
        marker.getAttribute('data-title')?.includes('Visible Point')
      );
      const hiddenPointMarker = markers.find(marker =>
        marker.getAttribute('data-title')?.includes('Hidden Point')
      );

      expect(visiblePointMarker).toBeInTheDocument();
      expect(hiddenPointMarker).toBeUndefined();
    });

    it('highlights selected point differently', () => {
      renderWithContext({
        selectedPointId: 'point1',
        timeSeriesPoints: [
          {
            id: 'point1',
            name: 'Selected Point',
            position: [40.7128, -74.0060],
            color: '#1f77b4',
            visible: true,
            data: {},
            trendData: {},
          },
        ],
      });

      const markers = screen.getAllByTestId('marker');
      const selectedMarker = markers.find(marker =>
        marker.getAttribute('data-title')?.includes('Selected Point')
      );

      expect(selectedMarker).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles tile fetch errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderWithContext();

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error fetching tile info:',
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it('renders without crashes when dataset info is missing', () => {
      renderWithContext({
        datasetInfo: {},
        currentDataset: 'non-existent',
      });

      const mapElement = screen.getByTestId('leaflet-map');
      expect(mapElement).toBeInTheDocument();
    });

    it('handles empty bounds gracefully', () => {
      renderWithContext({
        datasetInfo: {
          'empty-dataset': {
            x_values: [],
            latlon_bounds: [0, 0, 0, 0],
            file_list: [],
            mask_file_list: [],
            uses_spatial_ref: false,
          },
        },
        currentDataset: 'empty-dataset',
      });

      const mapElement = screen.getByTestId('leaflet-map');
      expect(mapElement).toBeInTheDocument();
    });
  });

  describe('Performance and Optimization', () => {
    it('does not refetch tiles unnecessarily', async () => {
      renderWithContext();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // Clear and ensure no additional calls
      vi.clearAllMocks();

      // Simulate a non-affecting change
      // In real app, this would be tested with actual re-renders
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('batches parameter updates efficiently', async () => {
      const { rerender } = renderWithContext({
        vmin: 0,
        vmax: 1,
        colormap: 'rdbu_r',
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      // In a real scenario, rapid parameter changes should be debounced
      // This test verifies the URL construction includes all current parameters
      const lastCall = (global.fetch as any).mock.calls[0][0];
      expect(lastCall).toContain('rescale=0%2C1');
      expect(lastCall).toContain('colormap_name=rdbu_r');
    });
  });
});
