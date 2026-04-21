"""Convert a ``bowser_rasters.json`` set of GeoTIFFs into a single GeoZarr store.

Reads the ``RasterGroup`` JSON config produced by ``bowser set-data`` /
``bowser setup-dolphin`` and produces one consolidated zarr with:

- one variable per group (2D for single-file groups; 3D for multi-file groups)
- a ``time`` dim when all files share a common reference date (linear time series)
- a ``pair`` integer index + ``reference_date_*`` / ``secondary_date_*`` /
  ``pair_label_*`` coords for groups that are inherently date-pairs without a
  shared ref (e.g. ``unwrapped``)
- GeoZarr ``spatial:`` / ``proj:`` / ``zarr_conventions`` root attributes
- optional multiscale pyramid (``--pyramid``): levels written to ``/0``, ``/1``,
  ``/2``, … subgroups; root carries the ``multiscales`` convention attrs

Read path: one ``ProcessPoolExecutor`` worker per raster group, each using
plain ``rasterio.open(f).read(1)`` into a pre-allocated numpy stack. No dask,
no rioxarray lazy graph, no xarray IO lock. Profiling of the previous
dask-backed path showed ~80% of wall time spent with idle threadpool workers
and ~26% of active time blocked on ``xarray/backends/locks.py:__enter__`` —
those are what this rewrite removes.

Usage
-----
    python scripts/tifs_to_geozarr.py bowser_rasters.json cube.zarr
    python scripts/tifs_to_geozarr.py bowser_rasters.json cube.zarr --pyramid
"""

from __future__ import annotations

import json
import logging
import os
import time
from concurrent.futures import ProcessPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import click
import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from opera_utils import get_dates

from bowser.geozarr import (
    DEFAULT_CHUNK,
    DEFAULT_COMPRESSION_LEVEL,
    DEFAULT_COMPRESSION_NAME,
    DEFAULT_SHARD_FACTOR,
    annotate_store,
    build_pyramid,
    shard_encoding,
)

logger = logging.getLogger("tifs_to_geozarr")


@contextmanager
def _timed(label: str):
    """Log elapsed wall time for a named phase. Runs at INFO level (-v)."""
    t0 = time.perf_counter()
    yield
    logger.info("%s: %.2fs", label, time.perf_counter() - t0)


@click.command()
@click.argument("config", type=click.Path(exists=True, dir_okay=False))
@click.argument("output", type=click.Path())
@click.option(
    "--chunk",
    default=DEFAULT_CHUNK,
    show_default=True,
    type=int,
    help="Square chunk edge (pixels) along y and x.",
)
@click.option(
    "--shard-factor",
    default=DEFAULT_SHARD_FACTOR,
    show_default=True,
    type=click.IntRange(1, 64),
    help=(
        "Shard shape = chunk × factor on every dim. "
        "4× bundles 1024×1024 pixel blocks (16 chunks) per shard on y/x and "
        "4 timesteps per shard on non-spatial dims — one HTTP GET per shard. "
        "Set to 1 to disable sharding entirely (fastest local write; more "
        "files on disk)."
    ),
)
@click.option(
    "--compression",
    default=DEFAULT_COMPRESSION_NAME,
    show_default=True,
    type=click.Choice(["lz4", "lz4hc", "blosclz", "snappy", "zlib", "zstd"]),
    help=(
        "Blosc sub-codec. lz4 is ~6× faster than zstd at ~10% worse ratio; "
        "zstd clevel 3 is a good middle ground."
    ),
)
@click.option(
    "--compression-level",
    default=DEFAULT_COMPRESSION_LEVEL,
    show_default=True,
    type=click.IntRange(1, 9),
    help="Compression level (1=fastest, 9=smallest).",
)
@click.option(
    "--workers",
    default=0,
    show_default=True,
    type=int,
    help=(
        "Parallel worker processes — one variable per worker. "
        "0 = min(len(variables), cpu_count())."
    ),
)
@click.option(
    "--pyramid/--no-pyramid",
    default=False,
    show_default=True,
    help="Write level-0 data to /0 and build coarsened /1, /2, … overview groups.",
)
@click.option(
    "--min-pyramid-size",
    default=256,
    show_default=True,
    type=int,
    help="Stop building pyramid when min(y, x) drops below this.",
)
@click.option("-v", "--verbose", count=True)
def main(
    config: str,
    output: str,
    chunk: int,
    shard_factor: int,
    compression: str,
    compression_level: int,
    workers: int,
    pyramid: bool,
    min_pyramid_size: int,
    verbose: int,
) -> None:
    """Convert CONFIG (bowser_rasters.json) into OUTPUT (single zarr store)."""
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING)
    groups_cfg = [g for g in json.loads(Path(config).read_text()) if g.get("file_list")]
    assert groups_cfg, f"No non-empty raster groups in {config}"

    # Spatial reference comes from the first file of the first group — all groups
    # are assumed to be co-registered (the converter would break silently otherwise,
    # so fail loudly on shape/CRS mismatch inside the worker).
    ref = _load_spatial_ref(groups_cfg[0]["file_list"][0])

    n_workers = workers or min(len(groups_cfg), os.cpu_count() or 4)
    logger.info("Loading %d variables with %d workers", len(groups_cfg), n_workers)
    loaded: list[_Loaded]
    with _timed("read (all variables, parallel)"):
        if n_workers == 1:
            loaded = [_load_group(g, ref) for g in groups_cfg]
        else:
            with ProcessPoolExecutor(max_workers=n_workers) as pool:
                loaded = list(
                    pool.map(_load_group, groups_cfg, [ref] * len(groups_cfg))
                )

    bytes_in = sum(lv.array.nbytes for lv in loaded)
    logger.info("Loaded %.2f GiB across %d vars", bytes_in / 2**30, len(loaded))

    with _timed("assemble xr.Dataset"):
        ds = _assemble_dataset(loaded, ref)
    encoding = shard_encoding(
        ds,
        chunk=chunk,
        shard_factor=shard_factor,
        compression_name=compression,  # type: ignore[arg-type]
        compression_level=compression_level,
    )

    if pyramid:
        with _timed("write level 0"):
            logger.info("Writing level 0 → %s/0", output)
            ds.to_zarr(
                output, group="0", mode="w", consolidated=False, encoding=encoding
            )
        with _timed("build pyramid (all levels)"):
            logger.info("Building pyramid")
            levels = build_pyramid(
                output,
                min_size=min_pyramid_size,
                chunk=chunk,
                shard_factor=shard_factor,
                compression_name=compression,  # type: ignore[arg-type]
                compression_level=compression_level,
            )
        with _timed("annotate_store"):
            annotate_store(output, data_group="0", multiscales_levels=levels)
    else:
        with _timed("write zarr (flat)"):
            logger.info("Writing zarr → %s", output)
            ds.to_zarr(output, mode="w", consolidated=False, encoding=encoding)
        with _timed("annotate_store"):
            annotate_store(output)

    click.echo(f"Wrote {output} with variables: {sorted(lv.name for lv in loaded)}")


@dataclass
class _SpatialRef:
    """Geospatial reference captured from the first tif in the first group.

    Every subsequent file must match ``shape`` and ``crs`` exactly — the worker
    asserts this inside ``_load_group`` so a miscalibrated config fails loud
    rather than producing a silently-corrupt cube.
    """

    height: int
    width: int
    crs_wkt: str
    transform: tuple[float, ...]  # 6-element rasterio affine
    x_coords: np.ndarray
    y_coords: np.ndarray


@dataclass
class _Loaded:
    """A single materialized raster group, ready to hand to xarray."""

    name: str
    display_name: str
    array: np.ndarray  # (N, H, W) for 3D groups; (H, W) for single-file groups
    dim_name: str | None  # None for 2D
    coords: dict[str, tuple[str, np.ndarray]]  # {coord_name: (dim, values)}


def _load_spatial_ref(path: str) -> _SpatialRef:
    with rasterio.open(path) as src:
        t = src.transform
        # Pixel-center coordinates: (ix + 0.5, iy + 0.5) * transform. Same
        # convention rioxarray uses on open_rasterio.
        x = (np.arange(src.width) + 0.5) * t.a + t.c
        y = (np.arange(src.height) + 0.5) * t.e + t.f
        return _SpatialRef(
            height=src.height,
            width=src.width,
            crs_wkt=src.crs.to_wkt() if src.crs else "",
            transform=tuple(t)[:6],
            x_coords=x.astype(np.float64),
            y_coords=y.astype(np.float64),
        )


def _load_group(rg: dict, ref: _SpatialRef) -> _Loaded:
    """Read every file in a RasterGroup into one numpy array.

    Runs inside a worker process — imports are at module top so pickling costs
    are just the ``rg`` dict and ``ref`` dataclass (both tiny).
    """
    file_list: list[str] = rg["file_list"]
    name = _sanitize(rg["name"])
    display_name = rg["name"]
    fmt = rg.get("file_date_fmt") or "%Y%m%d"

    # Dtype: float16 tifs are unusable downstream (GDAL reprojection + titiler
    # both choke), so upcast at read time. Everything else flows through
    # unchanged.
    with rasterio.open(file_list[0]) as src0:
        src_dtype = src0.dtypes[0]
    out_dtype = np.dtype("float32" if src_dtype == "float16" else src_dtype)

    if len(file_list) == 1:
        arr = _read_one(file_list[0], ref, out_dtype)
        return _Loaded(
            name=name, display_name=display_name, array=arr, dim_name=None, coords={}
        )

    # 3D: pre-allocate (N, H, W) once, then fill per file — avoids the
    # (concat N arrays) memory bump that stacking would cause.
    stack = np.empty((len(file_list), ref.height, ref.width), dtype=out_dtype)
    for i, f in enumerate(file_list):
        stack[i] = _read_one(f, ref, out_dtype)

    # Dim + coord choice mirrors the original xarray-backed code: single ref
    # date → linear time series; multiple refs → integer pair index + date
    # labels; single date per file → plain time series.
    dates_per_file = [get_dates(f, fmt=fmt) for f in file_list]
    pair_dim = f"pair_{name}"
    time_dim = f"time_{name}"

    if all(len(d) >= 2 for d in dates_per_file):
        pairs = [(d[0], d[1]) for d in dates_per_file]
        ref_dates = {p[0] for p in pairs}
        if len(ref_dates) == 1:
            sec = pd.to_datetime([p[1] for p in pairs])
            order = np.argsort(sec).tolist()
            stack = stack[order]
            return _Loaded(
                name=name,
                display_name=display_name,
                array=stack,
                dim_name=time_dim,
                coords={time_dim: (time_dim, sec[order].to_numpy())},
            )
        order = sorted(range(len(pairs)), key=lambda i: pairs[i])
        stack = stack[order]
        pairs = [pairs[i] for i in order]
        # dtype=object (variable-length strings) rather than default `<U21`
        # fixed-length — the latter has no zarr v3 spec and triggers a loud
        # UnstableSpecificationWarning on every write. Object maps to zarr's
        # VLenUTF8 codec, which *is* standardised.
        labels = np.array(
            [f"{p[0].strftime('%Y-%m-%d')}_{p[1].strftime('%Y-%m-%d')}" for p in pairs],
            dtype=object,
        )
        return _Loaded(
            name=name,
            display_name=display_name,
            array=stack,
            dim_name=pair_dim,
            coords={
                pair_dim: (pair_dim, np.arange(len(pairs))),
                f"reference_date_{name}": (
                    pair_dim,
                    pd.to_datetime([p[0] for p in pairs]).to_numpy(),
                ),
                f"secondary_date_{name}": (
                    pair_dim,
                    pd.to_datetime([p[1] for p in pairs]).to_numpy(),
                ),
                f"pair_label_{name}": (pair_dim, labels),
            },
        )
    if all(len(d) == 1 for d in dates_per_file):
        t = pd.to_datetime([d[0] for d in dates_per_file])
        order = np.argsort(t).tolist()
        stack = stack[order]
        return _Loaded(
            name=name,
            display_name=display_name,
            array=stack,
            dim_name=time_dim,
            coords={time_dim: (time_dim, t[order].to_numpy())},
        )
    raise ValueError(
        f"Group {display_name!r}: inconsistent filename date structure "
        f"({[len(d) for d in dates_per_file]})"
    )


def _read_one(path: str, ref: _SpatialRef, out_dtype: np.dtype) -> np.ndarray:
    """Read band 1 of a single tif as a 2D numpy array, asserting shape match."""
    with rasterio.open(path) as src:
        assert (src.height, src.width) == (
            ref.height,
            ref.width,
        ), f"{path}: shape {(src.height, src.width)} != ref {(ref.height, ref.width)}"
        arr = src.read(1)
    return arr.astype(out_dtype, copy=False)


def _assemble_dataset(loaded: list[_Loaded], ref: _SpatialRef) -> xr.Dataset:
    """Combine per-group numpy arrays into one ``xr.Dataset`` with shared x/y coords."""
    data_vars: dict[str, xr.DataArray] = {}
    extra_coords: dict[str, tuple[Any, np.ndarray]] = {}
    for lv in loaded:
        if lv.dim_name is None:
            da = xr.DataArray(lv.array, dims=("y", "x"), name=lv.name)
        else:
            da = xr.DataArray(lv.array, dims=(lv.dim_name, "y", "x"), name=lv.name)
            # Attach this group's per-dim coords to the containing Dataset so
            # they're written alongside the variable.
            for cname, (cdim, cvals) in lv.coords.items():
                extra_coords[cname] = (cdim, cvals)
        data_vars[lv.name] = da
    ds = xr.Dataset(
        data_vars,
        coords={"y": ref.y_coords, "x": ref.x_coords, **extra_coords},
    )
    if ref.crs_wkt:
        # Let rioxarray write spatial_ref via the usual accessor — keeps the
        # CF `grid_mapping` attribute wiring identical to the old path.
        import rioxarray  # noqa: F401, PLC0415

        ds = ds.rio.write_crs(ref.crs_wkt)
    return ds


def _sanitize(name: str) -> str:
    """Normalize a raster group name to a valid zarr variable name."""
    out = name.lower()
    for c in " .-/()":
        out = out.replace(c, "_")
    return "_".join(filter(None, out.split("_")))


if __name__ == "__main__":
    main()
