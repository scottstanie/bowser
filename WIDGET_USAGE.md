# Bowser Jupyter Widget Usage Guide

This guide explains how to use the Bowser widget in Jupyter notebooks to explore InSAR time series data interactively.

## Installation

1. **Install Bowser with widget support:**
   ```bash
   pip install bowser-insar[widget]
   ```

2. **For JupyterLab users, ensure anywidget is properly installed:**
   ```bash
   jupyter labextension install @anywidget/core  # Only needed for JupyterLab 3
   ```

## Basic Usage

### Quick Start

```python
from bowser.widget import BowserWidget

# Create and display widget with a zarr stack file
widget = BowserWidget(
    stack_file="/path/to/your/displacement_stack.zarr",
    height="600px"
)
widget
```

### With COG (Cloud Optimized GeoTIFF) Files

```python
from bowser.widget import BowserWidget

# First create a configuration file using the CLI
# bowser setup-dolphin /path/to/dolphin/workdir --output rasters_config.json

# Then use the widget with the configuration
widget = BowserWidget(
    rasters_file="rasters_config.json",
    height="600px",
    width="100%"
)
widget
```

## Widget Options

The `BowserWidget` supports the following parameters:

- `stack_file` (str, optional): Path to zarr/netcdf stack file for multi-dimensional data mode
- `rasters_file` (str, optional): Path to JSON config file for COG mode (default: "bowser_rasters.json")
- `port` (int, optional): Port for the internal server (0 for automatic, default: 0)
- `height` (str, optional): CSS height of the widget (default: "600px")
- `width` (str, optional): CSS width of the widget (default: "100%")
- `ignore_sidecar_files` (bool, optional): Tell GDAL to ignore sidecar files (default: False)
- `no_spatial_reference` (bool, optional): Don't use spatial reference for displacement (default: False)
- `no_recommended_mask` (bool, optional): Don't use recommended mask for displacement (default: False)

## Interactive Features

### Map Interaction

- **Click on the map** to select a point and view its time series
- **Drag markers** to reposition time series and reference points
- **Pan and zoom** the map to explore different areas
- **Toggle basemaps** using the dropdown in the sidebar

### Time Series Analysis

- **Time slider**: Navigate through different time steps
- **Colormap control**: Change visualization colors and scale
- **Reference point**: Set a reference location for relative displacement measurements

### Programmatic Access

```python
# Get the last clicked time series data
print(widget.last_timeseries)

# Change the active dataset
widget.dataset = "velocity"

# Get point data programmatically
data = widget.get_point_data(lon=-118.5, lat=34.2)
print(data)

# Get dataset information
info = widget.get_dataset_info()
print(info.keys())

# Open full interface in browser
widget.open_in_browser()
```

### Observing Changes

You can observe changes to widget properties:

```python
def on_dataset_change(change):
    print(f"Dataset changed to: {change['new']}")

def on_timeseries_click(change):
    print(f"New timeseries data: {change['new']}")

widget.observe(on_dataset_change, names='dataset')
widget.observe(on_timeseries_click, names='last_timeseries')
```

## JupyterHub Integration

When running in JupyterHub environments:

1. **Automatic proxy handling**: The widget automatically detects JupyterHub and uses the correct proxy URLs
2. **No additional configuration needed**: The widget handles CORS and proxy settings automatically

### Server Proxy

If your JupyterHub has `jupyter-server-proxy` installed, the widget will automatically use proxy URLs like:
```
https://your-hub.com/user/username/proxy/8765/
```

## Data Preparation

### For Zarr/NetCDF files (MD mode)

```python
# Your data should be an xarray Dataset with:
# - Spatial dimensions: 'x', 'y'
# - Time dimension: 'time'
# - Data variables with spatial+time dimensions
import xarray as xr

ds = xr.open_zarr("displacement_timeseries.zarr")
print(ds)  # Should show variables with (time, y, x) dimensions
```

### For COG files

Use the Bowser CLI to prepare configuration files:

```bash
# For Dolphin workflow outputs
bowser setup-dolphin /path/to/dolphin/workdir -o rasters.json

# For HyP3 products
bowser setup-hyp3 /path/to/hyp3/products -o rasters.json

# For OPERA DISP-S1 products
bowser setup-disp-s1 /path/to/disp_s1/products -o rasters.json

# For custom data
bowser set-data -o rasters.json
# Follow the interactive prompts
```

## Troubleshooting

### Widget not displaying

1. **Check anywidget installation:**
   ```bash
   pip install anywidget>=0.9.0
   ```

2. **For JupyterLab 3.x users:**
   ```bash
   jupyter labextension install @anywidget/core
   ```

3. **Restart your Jupyter kernel** after installing

### Server connection issues

1. **Check that your data files exist and are accessible**
2. **Verify the server URL** by calling `print(widget.server_url)`
3. **Try opening the server URL directly** in a browser: `widget.open_in_browser()`

### Performance issues

1. **Large datasets**: Consider using overviews and COG format for better performance
2. **Memory usage**: The widget runs a FastAPI server in the background - monitor memory usage
3. **Network**: Ensure good connectivity between the notebook and the widget server

### Data not loading

1. **Check data format**: Ensure spatial dimensions are named 'x' and 'y'
2. **CRS information**: Make sure your data has proper coordinate reference system information
3. **File paths**: Use absolute paths for data files

## Advanced Usage

### Custom Server Configuration

```python
from bowser.server import running

# Use the server context manager directly
with running(stack_file="data.zarr", port=8080) as server:
    print(f"Server running at: {server.url}")
    # Server will automatically stop when exiting the context
```

### Multiple Widgets

```python
# Create multiple widgets with different datasets
widget1 = BowserWidget(stack_file="dataset1.zarr", height="400px")
widget2 = BowserWidget(stack_file="dataset2.zarr", height="400px")

# Display them in the same cell
from IPython.display import display
display(widget1, widget2)
```

### Integration with Other Tools

```python
import matplotlib.pyplot as plt

# Get time series data and plot with matplotlib
data = widget.get_point_data(-118.5, 34.2)
plt.plot(data)
plt.xlabel('Time Index')
plt.ylabel('Displacement (mm)')
plt.title('Time Series at Selected Point')
plt.show()
```

## Examples

### Complete Workflow Example

```python
from bowser.widget import BowserWidget
import numpy as np

# 1. Create widget
widget = BowserWidget(
    stack_file="/data/LA_displacement_stack.zarr",
    height="600px"
)

# 2. Display widget
display(widget)

# 3. Set up observers
def analyze_timeseries(change):
    data = change['new']
    if data:
        print(f"Time series statistics:")
        print(f"  Mean: {np.mean(data):.3f} mm")
        print(f"  Std:  {np.std(data):.3f} mm")
        print(f"  Min:  {np.min(data):.3f} mm")
        print(f"  Max:  {np.max(data):.3f} mm")

widget.observe(analyze_timeseries, names='last_timeseries')

# 4. Programmatic interaction
print(f"Available datasets: {list(widget.get_dataset_info().keys())}")
```

This completes the widget implementation according to the plan in `plan.md`. The widget provides:

1. ✅ **Backend refactor** - Server utilities for programmatic control
2. ✅ **Frontend refactor** - Decoupled DOM factory function
3. ✅ **Widget implementation** - Full anywidget integration with traitlets
4. ✅ **Two-way communication** - Python ↔ JavaScript messaging
5. ✅ **Configuration** - Vite build setup for widget ES modules
6. ✅ **Fallback support** - Works even without built assets
7. ✅ **JupyterHub integration** - Automatic proxy detection
