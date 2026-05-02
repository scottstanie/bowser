"""Round-trip test for the MintPy → GeoZarr converter.

Builds a tiny synthetic MintPy bundle (timeseries.h5 + velocity.h5 +
geometryGeo.h5) on disk, runs the converter, and asserts the resulting
zarr matches what ``bowser run --stack-file`` expects: y/x coords, a
spatial_ref variable, ``proj:`` root attrs, the canonical ``timeseries``
3D variable on a ``time`` dim, and 2D variables for velocity / height.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest
import xarray as xr

pytest.importorskip("geozarr_toolkit", reason="prepare-mintpy needs the writer extras")


HEIGHT, WIDTH = 8, 6
N_DATES = 4


def _common_attrs() -> dict[str, str]:
    return {
        # WGS84 geographic — simplest geocoded MintPy layout.
        "X_FIRST": "-99.10",
        "Y_FIRST": "19.40",
        "X_STEP": "0.01",
        "Y_STEP": "-0.01",
        "WIDTH": str(WIDTH),
        "LENGTH": str(HEIGHT),
        "EPSG": "4326",
        "X_UNIT": "degrees",
    }


def _write_timeseries(path: Path, rng: np.random.Generator) -> None:
    with h5py.File(path, "w") as hf:
        for k, v in {**_common_attrs(), "FILE_TYPE": "timeseries", "UNIT": "m"}.items():
            hf.attrs[k] = v
        dates = np.array(["20200101", "20200201", "20200301", "20200401"], dtype="S8")
        hf.create_dataset("date", data=dates)
        ts = rng.normal(size=(N_DATES, HEIGHT, WIDTH)).astype("float32")
        hf.create_dataset("timeseries", data=ts)
        hf.create_dataset("bperp", data=np.linspace(0, 100, N_DATES, dtype="float32"))


def _write_velocity(path: Path, rng: np.random.Generator) -> None:
    with h5py.File(path, "w") as hf:
        for k, v in {
            **_common_attrs(),
            "FILE_TYPE": "velocity",
            "UNIT": "m/year",
        }.items():
            hf.attrs[k] = v
        hf.create_dataset(
            "velocity", data=rng.normal(size=(HEIGHT, WIDTH)).astype("float32")
        )
        hf.create_dataset(
            "velocityStd",
            data=np.abs(rng.normal(size=(HEIGHT, WIDTH))).astype("float32"),
        )


def _write_geometry(path: Path, rng: np.random.Generator) -> None:
    with h5py.File(path, "w") as hf:
        for k, v in {**_common_attrs(), "FILE_TYPE": "geometry"}.items():
            hf.attrs[k] = v
        hf.create_dataset(
            "height", data=(rng.normal(size=(HEIGHT, WIDTH)) * 100).astype("float32")
        )
        hf.create_dataset(
            "incidenceAngle",
            data=(rng.uniform(30, 45, size=(HEIGHT, WIDTH))).astype("float32"),
        )


def _bundle(tmp_path: Path) -> tuple[Path, Path, Path]:
    rng = np.random.default_rng(42)
    ts = tmp_path / "timeseries.h5"
    vel = tmp_path / "velocity.h5"
    geom = tmp_path / "geometryGeo.h5"
    _write_timeseries(ts, rng)
    _write_velocity(vel, rng)
    _write_geometry(geom, rng)
    return ts, vel, geom


def test_convert_no_pyramid(tmp_path: Path) -> None:
    """Convert a 3-file synthetic MintPy bundle and verify the zarr layout."""
    from bowser._prepare_mintpy import convert

    ts, vel, geom = _bundle(tmp_path)
    out = tmp_path / "out.zarr"

    written = convert(
        h5_files=[ts, vel, geom],
        output=str(out),
        chunk=4,
        shard_factor=1,
        compression="lz4",
        compression_level=5,
        quantize_digits=0,
        quantize_patterns="coherence,similarity",
        pyramid=False,
        min_pyramid_size=2,
        verbose=0,
    )

    # All known variables made it through.
    assert set(written) >= {
        "timeseries",
        "velocity",
        "velocityStd",
        "height",
        "incidenceAngle",
    }
    # /date never lands as a data var — it becomes the time coord.
    assert "date" not in written

    ds = xr.open_zarr(out, consolidated=False)
    assert "y" in ds.dims and "x" in ds.dims
    assert ds.sizes["y"] == HEIGHT and ds.sizes["x"] == WIDTH
    assert "time" in ds.coords and ds.sizes["time"] == N_DATES
    assert ds["timeseries"].dims == ("time", "y", "x")
    assert ds["velocity"].dims == ("y", "x")
    assert ds["height"].dims == ("y", "x")

    # CRS lands on the spatial_ref variable.
    assert "spatial_ref" in ds.variables
    assert "EPSG" in ds.spatial_ref.attrs.get("crs_wkt", "")  # WKT2 has EPSG ids

    # Per-variable attrs that the bowser frontend uses.
    assert ds["velocity"].attrs.get("long_name") == "Velocity"
    assert ds["velocity"].attrs.get("units") == "m/year"
    # grid_mapping=spatial_ref must be stamped on disk; xarray's CF decoder
    # consumes it on the way back through open_zarr, so re-read raw to check.
    raw = xr.open_zarr(out, consolidated=False, decode_cf=False)
    assert raw["timeseries"].attrs.get("grid_mapping") == "spatial_ref"
    assert raw["velocity"].attrs.get("grid_mapping") == "spatial_ref"

    # Time coordinates parsed back to numpy datetime64.
    times = ds["time"].values
    assert times.dtype.kind == "M"  # datetime64
    assert str(times[0])[:10] == "2020-01-01"

    # GeoZarr root attrs — proj:code (or wkt2) must be present so
    # state.resolve_crs sees them at run time.
    proj = ds.attrs.get("proj:code") or ds.attrs.get("proj:wkt2")
    assert proj, f"missing proj:* root attrs: {sorted(ds.attrs)}"


def test_convert_with_pyramid(tmp_path: Path) -> None:
    """A pyramid run lands data under /0 and writes multiscales root attrs."""
    from bowser._prepare_mintpy import convert

    ts, vel, geom = _bundle(tmp_path)
    out = tmp_path / "out_pyr.zarr"

    convert(
        h5_files=[ts, vel, geom],
        output=str(out),
        chunk=4,
        shard_factor=1,
        compression="lz4",
        compression_level=5,
        quantize_digits=0,
        quantize_patterns="",
        pyramid=True,
        min_pyramid_size=2,  # tiny grid; need a low cap to actually build a level
        verbose=0,
    )

    # Level-0 group is /0; root carries the multiscales attr.
    ds_root = xr.open_zarr(out, consolidated=False)
    assert "multiscales" in ds_root.attrs

    ds_level0 = xr.open_zarr(out, group="0", consolidated=False)
    assert "timeseries" in ds_level0.data_vars
    assert ds_level0.sizes["y"] == HEIGHT and ds_level0.sizes["x"] == WIDTH


def test_grid_mismatch_raises(tmp_path: Path) -> None:
    """A second file on a different grid must fail loudly."""
    from bowser._prepare_mintpy import convert

    ts, _, _ = _bundle(tmp_path)
    bad = tmp_path / "bad_velocity.h5"
    rng = np.random.default_rng(1)
    with h5py.File(bad, "w") as hf:
        attrs = _common_attrs()
        attrs["WIDTH"] = str(WIDTH + 2)  # off-by-2 to break the grid
        for k, v in attrs.items():
            hf.attrs[k] = v
        hf.create_dataset(
            "velocity",
            data=rng.normal(size=(HEIGHT, WIDTH + 2)).astype("float32"),
        )

    with pytest.raises(ValueError, match="grid"):
        convert(
            h5_files=[ts, bad],
            output=str(tmp_path / "out.zarr"),
            chunk=4,
            shard_factor=1,
            compression="lz4",
            compression_level=5,
            quantize_digits=0,
            quantize_patterns="",
            pyramid=False,
            min_pyramid_size=2,
            verbose=0,
        )


def test_mask_name_collision(tmp_path: Path) -> None:
    """Two files publishing /mask resolve to distinct variables via file stem."""
    from bowser._prepare_mintpy import convert

    rng = np.random.default_rng(7)
    _ = rng  # for symmetry with _bundle's signature; unused here
    a = tmp_path / "maskPS.h5"
    b = tmp_path / "water_mask.h5"
    for f, val in ((a, 1.0), (b, 2.0)):
        with h5py.File(f, "w") as hf:
            for k, v in {**_common_attrs(), "FILE_TYPE": "mask"}.items():
                hf.attrs[k] = v
            hf.create_dataset(
                "mask", data=np.full((HEIGHT, WIDTH), val, dtype="float32")
            )

    out = tmp_path / "out.zarr"
    written = convert(
        h5_files=[a, b],
        output=str(out),
        chunk=4,
        shard_factor=1,
        compression="lz4",
        compression_level=5,
        quantize_digits=0,
        quantize_patterns="",
        pyramid=False,
        min_pyramid_size=2,
        verbose=0,
    )
    # First file wins the bare name; second uses its stem.
    assert "mask" in written
    assert "water_mask" in written
    ds = xr.open_zarr(out, consolidated=False)
    assert float(ds["mask"].values[0, 0]) == 1.0
    assert float(ds["water_mask"].values[0, 0]) == 2.0


def test_radarcoded_rejected(tmp_path: Path) -> None:
    """Files without X_FIRST (radarcoded) are rejected with a useful message."""
    from bowser._prepare_mintpy import convert

    rc = tmp_path / "rc.h5"
    with h5py.File(rc, "w") as hf:
        hf.attrs["WIDTH"] = str(WIDTH)
        hf.attrs["LENGTH"] = str(HEIGHT)
        hf.attrs["FILE_TYPE"] = "velocity"
        hf.create_dataset(
            "velocity",
            data=np.zeros((HEIGHT, WIDTH), dtype="float32"),
        )
    with pytest.raises(ValueError, match="X_FIRST"):
        convert(
            h5_files=[rc],
            output=str(tmp_path / "out.zarr"),
            chunk=4,
            shard_factor=1,
            compression="lz4",
            compression_level=5,
            quantize_digits=0,
            quantize_patterns="",
            pyramid=False,
            min_pyramid_size=2,
            verbose=0,
        )
