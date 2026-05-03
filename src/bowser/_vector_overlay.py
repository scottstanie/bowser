"""Vector AOI helpers: parse uploads, compute zonal statistics.

Implements the backend half of the vector-overlay feature
(https://github.com/opera-adt/bowser/issues/55):

- :func:`load_geojson` — read any pyogrio-supported file (GeoJSON / KML /
  KMZ / Shapefile-zip / GeoPackage), reproject to WGS84, return a plain
  GeoJSON ``FeatureCollection`` plus a bbox + feature count.
- :func:`zonal_stats_md` — given a GeoJSON geometry and an MD-mode
  ``xr.DataArray`` (any 2-D or 3-D variable), compute mean / median /
  std / percentiles / min / max / pixel count. For 3-D variables the
  stats are returned per-timestep so the frontend can plot a time series.
"""

from __future__ import annotations

import io
import logging
import tempfile
import warnings
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr
from pyproj import Transformer
from shapely import geometry as sgeom
from shapely.ops import transform as shapely_transform

logger = logging.getLogger("bowser")


# Suffixes pyogrio can read directly. ``.json`` is included because
# GeoJSON is sometimes saved as plain ``.json``; pyogrio's GeoJSON driver
# handles both.
_DIRECT_SUFFIXES = {".geojson", ".json", ".kml", ".kmz", ".gpkg"}


@dataclass
class LoadedVector:
    """Result of parsing an uploaded vector file."""

    # GeoJSON ``FeatureCollection`` already reprojected to WGS84.
    geojson: dict[str, Any]
    # WGS84 bbox: (lon_min, lat_min, lon_max, lat_max).
    bbox: tuple[float, float, float, float]
    n_features: int


def load_geojson(raw: bytes, filename: str) -> LoadedVector:
    """Parse uploaded vector bytes into a WGS84 GeoJSON FeatureCollection.

    Parameters
    ----------
    raw : bytes
        Bytes of the uploaded file.
    filename : str
        Original filename — used to pick a driver (suffix).

    Raises
    ------
    ValueError
        On unsupported formats (e.g. bare ``.shp`` without sidecars) or
        when pyogrio fails to read.
    """
    suffix = Path(filename).suffix.lower()
    with tempfile.TemporaryDirectory(prefix="bowser_vec_") as td:
        tmp_dir = Path(td)
        if suffix == ".zip":
            # Shapefile-as-zip — extract; require the .shp + sidecars to live
            # together inside the archive.
            shp_path = _extract_shapefile_zip(raw, tmp_dir)
            src_path = shp_path
        elif suffix == ".shp":
            raise ValueError(
                "Bare .shp uploads are not supported — please zip the .shp + "
                ".shx + .dbf (+ optional .prj) together and upload the .zip."
            )
        elif suffix in _DIRECT_SUFFIXES:
            src_path = tmp_dir / f"upload{suffix}"
            src_path.write_bytes(raw)
        else:
            raise ValueError(
                f"Unsupported vector format {suffix!r}. Supported: "
                ".geojson, .json, .kml, .kmz, .gpkg, .zip (Shapefile)"
            )

        return _read_to_wgs84_geojson(src_path)


def _extract_shapefile_zip(raw: bytes, tmp_dir: Path) -> Path:
    """Extract a zip into ``tmp_dir`` and return the path to the .shp inside."""
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        zf.extractall(tmp_dir)

    shps = list(tmp_dir.rglob("*.shp"))
    if not shps:
        raise ValueError(
            "Zip did not contain a .shp file — expected an Esri Shapefile "
            "with .shp/.shx/.dbf siblings."
        )
    if len(shps) > 1:
        raise ValueError(
            f"Zip contained multiple .shp files: {[s.name for s in shps]}. "
            "Upload one shapefile per zip."
        )
    return shps[0]


def _read_to_wgs84_geojson(path: Path) -> LoadedVector:
    """Read a vector file via pyogrio, reproject to WGS84, return GeoJSON."""
    from pyogrio import read_info  # noqa: PLC0415 — heavy import, lazy
    from pyogrio.raw import read as pyogrio_read  # noqa: PLC0415
    from shapely import wkb as _wkb  # noqa: PLC0415

    info = read_info(path)
    if info.get("features", 0) == 0:
        raise ValueError(f"{path.name}: file contains 0 features")

    # pyogrio.raw.read keeps the dep light (no geopandas needed); it
    # returns geometries as WKB bytes which shapely.wkb.loads decodes.
    meta, _fids, geometry_wkb, fields = pyogrio_read(path)
    src_crs = meta.get("crs")
    if geometry_wkb is None:
        raise ValueError(f"{path.name}: no geometry column found")
    geoms = [_wkb.loads(bytes(g)) if g is not None else None for g in geometry_wkb]

    if src_crs and src_crs != "EPSG:4326":
        # Reproject to WGS84 — the bowser frontend expects lon/lat for
        # Leaflet, and the polygon-stats endpoint reprojects on the fly to
        # the dataset's CRS anyway.
        tr = Transformer.from_crs(src_crs, "EPSG:4326", always_xy=True)

        def _reproject(x, y, z=None):
            x_arr = np.asarray(x)
            y_arr = np.asarray(y)
            x_out, y_out = tr.transform(x_arr, y_arr)
            return (x_out, y_out) if z is None else (x_out, y_out, z)

        geoms = [shapely_transform(_reproject, g) if g else None for g in geoms]

    properties_by_feature = _build_properties(meta, fields)
    features: list[dict[str, Any]] = []
    for i, g in enumerate(geoms):
        if g is None or g.is_empty:
            continue
        props = properties_by_feature[i] if i < len(properties_by_feature) else {}
        features.append(
            {
                "type": "Feature",
                "geometry": sgeom.mapping(g),
                "properties": props,
            }
        )

    if not features:
        raise ValueError(f"{path.name}: no non-empty geometries")

    fc = {"type": "FeatureCollection", "features": features}
    bbox = _features_bbox(features)
    return LoadedVector(geojson=fc, bbox=bbox, n_features=len(features))


def _build_properties(meta: dict[str, Any], fields: Any) -> list[dict[str, Any]]:
    """Reshape pyogrio's columnar fields into per-feature property dicts.

    pyogrio's ``raw.read`` returns the field columns as a list (or tuple)
    of ndarrays in the same order as ``meta["fields"]``; older versions
    sometimes return a dict. Handle both shapes defensively.
    """
    raw_names = meta.get("fields")
    if raw_names is None:
        return []
    field_names: list[str] = [str(n) for n in raw_names]
    if not field_names:
        return []
    if isinstance(fields, dict):
        cols = [fields[name] for name in field_names]
    elif isinstance(fields, (list, tuple)):
        cols = list(fields)
    else:
        return []
    n = len(cols[0]) if cols else 0
    out: list[dict[str, Any]] = []
    for i in range(n):
        row: dict[str, Any] = {}
        for name, col in zip(field_names, cols):
            v = col[i]
            # Python-native types only — JSON-friendly.
            if isinstance(v, (np.integer,)):
                row[name] = int(v)
            elif isinstance(v, (np.floating,)):
                row[name] = float(v) if np.isfinite(v) else None
            elif isinstance(v, np.bool_):
                row[name] = bool(v)
            elif isinstance(v, (bytes, np.bytes_)):
                row[name] = v.decode("utf-8", errors="replace")
            elif isinstance(v, np.datetime64):
                # KML/GeoPackage drivers return timestamp/begin/end columns
                # as datetime64[ms]; NaT shows up as a non-finite value.
                # Convert to ISO 8601 strings so the JSON dump survives.
                row[name] = None if np.isnat(v) else np.datetime_as_string(v)
            else:
                row[name] = v
        out.append(row)
    return out


def _features_bbox(
    features: list[dict[str, Any]],
) -> tuple[float, float, float, float]:
    """Compute the WGS84 bounding box of a GeoJSON feature list."""
    lon_min = lat_min = float("inf")
    lon_max = lat_max = float("-inf")
    for feat in features:
        geom = sgeom.shape(feat["geometry"])
        b = geom.bounds  # (minx, miny, maxx, maxy)
        lon_min = min(lon_min, b[0])
        lat_min = min(lat_min, b[1])
        lon_max = max(lon_max, b[2])
        lat_max = max(lat_max, b[3])
    return (lon_min, lat_min, lon_max, lat_max)


def zonal_stats_md(
    da: xr.DataArray,
    geometry: dict[str, Any],
    geometry_crs: str = "EPSG:4326",
    *,
    all_touched: bool = True,
) -> dict[str, Any]:
    """Compute zonal stats on an MD-mode DataArray inside a GeoJSON geometry.

    Returns a dict with summary stats (over all valid pixels at every
    timestep) and, when ``da`` is 3-D, a per-timestep stat series.

    Parameters
    ----------
    da : xr.DataArray
        Either 2-D ``(y, x)`` or 3-D ``(time-like, y, x)``. Must carry a CRS
        via ``rio.crs`` (callers should run ``ds.rio.write_crs`` before).
    geometry : dict
        GeoJSON ``Geometry`` (Polygon / MultiPolygon supported).
    geometry_crs : str
        CRS of the input geometry. Default WGS84 since the upload pipeline
        always normalises to it.
    all_touched : bool
        Pass through to ``rasterio.features.geometry_mask``. ``True`` means
        any pixel the polygon touches is included; ``False`` requires the
        pixel center to be inside.
    """
    if da.rio.crs is None:
        raise ValueError("DataArray has no CRS; call ds.rio.write_crs(...) first.")

    geom = sgeom.shape(geometry)
    if geom.is_empty:
        raise ValueError("Empty geometry")

    # Reproject the geometry to the dataset CRS once. Cheaper than
    # reprojecting every pixel.
    if geometry_crs != da.rio.crs.to_string():
        tr = Transformer.from_crs(geometry_crs, da.rio.crs, always_xy=True)

        def _reproject(x, y, z=None):
            x_arr = np.asarray(x)
            y_arr = np.asarray(y)
            x_out, y_out = tr.transform(x_arr, y_arr)
            return (x_out, y_out) if z is None else (x_out, y_out, z)

        geom = shapely_transform(_reproject, geom)

    # Crop to the bounding box first so we only rasterise the polygon over
    # the small window — orders of magnitude cheaper for tiny AOIs over
    # continent-sized cubes.
    minx, miny, maxx, maxy = geom.bounds
    da_x = da.x.values
    da_y = da.y.values
    res_x = float(abs(da_x[1] - da_x[0])) if da_x.size > 1 else 0.0
    res_y = float(abs(da_y[1] - da_y[0])) if da_y.size > 1 else 0.0
    pad_x = res_x  # one-pixel halo so geometry_mask's edges line up
    pad_y = res_y

    x_slice = da.x.sel(x=slice(minx - pad_x, maxx + pad_x))
    # y can be ascending or descending — use the dataset's own ordering.
    y_first, y_last = float(da.y[0]), float(da.y[-1])
    if y_first > y_last:
        y_slice = da.y.sel(y=slice(maxy + pad_y, miny - pad_y))
    else:
        y_slice = da.y.sel(y=slice(miny - pad_y, maxy + pad_y))
    if x_slice.size == 0 or y_slice.size == 0:
        raise ValueError("Geometry does not intersect dataset extent")
    window = da.sel(x=x_slice, y=y_slice)

    # Build the rasterio.features.geometry_mask. Need the affine transform
    # of the WINDOW (top-left x/y, signed pixel size).
    from affine import Affine  # noqa: PLC0415 — already a transitive dep
    from rasterio.features import geometry_mask  # noqa: PLC0415

    window_y = window.y.values
    window_x = window.x.values
    # Pixel-center coords → top-left edge for the affine.
    x0 = float(window_x[0]) - res_x / 2.0
    if y_first > y_last:
        y0 = float(window_y[0]) + res_y / 2.0
        sy = -res_y
    else:
        y0 = float(window_y[0]) - res_y / 2.0
        sy = res_y
    transform = Affine(res_x, 0.0, x0, 0.0, sy, y0)

    # geometry_mask returns True OUTSIDE the geometry by default; invert.
    inside = ~geometry_mask(
        [sgeom.mapping(geom)],
        out_shape=(window.sizes["y"], window.sizes["x"]),
        transform=transform,
        all_touched=all_touched,
        invert=False,
    )
    n_inside = int(inside.sum())
    if n_inside == 0:
        raise ValueError("No pixels intersect the geometry")

    # Pull the values; mask once.
    vals = np.asarray(window.values, dtype="float64")
    if vals.ndim == 2:
        vals = vals[np.newaxis, ...]  # treat as 1-step "time series"
        is_2d = True
    else:
        is_2d = False
    mask3d = np.broadcast_to(inside, vals.shape)
    masked = np.where(mask3d, vals, np.nan)

    summary = _summary_stats(masked.flatten(), n_inside)
    out: dict[str, Any] = {"summary": summary, "n_pixels": n_inside}

    if not is_2d:
        # Per-timestep stats so the frontend can draw a time series.
        labels = _series_labels(da)
        per_time = [
            _summary_stats(masked[t].ravel(), n_inside) for t in range(vals.shape[0])
        ]
        out["time"] = labels
        out["series"] = per_time

    return out


def _summary_stats(values: np.ndarray, n_pixels: int) -> dict[str, float | int]:
    """Compute the basic stat bundle on a flat array of (possibly NaN) values."""
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        return {
            "mean": float("nan"),
            "median": float("nan"),
            "std": float("nan"),
            "min": float("nan"),
            "max": float("nan"),
            "p5": float("nan"),
            "p25": float("nan"),
            "p75": float("nan"),
            "p95": float("nan"),
            "count_valid": 0,
            "count_total": int(n_pixels),
        }
    with warnings.catch_warnings():
        # All-NaN slice can still bite us via percentile when valid is empty,
        # but we already short-circuited above — silence the residual.
        warnings.simplefilter("ignore", RuntimeWarning)
        p5, p25, p75, p95 = np.percentile(valid, [5, 25, 75, 95])
        return {
            "mean": float(np.mean(valid)),
            "median": float(np.median(valid)),
            "std": float(np.std(valid)),
            "min": float(np.min(valid)),
            "max": float(np.max(valid)),
            "p5": float(p5),
            "p25": float(p25),
            "p75": float(p75),
            "p95": float(p95),
            "count_valid": int(valid.size),
            "count_total": int(n_pixels),
        }


def _series_labels(da: xr.DataArray) -> list[str]:
    """Return the non-spatial dim's coord values rendered as strings.

    Mirrors ``main._dim_labels`` lightly — kept local so this module
    doesn't pull main.py at import time. Used to label per-timestep stats.
    """
    non_spatial = [d for d in da.dims if d not in ("x", "y")]
    if not non_spatial:
        return []
    dim = non_spatial[0]
    coord = da.coords.get(dim)
    if coord is None:
        return [str(i) for i in range(da.sizes[dim])]
    arr = np.asarray(coord.values)
    if np.issubdtype(arr.dtype, np.datetime64):
        return [str(np.datetime_as_string(t, unit="D")) for t in arr]
    return [str(v) for v in arr.tolist()]


def stats_to_csv(stats: dict[str, Any]) -> str:
    """Render the ``zonal_stats_md`` output as a CSV string for download.

    For 2-D variables: a single row of summary stats.
    For 3-D variables: a column-per-stat table indexed by ``time``.
    """
    cols = [
        "mean",
        "median",
        "std",
        "min",
        "max",
        "p5",
        "p25",
        "p75",
        "p95",
        "count_valid",
        "count_total",
    ]
    rows: list[list[str]] = []
    if "series" in stats:
        header = ["time", *cols]
        for label, row in zip(stats["time"], stats["series"]):
            rows.append([label] + [_csv_cell(row.get(c)) for c in cols])
    else:
        header = cols[:]
        rows.append([_csv_cell(stats["summary"].get(c)) for c in cols])

    out_lines = [",".join(header)]
    out_lines.extend(",".join(r) for r in rows)
    return "\n".join(out_lines) + "\n"


def _csv_cell(v: Any) -> str:
    """Render a stat value into a CSV cell — empty for NaN."""
    if v is None:
        return ""
    if isinstance(v, float) and not np.isfinite(v):
        return ""
    return str(v)
