"""Convert a set of MintPy ``.h5`` files into a single GeoZarr store.

Invoked via the ``bowser prepare-mintpy`` CLI subcommand. Lives as its own
module so heavy scientific-stack imports (h5py / numpy / xarray /
rasterio / numcodecs) stay out of ``bowser --help``.

Approach
--------
MintPy stacks are already a clean cube with CRS metadata in the file
attrs. We open each ``.h5`` directly with ``h5py``, read the geographic
attrs (``X_FIRST``/``Y_FIRST``/``X_STEP``/``Y_STEP``/``EPSG``) once,
assemble an ``xarray.Dataset`` (one variable per known dataset; a
``timeseries`` 3D var on its own ``time`` dim from ``/date``), and hand
it to the same ``shard_encoding`` / ``build_pyramid`` / ``annotate_store``
machinery that ``tifs-to-geozarr`` uses.

That sidesteps the GDAL netcdf driver, which doesn't read MintPy's custom
geographic attrs — going through ``process_netcdf_files`` would still
need a fixup pass to attach a CRS, so direct is cleaner.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import xarray as xr

from .geozarr import (
    ZarrWriteConfig,
    annotate_store,
    build_pyramid,
    shard_encoding,
)

logger = logging.getLogger(__name__)


# Known MintPy variables we know how to label / unit. Anything else found
# inside a recognised file falls back to its dataset name and the file's
# ``UNIT`` root attribute (or no units at all).
#
# Source: https://mintpy.readthedocs.io/en/latest/api/data_structure/
_VAR_META: dict[str, tuple[str, str | None]] = {
    # (long_name, units)
    "timeseries": ("Cumulative displacement", "m"),
    "velocity": ("Velocity", "m/year"),
    "velocityStd": ("Velocity standard deviation", "m/year"),
    "annualAmplitude": ("Annual amplitude", "m"),
    "annualPhase": ("Annual phase", "radian"),
    "acceleration": ("Acceleration", "m/year^2"),
    "accelerationStd": ("Acceleration standard deviation", "m/year^2"),
    "temporalCoherence": ("Temporal coherence", None),
    "avgSpatialCoherence": ("Average spatial coherence", None),
    "mask": ("Mask", None),
    "maskTempCoh": ("Temporal coherence mask", None),
    "maskPS": ("Persistent scatterer mask", None),
    "height": ("Height", "m"),
    "incidenceAngle": ("Incidence angle", "degree"),
    "azimuthAngle": ("Azimuth angle", "degree"),
    "slantRangeDistance": ("Slant range distance", "m"),
    "shadowMask": ("Shadow mask", None),
    "waterMask": ("Water mask", None),
    "dem": ("DEM", "m"),
    "magnitude": ("Magnitude", None),
}


@contextmanager
def _timed(label: str):
    """Log elapsed wall time for a named phase."""
    t0 = time.perf_counter()
    yield
    logger.info("%s: %.2fs", label, time.perf_counter() - t0)


@dataclass
class _SpatialRef:
    """Geographic reference parsed from a MintPy file's root attrs."""

    height: int
    width: int
    x_first: float
    y_first: float
    x_step: float
    y_step: float
    crs_wkt: str  # WKT for the file's CRS, or "" if undeclared

    @property
    def x_coords(self) -> np.ndarray:
        # Pixel-center: matches _tifs_to_geozarr._load_spatial_ref so coords
        # align with anything produced by the GeoTIFF path.
        return (np.arange(self.width) + 0.5) * self.x_step + self.x_first

    @property
    def y_coords(self) -> np.ndarray:
        return (np.arange(self.height) + 0.5) * self.y_step + self.y_first


def convert(
    h5_files: Iterable[str | Path],
    output: str,
    chunk: int,
    shard_factor: int,
    compression: str,
    compression_level: int,
    quantize_digits: int,
    quantize_patterns: str,
    pyramid: bool,
    min_pyramid_size: int,
    verbose: int,
) -> list[str]:
    """Run the conversion; returns the list of variable names written."""
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING)

    files = [Path(f) for f in h5_files]
    assert files, "No MintPy .h5 files supplied"

    write_cfg = ZarrWriteConfig(
        chunk=chunk,
        shard_factor=shard_factor,
        compression_name=compression,  # type: ignore[arg-type]
        compression_level=compression_level,
        quantize_digits=quantize_digits if quantize_digits > 0 else None,
        quantize_patterns=tuple(
            p.strip() for p in quantize_patterns.split(",") if p.strip()
        ),
    )

    # 1. Read every file's variables into memory and assemble one Dataset.
    #    MintPy files are typically a few-hundred-MB at most per file; even a
    #    large basin timeseries fits comfortably in RAM on any dev box, and the
    #    direct approach avoids the per-variable streaming gymnastics
    #    _tifs_to_geozarr.py needs for many-thousand-tile stacks.
    with _timed("load h5"):
        ds, ref = _build_dataset(files)
    logger.info(
        "Assembled Dataset: %s (vars=%d, %d×%d)",
        list(ds.data_vars),
        len(ds.data_vars),
        ref.height,
        ref.width,
    )

    group = "0" if pyramid else None

    # 2. Write level-0 in one shot. xarray + rio handle the spatial_ref
    #    variable; we stamp grid_mapping / long_name / units per data var.
    with _timed("write level-0"):
        encoding = shard_encoding(ds, write_cfg)
        ds.to_zarr(output, group=group, mode="w", consolidated=False, encoding=encoding)

    # 3. Optional 2×2-mean pyramid. Pass the in-memory Dataset to skip the
    #    re-read + dask-graph overhead build_pyramid would do otherwise.
    multiscales_levels: list[dict] | None = None
    if pyramid:
        min_y = ds.sizes["y"] // 2
        min_x = ds.sizes["x"] // 2
        if min_y < min_pyramid_size or min_x < min_pyramid_size:
            logger.info(
                "Skipping pyramid: half-res (%d×%d) below --min-pyramid-size %d",
                min_y,
                min_x,
                min_pyramid_size,
            )
            multiscales_levels = [{"asset": "0"}]
        else:
            with _timed("build pyramid"):
                multiscales_levels = build_pyramid(
                    output,
                    level0="0",
                    min_size=min_pyramid_size,
                    config=write_cfg,
                    level_0_ds=ds,
                )

    # 4. GeoZarr root attrs — spatial:/proj:/multiscales.
    with _timed("annotate_store"):
        annotate_store(
            output,
            data_group=group,
            multiscales_levels=multiscales_levels,
        )

    return sorted(str(name) for name in ds.data_vars)


def _build_dataset(files: list[Path]) -> tuple[xr.Dataset, _SpatialRef]:
    """Open every MintPy file and assemble one Dataset on a shared y/x grid."""
    import rioxarray  # noqa: F401, PLC0415  (registers the .rio accessor)

    _ = rioxarray  # silence "imported but unused" — the import is for side effects

    ref: _SpatialRef | None = None
    data_vars: dict[str, xr.DataArray] = {}
    coords: dict[str, np.ndarray] = {}

    for f in files:
        with h5py.File(f, "r") as hf:
            attrs = _decode_attrs(hf.attrs)
            file_ref = _spatial_ref_from_attrs(attrs, source=str(f))
            if ref is None:
                ref = file_ref
            else:
                _assert_same_grid(ref, file_ref, str(f))

            for name in hf.keys():
                node = hf[name]
                if not isinstance(node, h5py.Dataset):
                    continue
                shape = node.shape
                if shape == (ref.height, ref.width):
                    arr = np.asarray(node[...])
                    data_vars[name] = _wrap_2d(name, arr, attrs)
                elif (
                    len(shape) == 3
                    and shape[1:] == (ref.height, ref.width)
                    and name == "timeseries"
                ):
                    # Only the canonical /timeseries dataset gets a real time
                    # dim — pulled from /date in the same file.
                    date_node = hf.get("date")
                    if not isinstance(date_node, h5py.Dataset):
                        raise ValueError(
                            f"{f}: /timeseries present but /date is missing — "
                            "can't build the time coordinate."
                        )
                    times = _parse_dates(np.asarray(date_node[...]))
                    coords["time"] = times
                    arr = np.asarray(node[...])
                    data_vars[name] = _wrap_3d(name, arr, attrs, times)
                else:
                    logger.debug(
                        "Skipping %s/%s: shape %s doesn't match (y, x)=(%d, %d)",
                        f,
                        name,
                        shape,
                        ref.height,
                        ref.width,
                    )

    if ref is None or not data_vars:
        raise ValueError(
            "No MintPy variables found on the expected (y, x) grid across "
            f"{[str(f) for f in files]}"
        )

    coords["y"] = ref.y_coords
    coords["x"] = ref.x_coords

    ds = xr.Dataset(data_vars, coords=coords)
    if ref.crs_wkt:
        ds = ds.rio.write_crs(ref.crs_wkt)
        # rio.write_crs strips grid_mapping from data var attrs (it owns the
        # CRS bookkeeping itself). Re-stamp it explicitly: GeoZarr / CF
        # readers downstream rely on grid_mapping="spatial_ref" to find the
        # CRS variable. Mirrors what _tifs_to_geozarr.py does at line 484.
        for name in data_vars:
            ds[name].attrs["grid_mapping"] = "spatial_ref"
    return ds, ref


def _decode_attrs(h5_attrs) -> dict[str, str]:
    """Return a string-valued dict from an ``h5py.AttributeManager``.

    h5py returns bytes for fixed-length string attrs (a common MintPy
    pattern); we decode once here so callers can use plain ``str.strip()``
    and friends.
    """
    out: dict[str, str] = {}
    for k, v in h5_attrs.items():
        if isinstance(v, bytes):
            out[k] = v.decode("utf-8", errors="replace")
        elif isinstance(v, np.ndarray):
            out[k] = v.item() if v.shape == () else str(v.tolist())
        else:
            out[k] = str(v)
    return out


def _spatial_ref_from_attrs(attrs: dict[str, str], *, source: str) -> _SpatialRef:
    """Build a ``_SpatialRef`` from MintPy root attrs.

    Raises if the file isn't geocoded (no ``X_FIRST``) — bowser only serves
    geographic data today, so radarcoded MintPy files aren't supported.
    """
    if "X_FIRST" not in attrs:
        raise ValueError(
            f"{source}: missing X_FIRST root attribute — "
            "bowser prepare-mintpy only supports geocoded MintPy stacks."
        )

    height = int(float(attrs["LENGTH"]))
    width = int(float(attrs["WIDTH"]))
    x_first = float(attrs["X_FIRST"])
    y_first = float(attrs["Y_FIRST"])
    x_step = float(attrs["X_STEP"])
    y_step = float(attrs["Y_STEP"])
    crs_wkt = _resolve_crs_wkt(attrs)
    return _SpatialRef(
        height=height,
        width=width,
        x_first=x_first,
        y_first=y_first,
        x_step=x_step,
        y_step=y_step,
        crs_wkt=crs_wkt,
    )


def _resolve_crs_wkt(attrs: dict[str, str]) -> str:
    """Resolve a CRS WKT string from MintPy root attrs.

    Order matches MintPy's own preference: explicit ``EPSG`` first, then
    ``UTM_ZONE`` (zone number + N/S hemisphere). Falls back to plain
    geographic WGS84 when ``X_UNIT`` is ``degrees`` and nothing else is
    declared. Returns ``""`` if no CRS can be inferred — caller decides
    what to do.
    """
    from pyproj import CRS  # noqa: PLC0415 — already a transitive dep

    epsg = attrs.get("EPSG", "").strip()
    if epsg:
        return CRS.from_epsg(int(float(epsg))).to_wkt()

    utm = attrs.get("UTM_ZONE", "").strip()
    if utm:
        # MintPy convention: digits + optional N/S. Default N when omitted.
        zone_str = "".join(c for c in utm if c.isdigit())
        hemi = utm[-1].upper() if utm and utm[-1].upper() in ("N", "S") else "N"
        if zone_str:
            zone = int(zone_str)
            base = 32600 if hemi == "N" else 32700
            return CRS.from_epsg(base + zone).to_wkt()

    if attrs.get("X_UNIT", "").strip().lower().startswith("degree"):
        return CRS.from_epsg(4326).to_wkt()

    return ""


def _assert_same_grid(ref: _SpatialRef, other: _SpatialRef, source: str) -> None:
    """Hard-fail if a second file's grid doesn't match the first."""
    if (ref.height, ref.width) != (other.height, other.width):
        raise ValueError(
            f"{source}: grid {other.height}×{other.width} != "
            f"reference {ref.height}×{ref.width}"
        )
    # 1e-9 deg ≈ 1e-4 m; far below any meaningful step.
    for lhs, rhs, name in (
        (ref.x_first, other.x_first, "X_FIRST"),
        (ref.y_first, other.y_first, "Y_FIRST"),
        (ref.x_step, other.x_step, "X_STEP"),
        (ref.y_step, other.y_step, "Y_STEP"),
    ):
        if not np.isclose(lhs, rhs, rtol=0, atol=1e-9):
            raise ValueError(f"{source}: {name} {rhs} != reference {lhs}")
    if ref.crs_wkt and other.crs_wkt and ref.crs_wkt != other.crs_wkt:
        # Plain WKT inequality is too strict (whitespace can differ); compare
        # via pyproj's structural equality.
        from pyproj import CRS  # noqa: PLC0415

        if CRS.from_wkt(ref.crs_wkt) != CRS.from_wkt(other.crs_wkt):
            raise ValueError(f"{source}: CRS does not match the first file's CRS")


def _parse_dates(raw: np.ndarray) -> np.ndarray:
    """Decode a MintPy /date array (bytes-string YYYYMMDD) to datetime64[ns]."""
    if raw.dtype.kind == "S":
        strs = [s.decode("ascii") for s in raw.tolist()]
    else:
        strs = [str(s) for s in raw.tolist()]
    return pd.to_datetime(strs, format="%Y%m%d").to_numpy()


def _wrap_2d(name: str, arr: np.ndarray, file_attrs: dict[str, str]) -> xr.DataArray:
    return xr.DataArray(
        arr,
        dims=("y", "x"),
        name=name,
        attrs=_var_attrs(name, file_attrs),
    )


def _wrap_3d(
    name: str, arr: np.ndarray, file_attrs: dict[str, str], times: np.ndarray
) -> xr.DataArray:
    # Sort by time so chart code that assumes monotonic time still works,
    # mirroring what _tifs_to_geozarr does with date-derived dims.
    order = np.argsort(times)
    arr = arr[order]
    return xr.DataArray(
        arr,
        dims=("time", "y", "x"),
        coords={"time": times[order]},
        name=name,
        attrs=_var_attrs(name, file_attrs),
    )


def _var_attrs(name: str, file_attrs: dict[str, str]) -> dict[str, str]:
    """Build per-variable attrs (grid_mapping/long_name/units)."""
    attrs: dict[str, str] = {"grid_mapping": "spatial_ref"}
    long_name, units = _VAR_META.get(name, (name, None))
    attrs["long_name"] = long_name
    if units is None:
        # Fall back to the file-level UNIT attr (MintPy writes one for
        # files like temporalCoherence.h5 even when it's "1").
        units = file_attrs.get("UNIT", "").strip() or None
    if units:
        attrs["units"] = units
    return attrs
