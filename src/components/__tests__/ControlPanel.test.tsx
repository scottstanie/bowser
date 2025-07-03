import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ControlPanel from '../ControlPanel';
import { AppProvider } from '../../context/AppContext';
import { AppState } from '../../types';

// Mock the useApi hook
vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({
    fetchPointTimeSeries: vi.fn().mockResolvedValue([1, 2, 3, 4, 5]),
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

// Helper to render ControlPanel with context
const renderWithContext = (initialState?: Partial<AppState>) => {
  const TestProvider = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );

  return render(
    <TestProvider>
      <ControlPanel />
    </TestProvider>
  );
};

describe('ControlPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Color Rescaling Functionality', () => {
    it('renders vmin and vmax inputs with default values', () => {
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');
      const vmaxInput = screen.getByDisplayValue('1');

      expect(vminInput).toBeInTheDocument();
      expect(vmaxInput).toBeInTheDocument();
      expect(vminInput.getAttribute('type')).toBe('number');
      expect(vmaxInput.getAttribute('type')).toBe('number');
    });

    it('updates vmin value when user changes input', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');

      await user.clear(vminInput);
      await user.type(vminInput, '-0.5');

      expect(vminInput).toHaveValue(-0.5);
    });

    it('updates vmax value when user changes input', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const vmaxInput = screen.getByDisplayValue('1');

      await user.clear(vmaxInput);
      await user.type(vmaxInput, '2.5');

      expect(vmaxInput).toHaveValue(2.5);
    });

    it('saves preferences to localStorage when vmin changes', async () => {
      const user = userEvent.setup();
      renderWithContext();

      // First set a dataset
      const datasetSelect = screen.getByRole('combobox');
      fireEvent.change(datasetSelect, { target: { value: 'test-dataset' } });

      const vminInput = screen.getByDisplayValue('0');

      await user.clear(vminInput);
      await user.type(vminInput, '-1.5');

      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'test-dataset-vmin',
          '-1.5'
        );
      });
    });

    it('saves preferences to localStorage when vmax changes', async () => {
      const user = userEvent.setup();
      renderWithContext();

      // First set a dataset
      const datasetSelect = screen.getByRole('combobox');
      fireEvent.change(datasetSelect, { target: { value: 'test-dataset' } });

      const vmaxInput = screen.getByDisplayValue('1');

      await user.clear(vmaxInput);
      await user.type(vmaxInput, '3.5');

      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'test-dataset-vmax',
          '3.5'
        );
      });
    });

    it('loads saved vmin/vmax from localStorage when dataset changes', () => {
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'new-dataset-vmin') return '-2.0';
        if (key === 'new-dataset-vmax') return '5.0';
        if (key === 'new-dataset-colormap_name') return 'viridis';
        return null;
      });

      renderWithContext();

      const datasetSelect = screen.getByRole('combobox');
      fireEvent.change(datasetSelect, { target: { value: 'new-dataset' } });

      expect(localStorageMock.getItem).toHaveBeenCalledWith('new-dataset-vmin');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('new-dataset-vmax');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('new-dataset-colormap_name');
    });

    it('validates numeric input for vmin and vmax', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');

      // Should accept decimal numbers
      await user.clear(vminInput);
      await user.type(vminInput, '-123.456');
      expect(vminInput).toHaveValue(-123.456);

      // Should accept scientific notation if supported by browser
      await user.clear(vminInput);
      await user.type(vminInput, '1e-5');
      expect(vminInput).toHaveValue(0.00001);
    });

    it('handles invalid numeric input gracefully', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');

      // Clear and try to type invalid input
      await user.clear(vminInput);
      await user.type(vminInput, 'abc');

      // Input should be empty or show last valid value
      expect(vminInput.value === '' || vminInput.value === '0').toBe(true);
    });

    it('step attribute is correctly set for decimal precision', () => {
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');
      const vmaxInput = screen.getByDisplayValue('1');

      expect(vminInput.getAttribute('step')).toBe('0.01');
      expect(vmaxInput.getAttribute('step')).toBe('0.01');
    });
  });

  describe('Colormap Selection', () => {
    it('renders colormap selector with default value', () => {
      renderWithContext();

      const colormapSelect = screen.getByDisplayValue('Blue-Red');
      expect(colormapSelect).toBeInTheDocument();
    });

    it('updates colormap when selection changes', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const colormapSelect = screen.getByDisplayValue('Blue-Red');

      await user.selectOptions(colormapSelect, 'viridis');

      expect(colormapSelect).toHaveValue('viridis');
    });

    it('saves colormap preference when changed', async () => {
      const user = userEvent.setup();
      renderWithContext();

      // First set a dataset
      const datasetSelect = screen.getByRole('combobox');
      fireEvent.change(datasetSelect, { target: { value: 'test-dataset' } });

      const colormapSelect = screen.getByDisplayValue('Blue-Red');
      await user.selectOptions(colormapSelect, 'viridis');

      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'test-dataset-colormap_name',
          'viridis'
        );
      });
    });

    it('displays colormap image with correct source', () => {
      renderWithContext();

      const colormapImg = screen.getByRole('img', { name: /colormap/i });
      expect(colormapImg).toHaveAttribute('src', '/colorbar/rdbu_r');
    });

    it('updates colormap image when colormap changes', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const colormapSelect = screen.getByDisplayValue('Blue-Red');
      const colormapImg = screen.getByRole('img', { name: /colormap/i });

      await user.selectOptions(colormapSelect, 'viridis');

      await waitFor(() => {
        expect(colormapImg).toHaveAttribute('src', '/colorbar/viridis');
      });
    });
  });

  describe('Integration - Color Scale Consistency', () => {
    it('maintains color scale state when switching between datasets', async () => {
      const user = userEvent.setup();

      // Setup localStorage to return different values for different datasets
      localStorageMock.getItem.mockImplementation((key: string) => {
        if (key === 'dataset1-vmin') return '-1.0';
        if (key === 'dataset1-vmax') return '2.0';
        if (key === 'dataset1-colormap_name') return 'viridis';
        if (key === 'dataset2-vmin') return '0.5';
        if (key === 'dataset2-vmax') return '3.0';
        if (key === 'dataset2-colormap_name') return 'magma';
        return null;
      });

      renderWithContext();

      const datasetSelect = screen.getByRole('combobox');

      // Switch to dataset1
      fireEvent.change(datasetSelect, { target: { value: 'dataset1' } });

      // Switch to dataset2
      fireEvent.change(datasetSelect, { target: { value: 'dataset2' } });

      // Verify localStorage was queried for both datasets
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset1-vmin');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset1-vmax');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset1-colormap_name');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset2-vmin');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset2-vmax');
      expect(localStorageMock.getItem).toHaveBeenCalledWith('dataset2-colormap_name');
    });

    it('triggers color scale update when both vmin and vmax change rapidly', async () => {
      const user = userEvent.setup();
      renderWithContext();

      // First set a dataset
      const datasetSelect = screen.getByRole('combobox');
      fireEvent.change(datasetSelect, { target: { value: 'test-dataset' } });

      const vminInput = screen.getByDisplayValue('0');
      const vmaxInput = screen.getByDisplayValue('1');

      // Rapidly change both values (simulating the brittleness issue)
      await user.clear(vminInput);
      await user.type(vminInput, '-5');

      await user.clear(vmaxInput);
      await user.type(vmaxInput, '10');

      // Verify both saves occurred
      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith('test-dataset-vmin', '-5');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('test-dataset-vmax', '10');
      });
    });
  });

  describe('Opacity Control', () => {
    it('renders opacity slider with default value', () => {
      renderWithContext();

      const opacitySlider = screen.getByRole('slider', { name: /opacity/i });
      expect(opacitySlider).toHaveValue('1');
    });

    it('updates opacity when slider changes', async () => {
      const user = userEvent.setup();
      renderWithContext();

      const opacitySlider = screen.getByRole('slider', { name: /opacity/i });

      await user.click(opacitySlider);
      fireEvent.change(opacitySlider, { target: { value: '0.5' } });

      expect(opacitySlider).toHaveValue('0.5');
    });

    it('displays current opacity value', () => {
      renderWithContext();

      const opacityValue = screen.getByText('1');
      expect(opacityValue).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper labels for form controls', () => {
      renderWithContext();

      // Check for opacity slider label
      expect(screen.getByText(/opacity:/i)).toBeInTheDocument();

      // Check for rescale section
      expect(screen.getByText(/rescale color limits/i)).toBeInTheDocument();
    });

    it('number inputs have proper attributes', () => {
      renderWithContext();

      const vminInput = screen.getByDisplayValue('0');
      const vmaxInput = screen.getByDisplayValue('1');

      expect(vminInput).toHaveAttribute('type', 'number');
      expect(vminInput).toHaveAttribute('step', '0.01');
      expect(vmaxInput).toHaveAttribute('type', 'number');
      expect(vmaxInput).toHaveAttribute('step', '0.01');
    });
  });
});
