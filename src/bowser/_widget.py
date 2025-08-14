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

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def make_widgets(ifg_files: Sequence[str | Path], show_loading: bool = True):
    """Create the widgets for browsing a list of files/urls.

    Parameters
    ----------
    ifg_files : list[str | Path]
        List of files/urls to be tiled.
    show_loading : bool, optional
        Whether to show loading indicator when tiles are being processed by Titiler.
        By default True
    """
    # Get the tile urls from the Titiler server
    logger.info("Querying Titiler for tile urls...")
    tile_jsons = get_many_titiler_urls(ifg_files)
    # Parse files for dates
    date_pairs = [get_dates(f) for f in ifg_files]
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
    title = widgets.HTML(
        value=f"<h2>{date_pairs[cur_idx][0]} - {date_pairs[cur_idx][1]}</h2>"
    )
    # make the TileLayers in advance to load upon selection
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
    logger.info(tile_layers[0].url)
    # #### Control widgets ####
    date_idx_slider = widgets.IntSlider(value=0, min=0, max=len(tile_layers))

    def on_value_change(change):
        cur_idx = change["new"]
        title.value = f"<h2>{date_pairs[cur_idx][0]} - {date_pairs[cur_idx][1]}</h2>"
        m.remove_layer(m.layers[-1])
        m.add_layer(tile_layers[cur_idx])

    date_idx_slider.observe(on_value_change, names="value", type="change")
    # Finally, package the widgets into a VBox
    out_widget = widgets.VBox([title, date_idx_slider, m])
    return out_widget


def get_tile_url(
    url: str | Path,
    minzoom: int = 5,
    maxzoom: int = 13,
    endpoint: str = "cog/tilejson.json",
    titiler_url: str = "http://localhost:8885",
    **endpoint_params,
) -> TileJSON:
    """Get the local tiling URL to put on ipyleaflet.

    See https://developmentseed.org/titiler/titiler_urls/cog/#tilesjson

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
    titiler_url : str, optional
        URL of the Titiler server, by default "http://localhost:8885"
    endpoint_params : dict, optional
        Additional parameters to be passed to the endpoint, by default {}

    Returns
    -------
    TileJSON
        Model object from Titiler server.
        Can be converted to dict with `model_dump()`.
    """
    params = {
        "url": url,
        "minzoom": minzoom,
        "maxzoom": maxzoom,
        **endpoint_params,
    }
    resp = requests.get(
        # TODO: can possibly abstract this for a couple similar endpoints,
        # e.g. MosaicJSON
        f"{titiler_url}/{endpoint}",
        params=params,
    )
    return TileJSON(**resp.json())


def get_many_titiler_urls(
    file_list: Sequence[str | Path],
    minzoom: int = 5,
    maxzoom: int = 13,
    titiler_url: str = "http://localhost:8885",
    endpoint: str = "cog/tilejson.json",
    **endpoint_params,
) -> list[TileJSON]:
    """Query titiler for the tiling url, assuming all files are similar in structure.

    This function assumes that the Titiler response to the `/cog/tilejson.json` endpoint
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
    titiler_url : str, optional
        URL of the Titiler server, by default "http://localhost:8885"
    endpoint_params : dict, optional
        Additional parameters to be passed to the endpoint, by default {}

    Returns
    -------
    list[TilerJSON]
        List of TileJSON objects from Titiler server.
        Can be converted to dicts with `model_dump()`.
    """
    out = []
    model1 = get_tile_url(
        file_list[0],
        minzoom=minzoom,
        maxzoom=maxzoom,
        titiler_url=titiler_url,
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
