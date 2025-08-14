from __future__ import annotations

import copy
import logging
from pathlib import Path
from typing import Sequence

import ipywidgets as widgets
import requests
from ipyleaflet import Map, ScaleControl, TileLayer, basemaps
from opera_utils import get_dates
from requests.compat import quote
from titiler.core.models.mapbox import TileJSON

from ._server import BowserServer

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def make_bowser_widget(
    dataset_name: str = None,
    bowser_url: str = "http://localhost:8000",
    show_loading: bool = True,
    **server_kwargs,
) -> widgets.VBox:
    """Create widgets for browsing Bowser datasets.

    Parameters
    ----------
    dataset_name : str, optional
        Name of the dataset to browse. If None, will use the first available dataset.
    bowser_url : str, optional
        URL of the Bowser server, by default "http://localhost:8000"
    show_loading : bool, optional
        Whether to show loading indicator when tiles are loading.
        By default True
    **server_kwargs
        Additional kwargs to pass to BowserServer if starting a new server

    Returns
    -------
    widgets.VBox
        Widget containing map and controls
    """
    # Check if server is running, if not start one
    try:
        requests.get(f"{bowser_url}/mode", timeout=2)
        server = None
    except requests.exceptions.RequestException:
        logger.info("Starting Bowser server...")
        server = BowserServer(**server_kwargs)
        server.start()
        bowser_url = server.url

    try:
        # Get server mode and datasets
        mode_resp = requests.get(f"{bowser_url}/mode")
        mode = mode_resp.json()["mode"]

        datasets_resp = requests.get(f"{bowser_url}/datasets")
        datasets = datasets_resp.json()

        if not dataset_name:
            dataset_name = list(datasets.keys())[0]

        if dataset_name not in datasets:
            raise ValueError(
                f"Dataset '{dataset_name}' not found. Available: {list(datasets.keys())}"
            )

        dataset_info = datasets[dataset_name]

        # Create appropriate widget based on mode
        if mode == "cog":
            return _make_cog_widget(
                dataset_name, dataset_info, bowser_url, show_loading
            )
        else:  # md mode
            return _make_md_widget(dataset_name, dataset_info, bowser_url, show_loading)

    except Exception as e:
        if server:
            server.stop()
        raise e


def _make_cog_widget(
    dataset_name: str, dataset_info: dict, bowser_url: str, show_loading: bool
) -> widgets.VBox:
    """Create widget for COG mode datasets."""
    file_list = dataset_info["file_list"]
    x_values = dataset_info["x_values"]

    # Get tile URLs for COG mode
    tile_jsons = []
    for i, file_path in enumerate(file_list):
        mask_file = (
            dataset_info["mask_file_list"][i]
            if i < len(dataset_info["mask_file_list"])
            else None
        )

        params = {"url": file_path, "minzoom": 5, "maxzoom": 13}
        if mask_file:
            params["mask"] = mask_file
            params["mask_min_value"] = dataset_info["mask_min_value"]

        resp = requests.get(f"{bowser_url}/cog/tilejson.json", params=params)
        tile_jsons.append(TileJSON(**resp.json()))

    return _create_widget_from_tiles(tile_jsons, x_values, show_loading)


def _make_md_widget(
    dataset_name: str, dataset_info: dict, bowser_url: str, show_loading: bool
) -> widgets.VBox:
    """Create widget for MD (multidimensional) mode datasets."""
    x_values = dataset_info["x_values"]

    # Get tile URLs for MD mode
    tile_jsons = []
    for i in range(len(x_values)):
        params = {"variable": dataset_name, "time_idx": i, "minzoom": 5, "maxzoom": 13}

        resp = requests.get(f"{bowser_url}/md/tilejson.json", params=params)
        tile_jsons.append(TileJSON(**resp.json()))

    return _create_widget_from_tiles(tile_jsons, x_values, show_loading)


def _create_widget_from_tiles(
    tile_jsons: list[TileJSON], x_values: list, show_loading: bool
) -> widgets.VBox:
    """Create the actual widget from tile JSONs and x values."""
    # Setup the ipyleaflet map
    lon, lat, zoom = tile_jsons[0].center
    m = Map(
        center=[lat, lon],
        zoom=zoom,
        basemap=basemaps.Esri.WorldImagery,
        layout=widgets.Layout(width="70%", height="500px"),
    )
    m.add_control(ScaleControl(position="bottomleft"))

    cur_idx = 0
    title = widgets.HTML(value=f"<h2>{x_values[cur_idx]}</h2>")

    # Create TileLayers
    logger.info("Creating TileLayers...")
    tile_layers = [
        TileLayer(
            url=tj.tiles[0],
            min_zoom=tj.minzoom,
            max_zoom=tj.maxzoom,
            show_loading=show_loading,
        )
        for tj in tile_jsons
    ]
    m.add_layer(tile_layers[0])
    logger.info(f"First tile URL: {tile_layers[0].url}")

    # Control widgets
    slider = widgets.IntSlider(
        value=0, min=0, max=len(tile_layers) - 1, description="Index:"
    )

    def on_value_change(change):
        cur_idx = change["new"]
        title.value = f"<h2>{x_values[cur_idx]}</h2>"
        m.remove_layer(m.layers[-1])
        m.add_layer(tile_layers[cur_idx])

    slider.observe(on_value_change, names="value", type="change")

    return widgets.VBox([title, slider, m])


def make_widgets(ifg_files: Sequence[str | Path], show_loading: bool = True):
    """Create the widgets for browsing a list of files/urls.

    DEPRECATED: Use make_bowser_widget() instead for better integration
    with the current Bowser data model.

    Parameters
    ----------
    ifg_files : list[str | Path]
        List of files/urls to be tiled.
    show_loading : bool, optional
        Whether to show loading indicator when tiles are being processed by Titiler.
        By default True
    """
    logger.warning("make_widgets() is deprecated. Use make_bowser_widget() instead.")

    # Get the tile urls from the Titiler server
    logger.info("Querying Titiler for tile urls...")
    tile_jsons = get_many_titiler_urls(ifg_files)
    # Parse files for dates
    date_pairs = [get_dates(f) for f in ifg_files]
    x_values = [f"{d[0]} - {d[1]}" for d in date_pairs]

    return _create_widget_from_tiles(tile_jsons, x_values, show_loading)


def get_tile_url(
    url: str | Path,
    minzoom: int = 5,
    maxzoom: int = 13,
    endpoint: str = "cog/tilejson.json",
    bowser_url: str = "http://localhost:8000",
    **endpoint_params,
) -> TileJSON:
    """Get the local tiling URL to put on ipyleaflet.

    Updated to work with Bowser server endpoints.

    Parameters
    ----------
    url : str
        URL (or filepath) of the COG to be tiled.
    minzoom : int, optional
        Minimum zoom level, by default 5
    maxzoom : int, optional
        Maximum zoom level, by default 13
    endpoint : str, optional
        Endpoint to query, by default "cog/tilejson.json"
    bowser_url : str, optional
        URL of the Bowser server, by default "http://localhost:8000"
    endpoint_params : dict, optional
        Additional parameters to be passed to the endpoint, by default {}

    Returns
    -------
    TileJSON
        Model object from Bowser server.
        Can be converted to dict with `model_dump()`.
    """
    params = {
        "url": url,
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        **endpoint_params,
    }
    resp = requests.get(
        f"{bowser_url}/{endpoint}",
        params=params,
    )
    return TileJSON(**resp.json())


def get_many_titiler_urls(
    file_list: Sequence[str | Path],
    minzoom: int = 5,
    maxzoom: int = 13,
    bowser_url: str = "http://localhost:8000",
    endpoint: str = "cog/tilejson.json",
    **endpoint_params,
) -> list[TileJSON]:
    """Query Bowser for the tiling url, assuming all files are similar in structure.

    This function assumes that the Bowser response to the `/cog/tilejson.json` endpoint
    will return the same thing for all files, except for the `url` parameter.

    Parameters
    ----------
    file_list : list[str | Path]
        List of urls/files to be tiled.
    minzoom : int, optional
        Minimum zoom level, by default 5
    maxzoom : int, optional
        Maximum zoom level, by default 13
    endpoint : str, optional
        Endpoint to query, by default "cog/tilejson.json"
    bowser_url : str, optional
        URL of the Bowser server, by default "http://localhost:8000"
    endpoint_params : dict, optional
        Additional parameters to be passed to the endpoint, by default {}

    Returns
    -------
    list[TileJSON]
        List of TileJSON objects from Bowser server.
        Can be converted to dicts with `model_dump()`.
    """
    out = []
    model1 = get_tile_url(
        file_list[0],
        minzoom=minzoom,
        maxzoom=maxzoom,
        bowser_url=bowser_url,
        endpoint=endpoint,
        **endpoint_params,
    )
    out.append(model1)
    resp1 = model1.model_dump()

    url1 = resp1["tiles"][0]
    query_str = "url=" + quote(str(file_list[0]), safe="")
    assert query_str in url1

    # for rest, replace quoted filename in url
    for fn in file_list[1:]:
        new_dict = copy.deepcopy(resp1)
        new_dict["tiles"][0] = url1.replace(query_str, f"url={quote(str(fn), safe='')}")
        out.append(TileJSON(**new_dict))
    return out
