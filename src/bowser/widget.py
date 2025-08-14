"""Jupyter widget for Bowser InSAR time series exploration."""
from pathlib import Path
from typing import Optional, Union

import traitlets
from IPython.display import display

try:
    import anywidget
except ImportError:
    raise ImportError(
        "anywidget is required for the Bowser widget. "
        "Install with: pip install anywidget"
    )

from .server import BowserServer


class BowserWidget(anywidget.AnyWidget):
    """Interactive widget for exploring InSAR time series data.

    This widget provides a Leaflet map interface for browsing InSAR time series
    data within Jupyter notebooks, with click-to-get-timeseries functionality.
    """

    # Widget front-end assets - will be created by Vite build
    @property
    def _esm(self):
        widget_js = Path(__file__).parent / "dist" / "widget.js"
        if widget_js.exists():
            return widget_js
        else:
            # Fallback - create a minimal widget implementation
            return self._create_fallback_widget()

    def _create_fallback_widget(self):
        """Create a fallback widget when the built assets are not available."""
        fallback_js = Path(__file__).parent / "static" / "fallback-widget.js"
        fallback_js.parent.mkdir(exist_ok=True)

        fallback_content = """
export function render({ model, el }) {
    el.innerHTML = `
        <div style="padding: 20px; text-align: center; border: 2px dashed #ccc;">
            <h3>Bowser Widget</h3>
            <p>Server running at: <a href="${model.get('server_url')}" target="_blank">${model.get('server_url')}</a></p>
            <p>Click the link above to open the full Bowser interface in a new tab.</p>
            <iframe src="${model.get('server_url')}" width="100%" height="500px" frameborder="0"></iframe>
        </div>
    `;
}
"""
        if not fallback_js.exists():
            fallback_js.write_text(fallback_content)

        return fallback_js

    # Synchronized traits between Python and JavaScript
    dataset = traitlets.Unicode("", help="Active dataset/layer name").tag(sync=True)
    time_index = traitlets.Int(0, help="Current time index").tag(sync=True)
    last_timeseries = traitlets.Dict({}, help="Last clicked timeseries data").tag(
        sync=True
    )
    server_url = traitlets.Unicode("", help="Bowser server URL").tag(sync=True)

    # Widget configuration
    height = traitlets.Unicode("600px", help="Widget height").tag(sync=True)
    width = traitlets.Unicode("100%", help="Widget width").tag(sync=True)

    def __init__(
        self,
        stack_file: Optional[Union[str, Path]] = None,
        rasters_file: Optional[Union[str, Path]] = None,
        port: int = 0,
        ignore_sidecar_files: bool = False,
        no_spatial_reference: bool = False,
        no_recommended_mask: bool = False,
        height: str = "600px",
        width: str = "100%",
        **kwargs,
    ):
        """Initialize the Bowser widget.

        Args:
        ----
            stack_file: Path to zarr/netcdf stack file for MD mode
            rasters_file: Path to JSON config file for COG mode
            port: Port for the server (0 for automatic)
            ignore_sidecar_files: Tell GDAL to ignore sidecar files
            no_spatial_reference: Don't use spatial reference for displacement
            no_recommended_mask: Don't use recommended mask for displacement
            height: CSS height of the widget
            width: CSS width of the widget
            **kwargs: Additional arguments passed to anywidget
        """
        super().__init__(**kwargs)

        # Store configuration
        self.stack_file = str(stack_file) if stack_file else None
        self.rasters_file = str(rasters_file) if rasters_file else "bowser_rasters.json"
        self._server_config = {
            "port": port,
            "ignore_sidecar_files": ignore_sidecar_files,
            "no_spatial_reference": no_spatial_reference,
            "no_recommended_mask": no_recommended_mask,
        }

        # Set widget dimensions
        self.height = height
        self.width = width

        # Start the server
        self._server = BowserServer(
            stack_file=self.stack_file,
            rasters_file=self.rasters_file,
            **self._server_config,
        )
        self._server.start()

        # Set server URL for the frontend
        self.server_url = self._server.url

        # Send initialization message to frontend
        self.send({"cmd": "init", "server_url": self.server_url})

    @traitlets.observe("dataset")
    def _on_dataset_change(self, change):
        """Handle dataset change."""
        self.send({"cmd": "dataset_changed", "dataset": change["new"]})

    @traitlets.observe("time_index")
    def _on_time_index_change(self, change):
        """Handle time index change."""
        self.send({"cmd": "time_index_changed", "time_index": change["new"]})

    def _handle_custom_msg(self, content, buffers):
        """Handle messages from the frontend."""
        if content.get("event") == "timeseries_click":
            # Update the last_timeseries trait when user clicks
            self.last_timeseries = content.get("data", {})
        elif content.get("event") == "dataset_selected":
            # Update dataset when user changes selection
            self.dataset = content.get("dataset", "")
        elif content.get("event") == "time_index_updated":
            # Update time index when user changes slider
            self.time_index = content.get("time_index", 0)

    def open_in_browser(self):
        """Open the full Bowser interface in a browser tab."""
        import webbrowser

        webbrowser.open(self.server_url)
        print(f"Opened Bowser interface at: {self.server_url}")

    def get_dataset_info(self):
        """Get information about available datasets."""
        import requests

        try:
            response = requests.get(f"{self.server_url}/datasets")
            return response.json()
        except Exception as e:
            print(f"Error fetching dataset info: {e}")
            return {}

    def get_point_data(
        self, lon: float, lat: float, dataset_name: Optional[str] = None
    ):
        """Get time series data for a specific point.

        Args:
        ----
            lon: Longitude
            lat: Latitude
            dataset_name: Name of dataset (uses current if not specified)

        Returns:
        -------
            List of values for the point
        """
        import requests

        dataset = (
            dataset_name or self.dataset or list(self.get_dataset_info().keys())[0]
        )

        try:
            params = {"dataset_name": dataset, "lon": lon, "lat": lat}
            response = requests.get(f"{self.server_url}/point", params=params)
            return response.json()
        except Exception as e:
            print(f"Error fetching point data: {e}")
            return []

    def close(self):
        """Close the widget and stop the server."""
        if hasattr(self, "_server") and self._server:
            self._server.stop()
        super().close()

    def __del__(self):
        """Cleanup when widget is deleted."""
        self.close()


def create_widget(*args, **kwargs):
    """Convenience function to create and display a BowserWidget.

    Returns the widget instance so users can interact with it programmatically.
    """
    widget = BowserWidget(*args, **kwargs)
    display(widget)
    return widget
