import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('ControlPanel - Core Color Rescaling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  it('renders vmin and vmax inputs with default values', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs).toHaveLength(2);

    // Find vmin and vmax inputs by their values
    const vminInput = numberInputs.find(input => (input as HTMLInputElement).value === '0');
    const vmaxInput = numberInputs.find(input => (input as HTMLInputElement).value === '1');

    expect(vminInput).toBeInTheDocument();
    expect(vmaxInput).toBeInTheDocument();
  });

  it('updates vmin value when user changes input', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vminInput = numberInputs.find(input => (input as HTMLInputElement).value === '0') as HTMLInputElement;

    // Use fireEvent for number input to avoid userEvent issues with negative numbers
    fireEvent.change(vminInput, { target: { value: '-0.5' } });

    expect(vminInput.value).toBe('-0.5');
  });

  it('updates vmax value when user changes input', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const numberInputs = screen.getAllByRole('spinbutton');
    const vmaxInput = numberInputs.find(input => (input as HTMLInputElement).value === '1') as HTMLInputElement;

    await user.clear(vmaxInput);
    await user.type(vmaxInput, '2.5');

    expect(vmaxInput.value).toBe('2.5');
  });

  it('renders colormap selector with default value', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    // Look for select elements
    const selects = screen.getAllByRole('combobox');

    // Find the colormap select by looking for the Blue-Red option
    const colormapSelect = selects.find(select => {
      const options = select.querySelectorAll('option');
      return Array.from(options).some(option => option.textContent === 'Blue-Red');
    });

    expect(colormapSelect).toBeInTheDocument();
  });

  it('updates colormap when selection changes', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const selects = screen.getAllByRole('combobox');
    const colormapSelect = selects.find(select => {
      const options = select.querySelectorAll('option');
      return Array.from(options).some(option => option.textContent === 'Blue-Red');
    }) as HTMLSelectElement;

    await user.selectOptions(colormapSelect, 'viridis');

    expect(colormapSelect.value).toBe('viridis');
  });

  it('displays colormap image', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const colormapImg = screen.getByRole('img');
    expect(colormapImg).toHaveAttribute('src', '/colorbar/rdbu_r');
    expect(colormapImg).toHaveAttribute('alt', 'Colormap');
  });

  it('renders opacity slider with default value', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const opacitySlider = screen.getByRole('slider');
    expect(opacitySlider).toHaveValue('1');
    expect(opacitySlider).toHaveAttribute('min', '0');
    expect(opacitySlider).toHaveAttribute('max', '1');
    expect(opacitySlider).toHaveAttribute('step', '0.01');
  });

  it('updates opacity when slider changes', async () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    const opacitySlider = screen.getByRole('slider') as HTMLInputElement;

    fireEvent.change(opacitySlider, { target: { value: '0.5' } });

    expect(opacitySlider.value).toBe('0.5');
  });

  it('has proper step attribute for decimal precision on number inputs', () => {
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

  it('displays rescale color limits section', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    expect(screen.getByText('Rescale color limits')).toBeInTheDocument();
  });

  it('displays color map section', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    expect(screen.getByText('Color Map')).toBeInTheDocument();
  });

  it('displays opacity control section', () => {
    render(
      <AppProvider>
        <ControlPanel />
      </AppProvider>
    );

    expect(screen.getByText(/opacity:/i)).toBeInTheDocument();
  });
});
