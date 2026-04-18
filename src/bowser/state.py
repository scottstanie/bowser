"""Runtime state container for the bowser FastAPI app.

Replaces the former pattern of module-level globals (``DATA_MODE``,
``XARRAY_DATASET``, ``RASTER_GROUPS``, ``transformer_from_lonlat``) plus
scattered ``os.getenv("BOWSER_*")`` calls. Everything that depends on how
the server was started now lives on one typed object loaded once and
imported everywhere as ``state``.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import xarray as xr
from pyproj import Transformer

from .config import Settings

Mode = Literal["md", "cog"]

logger = logging.getLogger("bowser")


# Web Mercator map circumference at the equator.
_WEB_MERCATOR_EQUATOR_M = 40075016.686


@dataclass
class PyramidLevel:
    """One level of a multiscale pyramid."""

    asset: str  # zarr sub-group name, e.g. "0"
    dataset: xr.Dataset
    pixel_size_m: float  # mean absolute pixel size in the dataset's native CRS

    @classmethod
    def from_dataset(cls, asset: str, ds: xr.Dataset) -> "PyramidLevel":
        """Wrap a dataset with its name and derived pixel size.

        Pixel size comes from x/y coord spacing — not ``ds.rio.transform()``,
        which reads a cached affine off ``spatial_ref`` that our pyramid
        builder copies verbatim from level 0.
        """
        dx = abs(float(ds.x[1] - ds.x[0])) if ds.sizes["x"] > 1 else 0.0
        dy = abs(float(ds.y[1] - ds.y[0])) if ds.sizes["y"] > 1 else 0.0
        return cls(asset=asset, dataset=ds, pixel_size_m=(dx + dy) / 2.0)


@dataclass
class BowserState:
    """Process-wide runtime handles populated once at startup.

    Fields below are typed loosely (``Any``) because each one is only
    meaningful in one of the two modes; narrowing would otherwise force an
    ``assert not None`` at every call site and defeat the point of moving
    away from module-level globals. Callers should check ``mode`` first and
    then use the appropriate field; the ``require_md`` / ``require_cog``
    accessors are available when a stricter hand-off is wanted.
    """

    mode: Mode
    # xr.Dataset in MD mode, None in COG mode.
    dataset: Any = None
    # dict[str, RasterGroup] in COG mode, None in MD mode.
    raster_groups: Any = None
    # pyproj.Transformer in MD mode, None in COG mode.
    transformer_from_lonlat: Any = None
    # list[PyramidLevel] in MD mode (length >= 1), None in COG mode.
    levels: Any = None

    def dataset_for_tile_zoom(self, z: int, tile_size: int = 256) -> xr.Dataset:
        """Return the pyramid level dataset appropriate for a given tile zoom.

        Picks the coarsest level that still delivers roughly one native pixel
        per tile pixel (or finer). Falls back to level 0 when no pyramid is
        loaded.
        """
        if not self.levels or len(self.levels) <= 1:
            assert self.dataset is not None
            return self.dataset
        # Tile pixel size in metres at the equator. Scaling by cos(lat) would be
        # more accurate per-tile, but this is a level picker, not a projector —
        # over-picking by one level is cheap.
        tile_pixel_m = _WEB_MERCATOR_EQUATOR_M / ((1 << z) * tile_size)
        # Pick coarsest level whose pixel size <= tile pixel size.
        chosen = self.levels[0]
        for lvl in self.levels:
            if lvl.pixel_size_m <= tile_pixel_m:
                chosen = lvl
        return chosen.dataset

    @classmethod
    def load(cls, settings: Settings) -> "BowserState":
        """Load data sources per the active Settings and return a populated state."""
        from .geozarr import resolve_crs  # noqa: PLC0415 — avoid import cycle
        from .titiler import RasterGroup  # noqa: PLC0415

        if settings.BOWSER_STACK_DATA_FILE:
            stack_file = settings.BOWSER_STACK_DATA_FILE
            logger.info(f"Loading xarray dataset from {stack_file} (MD mode)")
            levels: list[PyramidLevel] = []
            if stack_file.endswith(".zarr"):
                from .geozarr import (  # noqa: PLC0415
                    data_group_name,
                    load_pyramid_levels,
                )

                group = data_group_name(stack_file)
                if group is not None:
                    levels = load_pyramid_levels(stack_file)
                    px = [round(lv.pixel_size_m, 3) for lv in levels]
                    logger.info(
                        f"Pyramid detected: {len(levels)} level(s), px(m): {px}"
                    )
                    ds = levels[0].dataset
                else:
                    ds = xr.open_zarr(stack_file)
            else:
                ds = xr.open_dataset(stack_file)
            crs = resolve_crs(ds)
            if "spatial_ref" in ds.variables and "time" in ds.spatial_ref.dims:
                ds = ds.assign_coords(
                    spatial_ref=ds.spatial_ref.isel(time=0).drop_vars("time")
                )
            ds.rio.write_crs(crs, inplace=True)
            tr = Transformer.from_crs(4326, ds.rio.crs, always_xy=True)
            if not levels:
                levels = [PyramidLevel.from_dataset("", ds)]
            else:
                # Re-write CRS on the level-0 dataset we just patched, and
                # propagate to the other levels so they all have rio.crs set.
                levels[0] = PyramidLevel.from_dataset(levels[0].asset, ds)
                for i in range(1, len(levels)):
                    levels[i].dataset.rio.write_crs(crs, inplace=True)
            return cls(mode="md", dataset=ds, transformer_from_lonlat=tr, levels=levels)

        cfg = Path(settings.BOWSER_DATASET_CONFIG_FILE)
        if cfg.exists():
            logger.info(f"Loading RasterGroups from {cfg} (COG mode)")
            raster_groups: dict[str, object] = {}
            for d in json.loads(cfg.read_text()):
                rg = RasterGroup.model_validate(d)
                raster_groups[rg.name] = rg
            logger.info(
                f"Found {len(raster_groups)} RasterGroup configs:"
                f" {list(raster_groups.keys())}"
            )
            return cls(mode="cog", raster_groups=raster_groups)

        # Catalog-only startup: there's a BOWSER_CATALOG_FILE but neither a
        # stack file nor a RasterGroup config. The DatasetRegistry will serve
        # every request by ?dataset=<id>; the default "state" is a stub that
        # passes mode checks but has no data. Every endpoint that reads
        # ``state.dataset`` / ``state.raster_groups`` directly must either
        # route through ``_resolve_state(dataset)`` first or accept 404 /
        # HTTP 400 when called without a dataset id.
        if settings.BOWSER_CATALOG_FILE:
            logger.info(
                "Catalog-only startup (no default stack/COG). "
                "Every request must carry ?dataset=<id>."
            )
            return cls(mode="md")

        raise ValueError(
            "No data files specified — need at least one of: "
            "BOWSER_STACK_DATA_FILE (MD mode), "
            "BOWSER_DATASET_CONFIG_FILE (COG mode), "
            "or BOWSER_CATALOG_FILE (multi-dataset catalog)."
        )

    # --- narrowed accessors — call these instead of manually unwrapping Optionals ---
    def require_md(self) -> tuple[xr.Dataset, Transformer]:
        """Return the MD-mode dataset + lon/lat transformer, asserting the mode."""
        assert self.mode == "md", f"expected MD mode, got {self.mode}"
        assert self.dataset is not None and self.transformer_from_lonlat is not None
        return self.dataset, self.transformer_from_lonlat

    def require_cog(self) -> dict[str, object]:
        """Return the COG-mode RasterGroup registry, asserting the mode."""
        assert self.mode == "cog", f"expected COG mode, got {self.mode}"
        assert self.raster_groups is not None
        return self.raster_groups
