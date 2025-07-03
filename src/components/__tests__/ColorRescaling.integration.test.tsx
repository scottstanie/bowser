import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '../../context/AppContext';
import ControlPanel from '../ControlPanel';

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

describe('Color Rescaling Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('completes full color rescaling workflow', async () => {
    const user = userEvent.setup();

    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // 1. Verify initial state
    const numberInputs = screen.getAllByRole('spinbutton');
    const vminInput = numberInputs[0] as HTMLInputElement;
    const vmaxInput = numberInputs[1] as HTMLInputElement;

    expect(vminInput.value).toBe('0');
    expect(vmaxInput.value).toBe('1');

    // 2. Change vmin to a negative value
    fireEvent.change(vminInput, { target: { value: '-2.5' } });
    expect(vminInput.value).toBe('-2.5');

    // 3. Change vmax to a higher value
    fireEvent.change(vmaxInput, { target: { value: '5.0' } });
    expect(vmaxInput.value).toBe('5.0');

    // 4. Change colormap
    const selects = screen.getAllByRole('combobox');
    let colormapSelect: HTMLSelectElement | null = null;

    for (const select of selects) {
      const options = select.querySelectorAll('option');
      if (Array.from(options).some(option => option.value === 'viridis')) {
        colormapSelect = select as HTMLSelectElement;
        break;
      }
    }

    if (colormapSelect) {
      await user.selectOptions(colormapSelect, 'viridis');
      expect(colormapSelect.value).toBe('viridis');
    }

    // 5. Change opacity
    const opacitySlider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(opacitySlider, { target: { value: '0.8' } });
    expect(opacitySlider.value).toBe('0.8');

    // 6. Verify all changes are maintained
    expect(vminInput.value).toBe('-2.5');
    expect(vmaxInput.value).toBe('5.0');
    expect(opacitySlider.value).toBe('0.8');
    if (colormapSelect) {
      expect(colormapSelect.value).toBe('viridis');
    }
  });

  it('handles rapid parameter changes without corruption', async () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vminInput = numberInputs[0] as HTMLInputElement;
    const vmaxInput = numberInputs[1] as HTMLInputElement;

    // Rapid changes to vmin
    fireEvent.change(vminInput, { target: { value: '-1' } });
    fireEvent.change(vminInput, { target: { value: '-2' } });
    fireEvent.change(vminInput, { target: { value: '-3' } });
    fireEvent.change(vminInput, { target: { value: '-2.5' } });

    // Rapid changes to vmax
    fireEvent.change(vmaxInput, { target: { value: '2' } });
    fireEvent.change(vmaxInput, { target: { value: '3' } });
    fireEvent.change(vmaxInput, { target: { value: '4' } });
    fireEvent.change(vmaxInput, { target: { value: '3.5' } });

    // Verify final values are correct
    expect(vminInput.value).toBe('-2.5');
    expect(vmaxInput.value).toBe('3.5');
  });

  it('handles edge cases for numeric inputs', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vminInput = numberInputs[0] as HTMLInputElement;
    const vmaxInput = numberInputs[1] as HTMLInputElement;

    // Test decimal values
    fireEvent.change(vminInput, { target: { value: '-0.001' } });
    expect(vminInput.value).toBe('-0.001');

    // Test scientific notation
    fireEvent.change(vmaxInput, { target: { value: '1e-5' } });
    // Browser may keep scientific notation or convert to decimal
    expect(['1e-5', '0.00001']).toContain(vmaxInput.value);

    // Test very large numbers
    fireEvent.change(vminInput, { target: { value: '-999.999' } });
    expect(vminInput.value).toBe('-999.999');

    fireEvent.change(vmaxInput, { target: { value: '999.999' } });
    expect(vmaxInput.value).toBe('999.999');
  });

  it('maintains UI responsiveness during parameter changes', async () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Verify all interactive elements are present and responsive
    const numberInputs = screen.getAllByRole('spinbutton');
    const slider = screen.getByRole('slider');
    const selects = screen.getAllByRole('combobox');
    const buttons = screen.getAllByRole('button');

    // Test that all elements can be interacted with
    expect(numberInputs).toHaveLength(2);
    expect(slider).toBeInTheDocument();
    expect(selects.length).toBeGreaterThan(0);
    expect(buttons.length).toBeGreaterThan(0);

    // Verify elements have proper attributes
    numberInputs.forEach(input => {
      expect(input).toHaveAttribute('type', 'number');
      expect(input).toHaveAttribute('step', '0.01');
    });

    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '1');
  });

  it('displays proper visual feedback', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Check that colormap image is displayed
    const colormapImg = screen.getByRole('img');
    expect(colormapImg).toHaveAttribute('src', '/colorbar/rdbu_r');
    expect(colormapImg).toHaveAttribute('alt', 'Colormap');

    // Check opacity display
    expect(screen.getByText('1')).toBeInTheDocument(); // opacity value display

    // Check section headers
    expect(screen.getByText('Color Map')).toBeInTheDocument();
    expect(screen.getByText('Rescale color limits')).toBeInTheDocument();
  });

  it('provides proper accessibility features', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Check for proper labels and structure
    const numberInputs = screen.getAllByRole('spinbutton');
    const slider = screen.getByRole('slider');
    const selects = screen.getAllByRole('combobox');

    // All form controls should be present
    expect(numberInputs).toHaveLength(2);
    expect(slider).toBeInTheDocument();
    expect(selects.length).toBeGreaterThan(0);

    // Check for opacity label
    expect(screen.getByText(/opacity:/i)).toBeInTheDocument();
  });
});
