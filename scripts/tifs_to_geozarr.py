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

Usage
-----
    python scripts/tifs_to_geozarr.py bowser_rasters.json cube.zarr
    python scripts/tifs_to_geozarr.py bowser_rasters.json cube.zarr --pyramid
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import click
import numpy as np
import pandas as pd
import rioxarray  # noqa: F401  (registers xr.DataArray.rio accessor)
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
    "--eager/--lazy",
    default=True,
    show_default=True,
    help=(
        "Eager: materialize each variable into numpy before writing — one "
        "read-and-compute pass per variable, then a clean compressed write. "
        "Lazy: leave as a dask graph spanning all variables (what xarray does "
        "by default). Eager is faster on cubes that fit in RAM (multi-GB "
        "regional stacks); switch to --lazy for continental-scale cubes."
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
    eager: bool,
    pyramid: bool,
    min_pyramid_size: int,
    verbose: int,
) -> None:
    """Convert CONFIG (bowser_rasters.json) into OUTPUT (single zarr store)."""
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING)
    groups = json.loads(Path(config).read_text())

    data_vars: dict[str, xr.DataArray] = {}
    for rg in groups:
        file_list = rg.get("file_list") or []
        if not file_list:
            continue
        name = _sanitize(rg["name"])
        logger.info("Building %s (%d files)", name, len(file_list))
        data_vars[name] = _build_dataarray(
            file_list=file_list,
            file_date_fmt=rg.get("file_date_fmt") or "%Y%m%d",
            display_name=rg["name"],
            name=name,
            chunk=chunk,
        )

    assert data_vars, f"No non-empty raster groups in {config}"
    ds = xr.Dataset(data_vars)
    # Eager: materialize into numpy per-variable now, before handing to zarr.
    # This replaces one giant dask graph (all 15 vars × all tifs × all tiles,
    # shared across level 0 + every pyramid level) with N small
    # read-and-compute passes — each variable is parallel-loaded with dask,
    # then written with zarr's own thread pool handling compression. On a
    # 15-var 4 GB DISP cube this is ~3× faster than lazy writes.
    if eager:
        logger.info("Eagerly materializing %d variables", len(ds.data_vars))
        ds = ds.load()
    # Rechunk dask arrays to shard shape — zarr's safe-chunk validator treats
    # each shard as one atomic write unit, so dask chunks on every dim must
    # align with the shard grid. Skip when shard_factor=1 (no sharding): dask
    # chunks then match zarr chunks, one task per chunk, maximum parallelism.
    if not eager and shard_factor > 1:
        shard = chunk * shard_factor
        ds = ds.chunk(
            {d: (shard if d in ("x", "y") else shard_factor) for d in ds.dims}
        )
    encoding = shard_encoding(
        ds,
        chunk=chunk,
        shard_factor=shard_factor,
        compression_name=compression,  # type: ignore[arg-type]
        compression_level=compression_level,
    )

    if pyramid:
        logger.info("Writing level 0 → %s/0", output)
        ds.to_zarr(output, group="0", mode="w", consolidated=False, encoding=encoding)
        logger.info("Building pyramid")
        levels = build_pyramid(
            output,
            min_size=min_pyramid_size,
            chunk=chunk,
            shard_factor=shard_factor,
            compression_name=compression,  # type: ignore[arg-type]
            compression_level=compression_level,
        )
        annotate_store(output, data_group="0", multiscales_levels=levels)
    else:
        logger.info("Writing zarr → %s", output)
        ds.to_zarr(output, mode="w", consolidated=False, encoding=encoding)
        annotate_store(output)

    click.echo(f"Wrote {output} with variables: {sorted(data_vars)}")


def _build_dataarray(
    *,
    file_list: list[str],
    file_date_fmt: str,
    display_name: str,
    name: str,
    chunk: int,
) -> xr.DataArray:
    """Open all files and stack into a single DataArray with an appropriate dim."""
    fmt = file_date_fmt
    opened = [_open_one(f, chunk=chunk) for f in file_list]

    if len(opened) == 1:
        return opened[0].rename(name)

    dates_per_file = [get_dates(f, fmt=fmt) for f in file_list]
    pair_dim = f"pair_{name}"
    time_dim = f"time_{name}"

    if all(len(d) >= 2 for d in dates_per_file):
        pairs = [(d[0], d[1]) for d in dates_per_file]
        ref_dates = {p[0] for p in pairs}
        if len(ref_dates) == 1:
            # Linear time series keyed on secondary date.
            sec = pd.to_datetime([p[1] for p in pairs])
            order = np.argsort(sec)
            opened = [opened[i] for i in order]
            idx = pd.Index(sec[order], name=time_dim)
            da = xr.concat(opened, dim=idx)
        else:
            # True pair index: integer index ordered by (ref, sec).
            order = sorted(range(len(pairs)), key=lambda i: pairs[i])
            opened = [opened[i] for i in order]
            pairs = [pairs[i] for i in order]
            idx = pd.Index(range(len(pairs)), name=pair_dim)
            da = xr.concat(opened, dim=idx)
            labels = [
                f"{p[0].strftime('%Y-%m-%d')}_{p[1].strftime('%Y-%m-%d')}"
                for p in pairs
            ]
            da = da.assign_coords(
                {
                    f"reference_date_{name}": (
                        pair_dim,
                        pd.to_datetime([p[0] for p in pairs]),
                    ),
                    f"secondary_date_{name}": (
                        pair_dim,
                        pd.to_datetime([p[1] for p in pairs]),
                    ),
                    f"pair_label_{name}": (pair_dim, labels),
                }
            )
    elif all(len(d) == 1 for d in dates_per_file):
        t = pd.to_datetime([d[0] for d in dates_per_file])
        order = np.argsort(t)
        opened = [opened[i] for i in order]
        idx = pd.Index(t[order], name=time_dim)
        da = xr.concat(opened, dim=idx)
    else:
        raise ValueError(
            f"Group {display_name!r}: inconsistent filename date structure "
            f"({[len(d) for d in dates_per_file]})"
        )

    return da.rename(name)


def _open_one(path: str, *, chunk: int) -> xr.DataArray:
    """Open a single-band GeoTIFF, upcasting float16 to float32.

    GDAL/rasterio reprojection and titiler tile rendering both choke on
    float16.
    """
    da = rioxarray.open_rasterio(path, chunks={"x": chunk, "y": chunk}).squeeze(
        "band", drop=True
    )
    if da.dtype == np.float16:
        da = da.astype(np.float32)
    return da


def _sanitize(name: str) -> str:
    """Normalize a raster group name to a valid zarr variable name."""
    out = name.lower()
    for c in " .-/()":
        out = out.replace(c, "_")
    return "_".join(filter(None, out.split("_")))


if __name__ == "__main__":
    main()
