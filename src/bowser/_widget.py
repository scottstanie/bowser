from __future__ import annotations

import logging
from pathlib import Path
from typing import Sequence

import ipywidgets as widgets
import requests
from ipyleaflet import LayersControl, Map, ScaleControl, TileLayer, basemaps
from titiler.core.models.mapbox import TileJSON

from ._server import BowserServer

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Reasonable defaults for displacement in meters; adjust as you like
DEFAULT_VMIN = -0.2
DEFAULT_VMAX = 0.2
DEFAULT_CMAP = "rdbu_r"
CMAPS = [
    "rdbu_r",
    "viridis",
    "plasma",
    "magma",
    "inferno",
    "jet",
    "gray",
    "cubehelix",
    "turbo",
    "RdBu",
    "PuOr",
]


def make_bowser_widget(
    dataset_name: str | None = None,
    bowser_url: str = "http://localhost:8000",
    **server_kwargs,
) -> widgets.VBox:
    """Create a Jupyter widget with dataset, colormap, rescale and opacity controls."""
    # Ensure a server is available
    server = None
    try:
        requests.get(f"{bowser_url}/mode", timeout=2)
    except requests.exceptions.RequestException:
        logger.info("Starting Bowser server...")
        server = BowserServer(**server_kwargs)
        server.start()
        bowser_url = server.url

    try:
        mode = requests.get(f"{bowser_url}/mode").json()["mode"]
        datasets = requests.get(f"{bowser_url}/datasets").json()
        if not datasets:
            raise RuntimeError("Bowser returned no datasets.")
        if dataset_name is None:
            dataset_name = list(datasets.keys())[0]
        if dataset_name not in datasets:
            raise ValueError(
                f"Dataset '{dataset_name}' not found in {list(datasets.keys())}"
            )
        # --- controls ---
        dataset_dd = widgets.Dropdown(
            options=list(datasets.keys()),
            value=dataset_name,
            description="Layer:",
            layout=widgets.Layout(width="100%"),
        )
        cmap_dd = widgets.Dropdown(
            options=CMAPS,
            value=DEFAULT_CMAP,
            description="Colormap:",
            layout=widgets.Layout(width="100%"),
        )
        vmin_ft = widgets.FloatText(
            value=DEFAULT_VMIN,
            step=0.01,
            description="vmin:",
            layout=widgets.Layout(width="15em"),
        )
        vmax_ft = widgets.FloatText(
            value=DEFAULT_VMAX,
            step=0.01,
            description="vmax:",
            layout=widgets.Layout(width="15em"),
        )
        opacity_sl = widgets.FloatSlider(
            value=1.0,
            min=0.0,
            max=1.0,
            step=0.01,
            description="Opacity:",
            readout=True,
            layout=widgets.Layout(width="100%"),
        )
        idx_sl = widgets.IntSlider(
            description="Index:",
            continuous_update=False,
            layout=widgets.Layout(width="100%"),
        )
        left_controls = widgets.VBox(
            [dataset_dd, vmin_ft, vmax_ft, cmap_dd, opacity_sl, idx_sl],
            layout=widgets.Layout(width="20em", grid_area="menu"),
        )

        title = widgets.HTML(value="")

        # --- map (fill the right column completely) ---
        m = Map(
            center=[0, 0],
            zoom=2,
            basemap=basemaps.Esri.WorldImagery,
            layout=widgets.Layout(
                width="100%",
                height="100%",
                min_height="0",
                flex="1 1 auto",
                grid_area="map",
            ),
        )
        m.add_control(ScaleControl(position="bottomleft"))
        m.add_control(LayersControl(position="topright"))

        cur_layer: TileLayer | None = None

        def fit_to_layer(_=None):
            info = datasets[dataset_dd.value]
            b = info.get("latlon_bounds")
            if b:
                # [[south, west], [north, east]]
                m.fit_bounds([[b[1], b[0]], [b[3], b[2]]])

        def set_dataset_controls(name: str):
            info = datasets[name]
            x_vals = info["x_values"]
            idx_sl.min = 0
            idx_sl.max = max(0, len(x_vals) - 1)
            idx_sl.value = min(idx_sl.value, idx_sl.max)
            title.value = f"<h2>{x_vals[idx_sl.value]}</h2>"
            # NOTE: no recenter here — preserves your current view

        def build_params(name: str, idx: int) -> tuple[str, dict]:
            info = datasets[name]
            params = {
                "minzoom": 5,
                "maxzoom": 13,
                "rescale": f"{vmin_ft.value},{vmax_ft.value}",
                "colormap_name": cmap_dd.value,
            }
            if mode == "md":
                params.update({"variable": name, "time_idx": idx})
                endpoint = "md/WebMercatorQuad/tilejson.json"
            else:
                url = info["file_list"][idx]
                params.update({"url": url})
                mlist = info.get("mask_file_list") or []
                if idx < len(mlist) and mlist[idx] is not None:
                    params["mask"] = mlist[idx]
                    mmv = info.get("mask_min_value")
                    if mmv is not None:
                        params["mask_min_value"] = mmv
                endpoint = "cog/WebMercatorQuad/tilejson.json"
            return endpoint, params

        def refresh_tile(*_):
            nonlocal cur_layer
            name = dataset_dd.value
            info = datasets[name]
            idx = idx_sl.value
            title.value = f"<h2>{info['x_values'][idx]}</h2>"
            endpoint, params = build_params(name, idx)
            r = requests.get(f"{bowser_url}/{endpoint}", params=params)
            r.raise_for_status()
            tj = TileJSON(**r.json())
            new_layer = TileLayer(
                url=tj.tiles[0],
                min_zoom=tj.minzoom,
                max_zoom=tj.maxzoom,
                show_loading=True,
                opacity=opacity_sl.value,
            )
            if cur_layer is not None:
                m.remove_layer(cur_layer)
            cur_layer = new_layer
            m.add_layer(cur_layer)

        def on_opacity(change):
            if cur_layer is not None:
                cur_layer.opacity = change["new"]

        # wiring
        dataset_dd.observe(
            lambda _: (set_dataset_controls(dataset_dd.value), refresh_tile()),
            names="value",
        )
        idx_sl.observe(refresh_tile, names="value")
        cmap_dd.observe(refresh_tile, names="value")
        vmin_ft.observe(refresh_tile, names="value")
        vmax_ft.observe(refresh_tile, names="value")
        opacity_sl.observe(on_opacity, names="value")

        # init
        set_dataset_controls(dataset_name)
        refresh_tile()
        fit_to_layer()  # one-time fit on load

        # layout: CSS-grid clone of your `body { grid-template-areas: "menu map"; }`
        container = widgets.GridBox(
            children=[left_controls, m],
            layout=widgets.Layout(
                width="100%",
                height="75vh",  # same as your CSS
                grid_template_columns="20em 1fr",  # 20em + auto
                grid_template_rows="1fr auto",  # map fills
                grid_template_areas='"menu map"',
                grid_gap="0.75rem",
                align_items="stretch",
            ),
        )
        ui = widgets.VBox([title, container])  # instead of HBox/VBox top_row
        return ui

    except Exception as e:
        if server:
            server.stop()
        raise e


# -----------------------------
# Backwards-compat convenience:
# -----------------------------
def make_widgets(ifg_files: Sequence[str | Path], show_loading: bool = True):  # noqa: ARG001
    """Deprecated shim - prefer make_bowser_widget()."""  # noqa: D401
    logger.warning("make_widgets() is deprecated. Use make_bowser_widget().")
    # Minimal: spin a temp 'cog' dataset via the server and call make_bowser_widget()
    raise NotImplementedError("Use make_bowser_widget() with a named dataset.")
