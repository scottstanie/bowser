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
from typing import Any

import xarray as xr
from rasterio.crs import CRS

__all__ = [
    "resolve_crs",
    "annotate_store",
    "build_pyramid",
    "data_group_name",
    "load_pyramid_levels",
]

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


def _multiscales_layout(path: str | Path) -> list[dict] | None:
    """Return the multiscales.layout list from the root, or None."""
    import zarr

    root = zarr.open_group(str(path), mode="r")
    ms = root.attrs.get("multiscales")
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
        ds = xr.open_zarr(path, group=asset)
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
    consolidate: bool = True,
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
    consolidate : bool, default True
        Re-consolidate metadata at root (and at the data group) so downstream
        readers still find ``.zmetadata``.

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
    ds = xr.open_zarr(path, group=data_group) if data_group else xr.open_zarr(path)
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
) -> list[dict]:
    """Build a coarsened multiscale pyramid for data already written at ``path/level0``.

    Writes sibling subgroups ``"1"``, ``"2"``, … each at 2× coarser spatial
    resolution than the previous, stopping when ``min(y, x) < min_size`` or
    after ``max_levels`` levels. Uses mean resampling across both spatial dims.

    Returns
    -------
    list[dict]
        ``multiscales.layout`` entries ready to hand to ``annotate_store``.

    """
    ds = xr.open_zarr(path, group=level0)

    levels: list[dict[str, Any]] = [{"asset": level0}]
    prev = ds
    for i in range(1, max_levels + 1):
        y_sz = prev.sizes["y"] // 2
        x_sz = prev.sizes["x"] // 2
        if y_sz < min_size or x_sz < min_size:
            break
        logger.info("Coarsening level %d → %d × %d (y × x)", i, y_sz, x_sz)
        coarse = prev.coarsen({"y": 2, "x": 2}, boundary="trim").mean()
        # Rechunk to match the target layout — coarsen produces dask chunks
        # that won't align with our (512, 512) zarr chunks otherwise.
        rechunk_sizes = {
            "y": min(512, coarse.sizes["y"]),
            "x": min(512, coarse.sizes["x"]),
        }
        for d in coarse.dims:
            if d not in rechunk_sizes:
                rechunk_sizes[str(d)] = 1
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
        coarse.to_zarr(path, group=str(i), mode="w", consolidated=True)
        levels.append(
            {
                "asset": str(i),
                "derived_from": str(i - 1),
                "transform": {"scale": [2.0, 2.0]},
            }
        )
        prev = coarse

    return levels
