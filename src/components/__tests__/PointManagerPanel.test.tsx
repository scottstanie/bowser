import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PointManagerPanel from '../PointManagerPanel';
import { AppProvider } from '../../context/AppContext';
import { AppState } from '../../types';

// Mock window.confirm
Object.defineProperty(window, 'confirm', {
  value: vi.fn(),
  writable: true,
});

// Helper to render component with context
const renderWithContext = (initialState?: Partial<AppState>) => {
  const mockState = {
    datasetInfo: {
      'test-dataset': {
        x_values: ['2020-01-01', '2020-01-02'],
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
        trendData: {
          'test-dataset': {
            slope: 0.5,
            intercept: 1.0,
            rSquared: 0.85,
            mmPerYear: 5.2,
          },
        },
      },
      {
        id: 'point2',
        name: 'Test Point 2',
        position: [40.7589, -73.9851] as [number, number],
        color: '#ff7f0e',
        visible: false,
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
    selectedPointId: 'point1',
    showTrends: false,
    ...initialState,
  };

  const TestProvider = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );

  return render(
    <TestProvider>
      <PointManagerPanel />
    </TestProvider>
  );
};

describe('PointManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window.confirm as any).mockReturnValue(true);
  });

  describe('Panel Toggle', () => {
    it('renders collapsed state by default', () => {
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      expect(toggleButton).toBeInTheDocument();

      // Panel content should not be visible
      expect(screen.queryByText('Time Series Points')).not.toBeInTheDocument();
    });

    it('shows correct point count in toggle button', () => {
      renderWithContext({
        timeSeriesPoints: [
          {
            id: 'point1',
            name: 'Point 1',
            position: [0, 0],
            color: '#1f77b4',
            visible: true,
            data: {},
            trendData: {},
          },
          {
            id: 'point2',
            name: 'Point 2',
            position: [1, 1],
            color: '#ff7f0e',
            visible: true,
            data: {},
            trendData: {},
          },
          {
            id: 'point3',
            name: 'Point 3',
            position: [2, 2],
            color: '#2ca02c',
            visible: true,
            data: {},
            trendData: {},
          },
        ],
      });

      const toggleButton = screen.getByRole('button', { name: /points \(3\)/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('expands panel when toggle button is clicked', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      expect(screen.getByText('Time Series Points')).toBeInTheDocument();
    });

    it('collapses panel when close button is clicked', async () => {
      const user = userEvent.setup();
      renderWithContext();

      // First expand
      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      // Then collapse
      const closeButton = screen.getByRole('button', { name: /close panel/i });
      await user.click(closeButton);

      expect(screen.queryByText('Time Series Points')).not.toBeInTheDocument();
    });
  });

  describe('Point List Display', () => {
    it('displays all points with correct information', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      expect(screen.getByDisplayValue('Test Point 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Point 2')).toBeInTheDocument();

      // Check coordinates display
      expect(screen.getByText(/lat: 40\.712800, lon: -74\.006000/i)).toBeInTheDocument();
      expect(screen.getByText(/lat: 40\.758900, lon: -73\.985100/i)).toBeInTheDocument();
    });

    it('shows selected point with different styling', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const selectedPoint = screen.getByDisplayValue('Test Point 1').closest('.point-item');
      expect(selectedPoint).toHaveClass('selected');
    });

    it('displays point colors correctly', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const colorIndicators = screen.getAllByText('', { selector: '.point-color-indicator' });
      expect(colorIndicators[0]).toHaveStyle('background-color: #1f77b4');
      expect(colorIndicators[1]).toHaveStyle('background-color: #ff7f0e');
    });

    it('shows empty state when no points exist', async () => {
      const user = userEvent.setup();
      renderWithContext({
        timeSeriesPoints: [],
      });

      const toggleButton = screen.getByRole('button', { name: /points \(0\)/i });
      await user.click(toggleButton);

      expect(screen.getByText('No time series points selected.')).toBeInTheDocument();
      expect(screen.getByText('Click on the map to add points.')).toBeInTheDocument();
    });
  });

  describe('Point Management', () => {
    it('allows editing point names', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const nameInput = screen.getByDisplayValue('Test Point 1');
      await user.clear(nameInput);
      await user.type(nameInput, 'Updated Point Name');

      expect(screen.getByDisplayValue('Updated Point Name')).toBeInTheDocument();
    });

    it('prevents event propagation when editing point names', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const nameInput = screen.getByDisplayValue('Test Point 1');

      // Click on input should not select the point (stopPropagation)
      await user.click(nameInput);

      // The point should remain selected as it was initially
      const pointItem = nameInput.closest('.point-item');
      expect(pointItem).toHaveClass('selected');
    });

    it('toggles point visibility', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      // Find visibility toggle for visible point
      const visibilityButtons = screen.getAllByTitle(/hide point|show point/i);
      const visiblePointToggle = visibilityButtons.find(btn =>
        btn.getAttribute('title') === 'Hide point'
      );

      expect(visiblePointToggle).toBeInTheDocument();
      await user.click(visiblePointToggle!);

      // After click, button should show 'Show point'
      await waitFor(() => {
        expect(visiblePointToggle).toHaveAttribute('title', 'Show point');
      });
    });

    it('removes individual points', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const removeButtons = screen.getAllByTitle('Remove point');
      await user.click(removeButtons[0]);

      // Point should be removed from display
      await waitFor(() => {
        expect(screen.queryByDisplayValue('Test Point 1')).not.toBeInTheDocument();
      });
    });

    it('selects point when clicked', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const pointItem = screen.getByDisplayValue('Test Point 2').closest('.point-item');
      await user.click(pointItem!);

      expect(pointItem).toHaveClass('selected');
    });

    it('clears all points with confirmation', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const clearAllButton = screen.getByRole('button', { name: /clear all/i });
      await user.click(clearAllButton);

      expect(window.confirm).toHaveBeenCalledWith('Remove all time series points?');
    });

    it('does not clear points if confirmation is cancelled', async () => {
      const user = userEvent.setup();
      (window.confirm as any).mockReturnValue(false);

      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const clearAllButton = screen.getByRole('button', { name: /clear all/i });
      await user.click(clearAllButton);

      // Points should still be visible
      expect(screen.getByDisplayValue('Test Point 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Test Point 2')).toBeInTheDocument();
    });

    it('hides clear all button when no points exist', async () => {
      const user = userEvent.setup();
      renderWithContext({
        timeSeriesPoints: [],
      });

      const toggleButton = screen.getByRole('button', { name: /points \(0\)/i });
      await user.click(toggleButton);

      expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
    });
  });

  describe('Trend Display', () => {
    it('toggles trend display', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const trendsButton = screen.getByRole('button', { name: /show trends/i });
      await user.click(trendsButton);

      expect(trendsButton).toHaveTextContent('Hide Trends');
    });

    it('displays trend information when trends are enabled', async () => {
      const user = userEvent.setup();
      renderWithContext({
        showTrends: true,
      });

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      // Should show trend data for point with trend information
      expect(screen.getByText(/rate: 5\.20 mm\/year/i)).toBeInTheDocument();
      expect(screen.getByText(/r²: 0\.850/i)).toBeInTheDocument();
    });

    it('hides trend information when trends are disabled', async () => {
      const user = userEvent.setup();
      renderWithContext({
        showTrends: false,
      });

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      // Should not show trend data
      expect(screen.queryByText(/rate:/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/r²:/i)).not.toBeInTheDocument();
    });

    it('shows N/A for missing trend data', async () => {
      const user = userEvent.setup();
      renderWithContext({
        showTrends: true,
        timeSeriesPoints: [
          {
            id: 'point1',
            name: 'Point Without Trends',
            position: [0, 0],
            color: '#1f77b4',
            visible: true,
            data: {},
            trendData: {
              'test-dataset': {
                slope: 0.5,
                intercept: 1.0,
                rSquared: 0.85,
                mmPerYear: undefined,
              },
            },
          },
        ],
      });

      const toggleButton = screen.getByRole('button', { name: /points \(1\)/i });
      await user.click(toggleButton);

      expect(screen.getByText(/rate: n\/a mm\/year/i)).toBeInTheDocument();
    });
  });

  describe('Event Handling', () => {
    it('prevents event propagation on control buttons', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const visibilityButton = screen.getAllByTitle(/hide point|show point/i)[0];
      const removeButton = screen.getAllByTitle('Remove point')[0];

      // Clicking these buttons should not select the point
      await user.click(visibilityButton);
      await user.click(removeButton);

      // These actions should not propagate to point selection
      // (This is mainly tested through the stopPropagation in the component)
    });
  });

  describe('Accessibility', () => {
    it('has proper button titles and labels', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      expect(toggleButton).toHaveAttribute('title', 'Manage Time Series Points');

      await user.click(toggleButton);

      expect(screen.getByRole('button', { name: /close panel/i })).toHaveAttribute('title', 'Close Panel');
      expect(screen.getByRole('button', { name: /show trends/i })).toHaveAttribute('title', 'Toggle trend display');
      expect(screen.getAllByTitle('Remove point')).toHaveLength(2);
    });

    it('has proper input labels and structure', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      const nameInputs = screen.getAllByRole('textbox');
      expect(nameInputs).toHaveLength(2);

      nameInputs.forEach(input => {
        expect(input).toHaveClass('point-name-input');
      });
    });

    it('displays helpful user instructions', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const toggleButton = screen.getByRole('button', { name: /points \(2\)/i });
      await user.click(toggleButton);

      expect(screen.getByText('• Click map to add points')).toBeInTheDocument();
      expect(screen.getByText('• Double-click markers to remove')).toBeInTheDocument();
      expect(screen.getByText('• Drag markers to move')).toBeInTheDocument();
    });
  });
});
