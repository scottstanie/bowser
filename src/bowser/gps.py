"""FastAPI router for GPS station overlay with LOS projection.

Fetches GPS/GNSS station data via `geepers` and projects ENU
displacements into the radar Line-of-Sight direction.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import numpy as np
from fastapi import APIRouter, HTTPException, Query

if TYPE_CHECKING:
    from .manifest import LosConfig

logger = logging.getLogger("bowser.gps")

router = APIRouter(prefix="/gps", tags=["GPS Stations"])

_los_config: LosConfig | None = None
_gps_source = None  # geepers.gps_sources.UnrSource instance
_los_raster = None  # rioxarray DataArray for geotiff mode


def init_gps(los_config: LosConfig) -> None:
    """Initialize GPS data source and LOS configuration.

    Parameters
    ----------
    los_config
        LOS vector config from the manifest.
    """
    global _los_config, _gps_source, _los_raster

    from geepers.gps_sources import UnrSource

    _los_config = los_config
    _gps_source = UnrSource()

    if los_config.type == "geotiff" and los_config.source:
        import rioxarray  # noqa: F401
        import xarray as xr

        _los_raster = xr.open_dataarray(los_config.source)
        logger.info(f"Loaded LOS GeoTIFF: {los_config.source}")

    logger.info(f"GPS initialized with LOS type={los_config.type}")


def _get_los_vector(lon: float, lat: float) -> tuple[float, float, float]:
    """Get the LOS unit vector at a given location.

    Returns
    -------
    tuple[float, float, float]
        (east, north, up) components of ground-to-satellite unit vector.
    """
    assert _los_config is not None

    if _los_config.type == "constant":
        assert _los_config.los_enu is not None
        v = _los_config.los_enu
        return (v.east, v.north, v.up)
    else:
        assert _los_raster is not None
        enu = _los_raster.sel(x=lon, y=lat, method="nearest").values
        return (float(enu[0]), float(enu[1]), float(enu[2]))


def _project_enu_to_los(
    east: np.ndarray,
    north: np.ndarray,
    up: np.ndarray,
    los_e: float,
    los_n: float,
    los_u: float,
) -> np.ndarray:
    """Project ENU displacements to LOS via dot product.

    Parameters
    ----------
    east, north, up
        Displacement components in mm.
    los_e, los_n, los_u
        LOS unit vector components (ground-to-satellite).

    Returns
    -------
    np.ndarray
        LOS displacement in mm.
    """
    return east * los_e + north * los_n + up * los_u


@router.get("/los_info")
async def get_los_info() -> dict:
    """Return the current LOS configuration."""
    if _los_config is None:
        raise HTTPException(status_code=404, detail="No LOS config available")

    result: dict = {"type": _los_config.type}
    if _los_config.los_enu:
        result["east"] = _los_config.los_enu.east
        result["north"] = _los_config.los_enu.north
        result["up"] = _los_config.los_enu.up
    if _los_config.source:
        result["source"] = _los_config.source
    return result


@router.get("/stations")
async def get_stations(
    bbox: str = Query(..., description="Bounding box: west,south,east,north"),
) -> list[dict]:
    """List GPS stations within the bounding box."""
    if _gps_source is None:
        raise HTTPException(status_code=503, detail="GPS source not initialized")

    parts = [float(x) for x in bbox.split(",")]
    assert len(parts) == 4
    west, south, east, north = parts

    gdf = _gps_source.stations(bbox=(west, south, east, north))
    if gdf is None or len(gdf) == 0:
        return []

    stations = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        station_id = str(row.get("id", row.name))
        stations.append(
            {
                "id": station_id,
                "name": station_id,
                "lon": float(geom.x),
                "lat": float(geom.y),
            }
        )

    return stations


@router.get("/stations/{station_id}/timeseries")
async def get_station_timeseries(
    station_id: str,
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
) -> dict:
    """Get GPS timeseries for a station, projected to LOS.

    Returns both LOS-projected and raw ENU components.
    """
    if _gps_source is None:
        raise HTTPException(status_code=503, detail="GPS source not initialized")
    if _los_config is None:
        raise HTTPException(status_code=503, detail="No LOS config")

    try:
        df = _gps_source.timeseries(
            station_id,
            frame="ENU",
            start_date=start_date,
            end_date=end_date,
            zero_by="mean",
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Station {station_id}: {e}")

    if df is None or len(df) == 0:
        return {"station_id": station_id, "timeseries": []}

    # Get LOS vector at station location
    lon, lat = _gps_source.station_lonlat(station_id)
    los_e, los_n, los_u = _get_los_vector(lon, lat)

    # Convert ENU columns to mm (geepers returns meters)
    east_mm = df["east"].values * 1000.0
    north_mm = df["north"].values * 1000.0
    up_mm = df["up"].values * 1000.0

    los_mm = _project_enu_to_los(east_mm, north_mm, up_mm, los_e, los_n, los_u)

    # Build response with dates and all components
    dates = df.index.strftime("%Y-%m-%d").tolist()
    timeseries = []
    for i, date in enumerate(dates):
        if np.isnan(los_mm[i]):
            continue
        timeseries.append(
            {
                "date": date,
                "displacement": float(los_mm[i]),
                "east": float(east_mm[i]),
                "north": float(north_mm[i]),
                "up": float(up_mm[i]),
            }
        )

    return {
        "station_id": station_id,
        "station_name": station_id,
        "los_vector": {"east": los_e, "north": los_n, "up": los_u},
        "timeseries": timeseries,
    }
