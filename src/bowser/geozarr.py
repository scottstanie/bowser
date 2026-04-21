"""GeoZarr convention helpers for bowser.

Thin wrapper around ``geozarr-toolkit`` for reading and writing the
``spatial:``, ``proj:``, and ``multiscales`` Zarr conventions on the stores
bowser opens in MD mode.

References
----------
- spatial:     https://github.com/zarr-conventions/spatial
- proj:        https://github.com/zarr-experimental/geo-proj
- multiscales: https://github.com/zarr-conventions/multiscales

"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

import xarray as xr
from rasterio.crs import CRS

BloscCname = Literal["lz4", "lz4hc", "blosclz", "snappy", "zlib", "zstd"]

__all__ = [
    "resolve_crs",
    "annotate_store",
    "build_pyramid",
    "data_group_name",
    "load_pyramid_levels",
    "shard_encoding",
]

# Defaults tuned for DISP-S1-sized cubes on S3: 256×256 chunks keep random-access
# tile reads cheap, and 4× shard factor on every dim means one HTTP GET per
# shard covers a 1024×1024 tile block (or 4 timesteps for timeseries reads).
# Pair of references: opera-utils uses `(4, 256, 256)` chunks × `(1, 4, 4)`
# shard_factors; we keep time chunk = 1 because bowser tile renders hit one
# timestep at a time, and we want shard time = 4 so timeseries `/point` reads
# bundle 4 timesteps per HTTP GET.
DEFAULT_CHUNK = 256
DEFAULT_SHARD_FACTOR = 4
# lz4 + clevel 5 = zarr's own default. ~6× faster to compress than zstd-6 at
# only ~10% worse ratio, and sharding already collapses the file count, so the
# extra bytes don't cost us HTTP round-trips. Users who want smaller stores
# can override with `shard_encoding(..., compression_name="zstd", ...)`.
DEFAULT_COMPRESSION_NAME: "BloscCname" = "lz4"
DEFAULT_COMPRESSION_LEVEL = 5

logger = logging.getLogger("bowser")


def resolve_crs(ds: xr.Dataset) -> CRS:
    """Resolve a CRS from a Dataset, preferring GeoZarr ``proj:`` attrs.

    Parameters
    ----------
    ds : xr.Dataset
        A Dataset that may carry ``proj:code`` / ``proj:wkt2`` on its root
        attributes (GeoZarr ``proj`` convention), or a CF-conventions
        ``spatial_ref`` variable with a ``crs_wkt`` attribute (rioxarray).

    Returns
    -------
    rasterio.crs.CRS

    Raises
    ------
    ValueError
        If no CRS source is present.

    """
    code = ds.attrs.get("proj:code")
    if code:
        return CRS.from_string(code)
    wkt2 = ds.attrs.get("proj:wkt2")
    if wkt2:
        return CRS.from_wkt(wkt2)
    if "spatial_ref" in ds.variables:
        return CRS.from_wkt(ds.spatial_ref.crs_wkt)
    raise ValueError(
        "No CRS found on dataset. Expected GeoZarr 'proj:code'/'proj:wkt2' "
        "root attrs or a CF 'spatial_ref' variable with 'crs_wkt'."
    )


def shard_encoding(
    ds: xr.Dataset,
    *,
    chunk: int = DEFAULT_CHUNK,
    shard_factor: int = DEFAULT_SHARD_FACTOR,
    compression_name: BloscCname = DEFAULT_COMPRESSION_NAME,
    compression_level: int = DEFAULT_COMPRESSION_LEVEL,
) -> dict[str, dict]:
    """Build per-variable ``encoding`` dict with chunks + shards + compression.

    Produces a zarr v3 encoding dict ready to hand to
    ``xr.Dataset.to_zarr(..., encoding=...)``. Every spatial data variable gets:

    - ``chunks`` = 1 on non-spatial dims, ``chunk`` on y/x
    - ``shards`` = chunks × ``shard_factor`` on every dim
    - ``compressors`` = one ``BloscCodec`` with ``zstd``

    Parameters
    ----------
    ds : xr.Dataset
        Dataset whose data_vars will be written. Variables with ndim < 2 are
        skipped (chunks/shards only make sense for gridded arrays).
    chunk : int
        Edge length of a chunk along the y and x dims, in pixels.
    shard_factor : int
        Multiplier from chunk → shard shape, applied to every dim.
    compression_name, compression_level : str, int
        Blosc sub-codec and compression level (1–9).

    Returns
    -------
    dict[str, dict]
        Mapping from variable name to its per-variable encoding dict.

    """
    from zarr.codecs import BloscCodec  # noqa: PLC0415 — optional runtime dep

    assert chunk >= 1 and shard_factor >= 1
    encoding: dict[str, dict] = {}
    for name, da in ds.data_vars.items():
        if da.ndim < 2:
            continue
        # Match by literal dim name rather than da.rio.x_dim/y_dim, which
        # requires a set CRS and fails on freshly-opened coarsened levels
        # inside build_pyramid.
        chunks = tuple(
            min(chunk, da.sizes[d]) if d in ("x", "y") else 1 for d in da.dims
        )
        var_enc: dict = {
            "chunks": chunks,
            "compressors": [
                BloscCodec(cname=compression_name, clevel=compression_level)
            ],
        }
        # shard_factor=1 means "don't wrap chunks in a shard" — dask chunks can
        # stay small, each dask task writes exactly one chunk, parallelism is
        # maximum. Useful when write time dominates (local disk, small cubes).
        if shard_factor > 1:
            shards = tuple(c * shard_factor for c in chunks)
            assert all(s % c == 0 for s, c in zip(shards, chunks))
            var_enc["shards"] = shards
        encoding[str(name)] = var_enc
    return encoding


def _multiscales_layout(path: str | Path) -> list[dict] | None:
    """Return the multiscales.layout list from the root group's attrs, or None.

    ``consolidated=False`` is important: pyramidal stores written by
    ``build_pyramid`` only consolidate the root and per-level sub-groups,
    so the parent root's consolidation may be absent, and more importantly
    ``zarr.open_consolidated`` against an S3 URI triggers an aiobotocore
    ContextVar conflict on our pixi runtime. Reading without consolidation
    is a few extra HTTP HEADs and side-steps the issue.
    """
    ds = xr.open_zarr(str(path), consolidated=False)
    ms = ds.attrs.get("multiscales")
    if not isinstance(ms, dict):
        return None
    layout = ms.get("layout")
    if not isinstance(layout, list) or not layout:
        return None
    return layout


def load_pyramid_levels(path: str | Path):
    """Open every level of a pyramidal store into a ``list[PyramidLevel]``."""
    from .state import PyramidLevel  # noqa: PLC0415 — avoid cycle

    layout = _multiscales_layout(path)
    if not layout:
        raise ValueError(f"{path} has no multiscales layout")
    out = []
    for level in layout:
        asset = str(level["asset"])
        ds = xr.open_zarr(path, group=asset, consolidated=False)
        out.append(PyramidLevel.from_dataset(asset, ds))
    return out


def data_group_name(path: str | Path) -> str | None:
    """Return the subgroup name containing level-0 data for a pyramidal store.

    Returns ``None`` for flat (non-pyramid) stores.
    """
    layout = _multiscales_layout(path)
    if not layout:
        return None
    asset = layout[0].get("asset") if isinstance(layout[0], dict) else None
    return str(asset) if asset else None


def annotate_store(
    path: str | Path,
    *,
    variable: str | None = None,
    data_group: str | None = None,
    multiscales_levels: list[dict] | None = None,
    consolidate: bool = False,
) -> None:
    """Write GeoZarr attrs to a zarr store.

    Always writes ``spatial:`` / ``proj:`` / ``zarr_conventions`` at the group
    that actually holds the level-0 data (``data_group`` if given, else root).
    When ``data_group`` is provided *or* ``multiscales_levels`` is given, also
    writes the ``multiscales`` attribute at the root.

    Parameters
    ----------
    path : str or Path
        Path to an existing zarr store.
    variable : str, optional
        Which data variable to inspect for CRS/transform. Default: first 2+ D.
    data_group : str, optional
        Zarr sub-group path where the level-0 data lives (e.g. ``"0"``). If
        ``None``, data is read from root.
    multiscales_levels : list[dict], optional
        ``multiscales.layout`` entries for a pyramid. When not given but
        ``data_group`` is set, a single-level layout pointing at ``data_group``
        is written.
    consolidate : bool, default False
        Re-consolidate metadata at root (and at the data group). Off by
        default because (a) bowser opens every store with
        ``consolidated=False`` to work around the aiobotocore ContextVar bug
        on S3, so ``.zmetadata`` is never read, and (b) zarr v3 hasn't
        standardized consolidated metadata yet — leaving it on emits a
        ``ZarrUserWarning`` on every write.

    """
    import zarr
    from geozarr_toolkit import create_zarr_conventions, from_rioxarray
    from geozarr_toolkit.conventions import (
        MultiscalesConventionMetadata,
        ProjConventionMetadata,
        SpatialConventionMetadata,
    )
    from geozarr_toolkit.helpers.metadata import create_multiscales_layout

    # 1. Write spatial:/proj:/zarr_conventions on the data group.
    # consolidated=False: we don't write .zmetadata (see the consolidate kwarg
    # above), so asking zarr to look for it just produces a fallback warning.
    ds = (
        xr.open_zarr(path, group=data_group, consolidated=False)
        if data_group
        else xr.open_zarr(path, consolidated=False)
    )
    crs = resolve_crs(ds)
    ds = ds.rio.write_crs(crs)

    if variable is None:
        variable = next(name for name, v in ds.data_vars.items() if v.ndim >= 2)
    da = ds[variable]
    non_spatial = [d for d in da.dims if d not in (da.rio.x_dim, da.rio.y_dim)]
    if non_spatial:
        da = da.isel({d: 0 for d in non_spatial})

    geo_attrs = from_rioxarray(da)
    conventions = [SpatialConventionMetadata(), ProjConventionMetadata()]

    data_node = zarr.open_group(str(path), mode="r+", path=data_group)
    data_node.attrs.update(geo_attrs)
    data_node.attrs["zarr_conventions"] = create_zarr_conventions(*conventions)

    # 2. Write multiscales at the root (if applicable).
    if data_group or multiscales_levels:
        levels = multiscales_levels or [{"asset": data_group or "0"}]
        ms_attrs = create_multiscales_layout(levels, resampling_method="average")
        root = zarr.open_group(str(path), mode="r+")
        root.attrs.update(ms_attrs)
        # Duplicate spatial/proj on root too — lets non-multiscales-aware readers
        # discover the CRS without descending into /0.
        root.attrs.update(geo_attrs)
        root.attrs["zarr_conventions"] = create_zarr_conventions(
            *conventions, MultiscalesConventionMetadata()
        )

    if consolidate:
        zarr.consolidate_metadata(str(path))
        if data_group:
            zarr.consolidate_metadata(str(path), path=data_group)


def build_pyramid(
    path: str | Path,
    *,
    level0: str = "0",
    min_size: int = 256,
    max_levels: int = 6,
    chunk: int = DEFAULT_CHUNK,
    shard_factor: int = DEFAULT_SHARD_FACTOR,
    compression_name: BloscCname = DEFAULT_COMPRESSION_NAME,
    compression_level: int = DEFAULT_COMPRESSION_LEVEL,
) -> list[dict]:
    """Build a coarsened multiscale pyramid for data already written at ``path/level0``.

    Writes sibling subgroups ``"1"``, ``"2"``, … each at 2× coarser spatial
    resolution than the previous, stopping when ``min(y, x) < min_size`` or
    after ``max_levels`` levels. Uses mean resampling across both spatial dims.
    Every level is written with the same chunk + shard encoding as level 0
    (see ``shard_encoding``), so pyramid levels don't undo the small-file
    consolidation won by sharding.

    Returns
    -------
    list[dict]
        ``multiscales.layout`` entries ready to hand to ``annotate_store``.

    """
    ds = xr.open_zarr(path, group=level0, consolidated=False)

    levels: list[dict[str, Any]] = [{"asset": level0}]
    prev = ds
    for i in range(1, max_levels + 1):
        y_sz = prev.sizes["y"] // 2
        x_sz = prev.sizes["x"] // 2
        if y_sz < min_size or x_sz < min_size:
            break
        logger.info("Coarsening level %d → %d × %d (y × x)", i, y_sz, x_sz)
        coarse = prev.coarsen({"y": 2, "x": 2}, boundary="trim").mean()
        # Rechunk to the shard shape before writing — dask chunks must be
        # whole shards for the zarr sharding codec to accept the write.
        shard = chunk * shard_factor
        rechunk_sizes: dict[str, int] = {
            "y": min(shard, coarse.sizes["y"]),
            "x": min(shard, coarse.sizes["x"]),
        }
        for d in coarse.dims:
            if d not in rechunk_sizes:
                rechunk_sizes[str(d)] = shard_factor
        coarse = coarse.chunk(rechunk_sizes)
        # Strip inherited encoding — chunk hints carried over from /0 will
        # conflict with the newly-sized arrays on /1+.
        for v in list(coarse.variables):
            coarse[v].encoding.clear()
        # Drop the stale GeoTransform attribute carried over from level 0; if
        # we left it, rioxarray would report the original full-res pixel size
        # for coarsened levels, and tile reads would use the wrong affine.
        if "spatial_ref" in coarse.variables:
            coarse["spatial_ref"].attrs.pop("GeoTransform", None)
        encoding = shard_encoding(
            coarse,
            chunk=chunk,
            shard_factor=shard_factor,
            compression_name=compression_name,
            compression_level=compression_level,
        )
        coarse.to_zarr(
            path, group=str(i), mode="w", consolidated=False, encoding=encoding
        )
        levels.append(
            {
                "asset": str(i),
                "derived_from": str(i - 1),
                "transform": {"scale": [2.0, 2.0]},
            }
        )
        prev = coarse

    return levels
