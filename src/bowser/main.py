import json
import logging
import pathlib
import warnings
from typing import Annotated, Callable

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates
from titiler.core.algorithm import algorithms as default_algorithms
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.factory import TilerFactory

from .config import settings
from .readers import CustomReader
from .titiler import Amplitude, JSONResponse, Phase, RasterGroup, Rewrap, Shift
from .utils import desensitize_mpl_case, generate_colorbar

logger = logging.getLogger(__name__)
# Lots of this get spewed... unclear whether it's fixable on my end, or Titiler
warnings.filterwarnings("ignore", category=RuntimeWarning, message="invalid value encountered in cast")

# TODO: Use a `RotatingFileHandler`
h = logging.StreamHandler()
h.setLevel(settings.LOG_LEVEL)
h.setFormatter(
    logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%dT:%H:%M:%S",
    )
)
logger.addHandler(h)

template_dir = pathlib.Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=template_dir)

desensitize_mpl_case()

app = FastAPI(title="Bowser")


# Set up data read
# TODO: add a way to specify the data files from the UI
DATASETS: dict[str, RasterGroup] = {}

data_js_list = json.loads(pathlib.Path(settings.DATASET_CONFIG_FILE).read_text())
for d in data_js_list:
    rg = RasterGroup.model_validate(d)
    DATASETS[rg.name] = rg

logger.info(f"Found {len(DATASETS)} data config files: {DATASETS.keys()}")


# Make an endpoint to load the raster group info
@app.get("/datasets")
async def datasets():
    """Return the JSON describing the raster groups."""
    return DATASETS


async def _get_point_values(name: str, lon: float, lat: float) -> np.ndarray:
    return np.atleast_1d(DATASETS[name]._reader.read_lonlat(lon, lat))


@app.get(
    "/point",
    response_class=JSONResponse,
    responses={200: {"description": "Return the list of values for a point"}},
)
async def point(
    dataset_name: str,
    lon: Annotated[float, Query(..., title="Longitude", ge=-180, le=180)],
    lat: Annotated[float, Query(..., title="Latitude", ge=-90, le=90)],
):
    """Fetch list of time series values for a point."""
    values = await _get_point_values(dataset_name, lon, lat)
    return JSONResponse(values.tolist())


@app.get(
    "/chart_point",
    response_class=JSONResponse,
    responses={200: {"description": "Return the Chart.js-formatted data for a point"}},
)
async def chart_point(
    dataset_name: str,
    lon: Annotated[float, Query(..., title="Longitude", ge=-180, le=180)],
    lat: Annotated[float, Query(..., title="Latitude", ge=-90, le=90)],
    ref_lon: Annotated[
        float | None, Query(..., title="Reference longitude", ge=-180, le=180)
    ] = None,
    ref_lat: Annotated[
        float | None, Query(..., title="Reference latitude", ge=-90, le=90)
    ] = None,
):
    """Fetch the Chart.js time series values for a point (relative to a reference)."""
    d = DATASETS[dataset_name]
    x_values = d.x_values

    # The chart data format is:
    # data: {
    #   labels: ['2016-12-25', '2016-12-26', '2016-12-28', '2016-12-29', '2026-12-30',],
    #   datasets: [{data: [{ x: '2016-12-25', y: 20 }, { x: '2016-12-28', y: 10 },]}]
    # }
    def values_to_chart_data(values):
        """Convert values to chart data."""
        return [
            {"x": x, "y": y} for x, y in zip(x_values, np.atleast_1d(values).tolist())
        ]

    values = await _get_point_values(dataset_name, lon, lat)
    if ref_lon and ref_lat:
        ref_values = await _get_point_values(dataset_name, ref_lon, ref_lat)
        values -= ref_values
    dataset_item = values_to_chart_data(values.tolist())

    return JSONResponse({"datasets": [{"data": dataset_item}], "labels": x_values})


# FastAPI endpoint
@app.get("/colorbar/{cmap_name}")
async def get_colorbar(cmap_name: str):
    """Get a WEBP image of a matplotlib colorbar."""
    try:
        colorbar_bytes = generate_colorbar(cmap_name)
        return Response(content=colorbar_bytes, media_type="image/webp")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Set all CORS enabled origins
# if settings.BACKEND_CORS_ORIGINS:
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        # # https://github.com/pydantic/pydantic/issues/7186
        # str(origin).rstrip("/")
        # for origin in settings.BACKEND_CORS_ORIGINS
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


algorithms = default_algorithms.register(
    {"phase": Phase, "amplitude": Amplitude, "shift": Shift, "rewrap": Rewrap}
)

# Create a PostProcessParams dependency
PostProcessParams: Callable = algorithms.dependency


def InputDependency(
    url: Annotated[str, Query(description="Dataset URL")],
    mask: Annotated[str | None, Query(description="Mask URL")] = None,
    mask_min_value: Annotated[float, Query(description="Mask Minimum Value")] = 0.1,
) -> dict:
    """Create dataset path from args."""
    input_dict = {
        "data": url,
        "mask": mask,
        "mask_min_value": mask_min_value,
    }
    return input_dict


# Modify your TilerFactory to use the new CustomReader and InputDependency
# cog_endpoints = TilerFactory(process_dependency=PostProcessParams)
cog_endpoints = TilerFactory(
    reader=CustomReader,
    path_dependency=InputDependency,
    process_dependency=PostProcessParams,
)


# Register the COG endpoints to the application
app.include_router(cog_endpoints.router, tags=["Cloud Optimized GeoTIFF"])
add_exception_handlers(app, DEFAULT_STATUS_CODES)

# Add Bowser's HTML/JS files
dist_path = pathlib.Path(__file__).parent / "dist"
app.mount("/", StaticFiles(directory=dist_path, html=True))
