import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ControlPanel from '../ControlPanel';
import { AppProvider } from '../../context/AppContext';

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

describe('ControlPanel - Core Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('renders without crashing', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    expect(screen.getByText('Color Map')).toBeInTheDocument();
  });

  it('renders color rescaling inputs', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    expect(screen.getByText('Rescale color limits')).toBeInTheDocument();

    // Should have number inputs for vmin and vmax
    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs).toHaveLength(2);
  });

  it('renders colormap selector', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);

    // Should have colormap image
    const colormapImg = screen.getByRole('img');
    expect(colormapImg).toHaveAttribute('alt', 'Colormap');
  });

  it('renders opacity slider', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const opacitySlider = screen.getByRole('slider');
    expect(opacitySlider).toBeInTheDocument();
    expect(opacitySlider).toHaveAttribute('min', '0');
    expect(opacitySlider).toHaveAttribute('max', '1');
  });

  it('allows changing vmin value', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vminInput = numberInputs[0] as HTMLInputElement;

    fireEvent.change(vminInput, { target: { value: '-2.5' } });
    expect(vminInput.value).toBe('-2.5');
  });

  it('allows changing vmax value', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vmaxInput = numberInputs[1] as HTMLInputElement;

    fireEvent.change(vmaxInput, { target: { value: '3.0' } });
    expect(vmaxInput.value).toBe('3.0');
  });

  it('allows changing colormap', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Find colormap select by looking for viridis option
    const selects = screen.getAllByRole('combobox');
    let colormapSelect: HTMLSelectElement | null = null;

    for (const select of selects) {
      const options = select.querySelectorAll('option');
      if (Array.from(options).some(option => option.value === 'viridis')) {
        colormapSelect = select as HTMLSelectElement;
        break;
      }
    }

    expect(colormapSelect).not.toBeNull();

    if (colormapSelect) {
      await user.selectOptions(colormapSelect, 'viridis');
      expect(colormapSelect.value).toBe('viridis');
    }
  });

  it('allows changing opacity', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const opacitySlider = screen.getByRole('slider') as HTMLInputElement;

    fireEvent.change(opacitySlider, { target: { value: '0.7' } });
    expect(opacitySlider.value).toBe('0.7');
  });

  it('has proper input attributes for precision', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');

    numberInputs.forEach(input => {
      expect(input).toHaveAttribute('step', '0.01');
      expect(input).toHaveAttribute('type', 'number');
    });
  });

  it('displays all required UI sections', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Check for main sections
    expect(screen.getByText('Color Map')).toBeInTheDocument();
    expect(screen.getByText('Rescale color limits')).toBeInTheDocument();
    expect(screen.getByText(/opacity:/i)).toBeInTheDocument();
    expect(screen.getByText('Basemap:')).toBeInTheDocument();
  });

  it('has correct chart toggle button', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Should have a button for toggling chart
    const chartButton = screen.getByRole('button', { name: /time series/i });
    expect(chartButton).toBeInTheDocument();
  });
});
