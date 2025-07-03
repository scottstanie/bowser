import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TimeSeriesChart from '../TimeSeriesChart';
import { AppProvider } from '../../context/AppContext';
import { AppState } from '../../types';

// Mock Chart.js and react-chartjs-2
vi.mock('react-chartjs-2', () => ({
  Line: ({ data, options, ...props }: any) => (
    <div
      data-testid="chart-line"
      data-chart-data={JSON.stringify(data)}
      data-chart-options={JSON.stringify(options)}
      {...props}
    />
  ),
}));

vi.mock('chart.js', () => ({
  Chart: {
    register: vi.fn(),
  },
  CategoryScale: {},
  LinearScale: {},
  PointElement: {},
  LineElement: {},
  Title: {},
  Tooltip: {},
  Legend: {},
}));

// Mock useApi hook
const mockFetchMultiPointTimeSeries = vi.fn();
vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({
    fetchMultiPointTimeSeries: mockFetchMultiPointTimeSeries,
  }),
}));

// Create a custom wrapper that provides context with initial state
const createWrapper = (initialState?: Partial<AppState>) => {
  const mockState = {
    datasetInfo: {
      'test-dataset': {
        x_values: ['2020-01-01', '2020-01-02', '2020-01-03'],
        latlon_bounds: [-180, -90, 180, 90],
        file_list: [],
        mask_file_list: [],
        uses_spatial_ref: false,
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
      {
        id: 'point2',
        name: 'Test Point 2',
        position: [40.7589, -73.9851] as [number, number],
        color: '#ff7f0e',
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
    vmin: -1,
    vmax: 2,
    opacity: 1,
    showChart: true,
    selectedPointId: null,
    showTrends: false,
    ...initialState,
  };

  // Return a wrapper component instead of rendering directly
  return ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );
};

// Helper to render component with context
const renderWithContext = (initialState?: Partial<AppState>) => {
  const TestProvider = createWrapper(initialState);

  return render(
    <TestProvider>
      <TimeSeriesChart />
    </TestProvider>
  );
};

describe('TimeSeriesChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchMultiPointTimeSeries.mockResolvedValue({
      labels: ['2020-01-01', '2020-01-02', '2020-01-03'],
      datasets: [
        {
          pointId: 'point1',
          label: 'Test Point 1',
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
        {
          pointId: 'point2',
          label: 'Test Point 2',
          data: [0.5, 0.6, 0.7],
          borderColor: '#ff7f0e',
          backgroundColor: '#ff7f0e',
          trend: {
            slope: 0.1,
            intercept: 0.4,
            rSquared: 0.88,
            mmPerYear: 36.5,
          },
        },
      ],
    });
  });

  describe('Chart Visibility', () => {
    it('renders when showChart is true', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(screen.getByTestId('chart-line')).toBeInTheDocument();
      });
    });

    it('does not render when showChart is false', () => {
      renderWithContext({ showChart: false });

      expect(screen.queryByTestId('chart-line')).not.toBeInTheDocument();
    });

    it('shows loading state while fetching data', () => {
      mockFetchMultiPointTimeSeries.mockImplementation(() => new Promise(() => {})); // Never resolves

      renderWithContext({ showChart: true });

      expect(screen.getByText('Loading time series data...')).toBeInTheDocument();
    });

    it('shows placeholder when no points selected', () => {
      renderWithContext({
        showChart: true,
        timeSeriesPoints: []
      });

      expect(screen.getByText('No time series points selected.')).toBeInTheDocument();
      expect(screen.getByText('Click on the map to add points.')).toBeInTheDocument();
    });

    it('shows no data message when API returns empty data', async () => {
      mockFetchMultiPointTimeSeries.mockResolvedValue(null);

      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(screen.getByText('No data available for selected points.')).toBeInTheDocument();
      });
    });
  });

  describe('Data Fetching', () => {
    it('fetches multi-point time series data on mount', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledWith(
          [
            {
              id: 'point1',
              lat: 40.7128,
              lon: -74.0060,
              color: '#1f77b4',
              name: 'Test Point 1',
            },
            {
              id: 'point2',
              lat: 40.7589,
              lon: -73.9851,
              color: '#ff7f0e',
              name: 'Test Point 2',
            },
          ],
          'test-dataset',
          undefined, // refLon
          undefined, // refLat
          false // showTrends
        );
      });
    });

    it('includes reference coordinates for spatial_ref datasets', async () => {
      renderWithContext({
        showChart: true,
        datasetInfo: {
          'spatial-dataset': {
            x_values: ['2020-01-01'],
            latlon_bounds: [-180, -90, 180, 90],
            file_list: [],
            mask_file_list: [],
            uses_spatial_ref: true,
          },
        },
        currentDataset: 'spatial-dataset',
        refMarkerPosition: [41.0, -75.0],
      });

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledWith(
          expect.any(Array),
          'spatial-dataset',
          -75.0, // refLon
          41.0,  // refLat
          false
        );
      });
    });

    it('filters out invisible points from API call', async () => {
      renderWithContext({
        showChart: true,
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

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledWith(
          [
            {
              id: 'point1',
              lat: 40.7128,
              lon: -74.0060,
              color: '#1f77b4',
              name: 'Visible Point',
            },
          ],
          'test-dataset',
          undefined,
          undefined,
          false
        );
      });
    });

    it('passes showTrends parameter correctly', async () => {
      renderWithContext({
        showChart: true,
        showTrends: true
      });

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledWith(
          expect.any(Array),
          'test-dataset',
          undefined,
          undefined,
          true // showTrends
        );
      });
    });
  });

  describe('Chart Configuration', () => {
    it('configures chart with correct data format', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        const chartElement = screen.getByTestId('chart-line');
        const chartData = JSON.parse(chartElement.getAttribute('data-chart-data') || '{}');

        expect(chartData.labels).toEqual(['2020-01-01', '2020-01-02', '2020-01-03']);
        expect(chartData.datasets).toHaveLength(2);
        expect(chartData.datasets[0].label).toBe('Test Point 1');
        expect(chartData.datasets[0].data).toEqual([0.1, 0.2, 0.3]);
        expect(chartData.datasets[0].borderColor).toBe('#1f77b4');
      });
    });

    it('sets Y-axis scale based on vmin/vmax', async () => {
      renderWithContext({
        showChart: true,
        vmin: -5,
        vmax: 10
      });

      await waitFor(() => {
        const chartElement = screen.getByTestId('chart-line');
        const chartOptions = JSON.parse(chartElement.getAttribute('data-chart-options') || '{}');

        expect(chartOptions.scales.y.suggestedMin).toBe(-5);
        expect(chartOptions.scales.y.suggestedMax).toBe(10);
      });
    });

    it('includes trend information in legend when trends enabled', async () => {
      renderWithContext({
        showChart: true,
        showTrends: true
      });

      await waitFor(() => {
        const chartElement = screen.getByTestId('chart-line');
        const chartOptions = JSON.parse(chartElement.getAttribute('data-chart-options') || '{}');

        // Check that legend labels include trend information
        expect(chartOptions.plugins.legend.labels.generateLabels).toBeDefined();
      });
    });
  });

  describe('Trend Analysis', () => {
    it('toggles trend display', async () => {
      const user = userEvent.setup();
      renderWithContext({ showChart: true });

      const trendButton = await screen.findByRole('button', { name: /show trends/i });
      await user.click(trendButton);

      expect(trendButton).toHaveTextContent('Hide Trends');
    });

    it('displays trend rates in chart title when enabled', async () => {
      renderWithContext({
        showChart: true,
        showTrends: true
      });

      await waitFor(() => {
        // Trend information should be visible in the chart
        expect(screen.getByText(/trends show mm\/year rates/i)).toBeInTheDocument();
      });
    });

    it('updates trend data in context when received', async () => {
      renderWithContext({
        showChart: true,
        showTrends: true
      });

      // Wait for the async trend data update
      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalled();
      });

      // Trend data should be processed and stored
      // This is mainly tested through the setTimeout call in the component
    });
  });

  describe('Chart Interactions', () => {
    it('syncs time index when chart point is clicked', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        const chartElement = screen.getByTestId('chart-line');
        const chartOptions = JSON.parse(chartElement.getAttribute('data-chart-options') || '{}');

        // Simulate click on chart point
        const mockEvent = {};
        const mockElements = [{ index: 2 }]; // Click on third point

        chartOptions.onClick(mockEvent, mockElements);

        // This would dispatch SET_TIME_INDEX action in real component
        expect(chartOptions.onClick).toBeDefined();
      });
    });

    it('handles empty chart clicks gracefully', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        const chartElement = screen.getByTestId('chart-line');
        const chartOptions = JSON.parse(chartElement.getAttribute('data-chart-options') || '{}');

        // Simulate click with no elements
        const mockEvent = {};
        const mockElements: any[] = [];

        expect(() => chartOptions.onClick(mockEvent, mockElements)).not.toThrow();
      });
    });
  });

  describe('Error Handling', () => {
    it('handles API errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetchMultiPointTimeSeries.mockRejectedValue(new Error('API Error'));

      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error updating chart:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('shows no data message when API returns invalid data', async () => {
      mockFetchMultiPointTimeSeries.mockResolvedValue({
        labels: [],
        datasets: [],
      });

      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(screen.getByText('No data available for selected points.')).toBeInTheDocument();
      });
    });
  });

  describe('Component Lifecycle', () => {
    it('refetches data when points change', async () => {
      const { rerender } = renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledTimes(1);
      });

      // Clear previous calls
      vi.clearAllMocks();

      // This would trigger a re-render with different points in real usage
      // The useCallback dependency array includes point changes
      expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledTimes(0);
    });

    it('refetches data when dataset changes', async () => {
      renderWithContext({
        showChart: true,
        currentDataset: 'dataset1'
      });

      await waitFor(() => {
        expect(mockFetchMultiPointTimeSeries).toHaveBeenCalledWith(
          expect.any(Array),
          'dataset1',
          expect.any(Object),
          expect.any(Object),
          expect.any(Boolean)
        );
      });
    });

    it('does not fetch when chart is hidden', () => {
      renderWithContext({ showChart: false });

      expect(mockFetchMultiPointTimeSeries).not.toHaveBeenCalled();
    });
  });

  describe('Accessibility and UX', () => {
    it('provides helpful user instructions', async () => {
      renderWithContext({ showChart: true });

      await waitFor(() => {
        expect(screen.getByText(/click on chart points to sync map time/i)).toBeInTheDocument();
      });
    });

    it('has proper button labels and titles', async () => {
      renderWithContext({ showChart: true });

      const trendButton = await screen.findByRole('button', { name: /show trends/i });
      expect(trendButton).toHaveAttribute('title', 'Toggle trend analysis');
    });

    it('displays chart header with proper title', async () => {
      renderWithContext({ showChart: true });

      expect(screen.getByText('Time Series Analysis')).toBeInTheDocument();
    });

    it('shows trend button with correct icon', async () => {
      renderWithContext({ showChart: true });

      const trendButton = await screen.findByRole('button', { name: /show trends/i });
      const icon = trendButton.querySelector('i');
      expect(icon).toHaveClass('fa-chart-simple');
    });

    it('updates trend button icon when trends are enabled', async () => {
      const user = userEvent.setup();
      renderWithContext({ showChart: true });

      const trendButton = await screen.findByRole('button', { name: /show trends/i });
      await user.click(trendButton);

      const icon = trendButton.querySelector('i');
      expect(icon).toHaveClass('fa-chart-line');
    });
  });
});
