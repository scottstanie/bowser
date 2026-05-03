"""Tests for the vector AOI upload + zonal stats backend.

Covers:
- ``load_geojson`` accepts plain GeoJSON, a Shapefile-zip, and rejects
  bad inputs.
- ``zonal_stats_md`` returns a per-timestep series for a 3-D cube and
  a single-summary block for a 2-D variable.
- ``stats_to_csv`` serialises both shapes correctly.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

pyogrio = pytest.importorskip("pyogrio", reason="vector overlay support needs pyogrio")
shapely = pytest.importorskip("shapely")
import rioxarray  # noqa: E402, F401  (registers the .rio accessor)

# --- helpers --------------------------------------------------------------


def _square_geojson() -> dict:
    """A 2°×2° square AOI centred on the origin."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "demo"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-1.0, -1.0],
                            [1.0, -1.0],
                            [1.0, 1.0],
                            [-1.0, 1.0],
                            [-1.0, -1.0],
                        ]
                    ],
                },
            }
        ],
    }


def _toy_3d_cube() -> xr.DataArray:
    """A 6°×6° WGS84 cube with 3 timesteps and a known constant per step."""
    y = np.linspace(2.5, -2.5, 6, dtype="float64")
    x = np.linspace(-2.5, 2.5, 6, dtype="float64")
    times = np.array(["2020-01-01", "2020-02-01", "2020-03-01"], dtype="datetime64[ns]")
    # values = timestep + 0.0; constant per timestep so the medians are
    # exact.
    arr = np.broadcast_to(
        np.arange(3, dtype="float32")[:, None, None], (3, 6, 6)
    ).copy()
    da = xr.DataArray(
        arr,
        dims=("time", "y", "x"),
        coords={"time": times, "y": y, "x": x},
        name="ts",
    )
    return da.rio.write_crs(4326)


def _toy_2d() -> xr.DataArray:
    """A 6°×6° WGS84 grid of constant 5.0 — handy for 2-D summary tests."""
    y = np.linspace(2.5, -2.5, 6, dtype="float64")
    x = np.linspace(-2.5, 2.5, 6, dtype="float64")
    da = xr.DataArray(
        np.full((6, 6), 5.0, dtype="float32"),
        dims=("y", "x"),
        coords={"y": y, "x": x},
        name="velocity",
    )
    return da.rio.write_crs(4326)


# --- load_geojson ---------------------------------------------------------


def test_load_geojson_passthrough() -> None:
    """A WGS84 GeoJSON upload returns the same features (modulo precision)."""
    from bowser._vector_overlay import load_geojson

    raw = json.dumps(_square_geojson()).encode("utf-8")
    out = load_geojson(raw, "demo.geojson")
    assert out.n_features == 1
    # bbox is approximately the unit square.
    assert pytest.approx(out.bbox[0], abs=1e-6) == -1.0
    assert pytest.approx(out.bbox[2], abs=1e-6) == 1.0
    assert out.geojson["features"][0]["properties"]["name"] == "demo"


def test_load_shapefile_zip(tmp_path: Path) -> None:
    """A zipped Shapefile is unpacked, parsed and reprojected to WGS84."""
    from bowser._vector_overlay import load_geojson

    # Build a tiny Shapefile via pyogrio.write_dataframe (skipped if
    # geopandas isn't available in the env).
    geopandas = pytest.importorskip("geopandas")
    from shapely.geometry import Polygon

    gdf = geopandas.GeoDataFrame(
        {"name": ["A"]},
        geometry=[Polygon([(-1, -1), (1, -1), (1, 1), (-1, 1)])],
        crs="EPSG:4326",
    )
    shp_dir = tmp_path / "shp"
    shp_dir.mkdir()
    shp_path = shp_dir / "demo.shp"
    pyogrio.write_dataframe(gdf, shp_path)

    # Zip the .shp + sidecars together.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for f in shp_dir.iterdir():
            zf.write(f, arcname=f.name)
    raw = buf.getvalue()

    out = load_geojson(raw, "demo.zip")
    assert out.n_features == 1
    assert out.geojson["features"][0]["geometry"]["type"] == "Polygon"


def test_load_geojson_bare_shp_rejected() -> None:
    from bowser._vector_overlay import load_geojson

    with pytest.raises(ValueError, match="zip"):
        load_geojson(b"not a real shp", "broken.shp")


def test_load_geojson_bad_format() -> None:
    from bowser._vector_overlay import load_geojson

    with pytest.raises(ValueError, match="Unsupported"):
        load_geojson(b"hello", "notes.txt")


# --- zonal_stats_md -------------------------------------------------------


def test_zonal_stats_3d() -> None:
    """A 3-D cube returns per-timestep stats matching the constants we wrote."""
    from bowser._vector_overlay import zonal_stats_md

    da = _toy_3d_cube()
    geom = _square_geojson()["features"][0]["geometry"]
    stats = zonal_stats_md(da, geom)

    # Series spans 3 timesteps with known constants 0, 1, 2.
    assert stats["time"] == ["2020-01-01", "2020-02-01", "2020-03-01"]
    medians = [s["median"] for s in stats["series"]]
    assert medians == pytest.approx([0.0, 1.0, 2.0])
    # 2°×2° AOI on a 1° grid → about 4-9 pixels depending on edge handling.
    assert 4 <= stats["n_pixels"] <= 16
    # Summary aggregates everything together → mean of {0,1,2} repeated.
    assert pytest.approx(stats["summary"]["mean"], abs=1e-6) == 1.0


def test_zonal_stats_2d() -> None:
    """A 2-D variable produces a single summary block, no series key."""
    from bowser._vector_overlay import zonal_stats_md

    da = _toy_2d()
    geom = _square_geojson()["features"][0]["geometry"]
    stats = zonal_stats_md(da, geom)

    assert "series" not in stats and "time" not in stats
    assert pytest.approx(stats["summary"]["median"], abs=1e-6) == 5.0
    assert stats["summary"]["count_valid"] == stats["summary"]["count_total"]
    assert stats["n_pixels"] >= 4


def test_zonal_stats_outside_extent() -> None:
    """A geometry outside the dataset bounds raises a clear error."""
    from bowser._vector_overlay import zonal_stats_md

    da = _toy_2d()
    far_away = {
        "type": "Polygon",
        "coordinates": [[[100, 50], [101, 50], [101, 51], [100, 51], [100, 50]]],
    }
    with pytest.raises(ValueError, match="intersect"):
        zonal_stats_md(da, far_away)


# --- stats_to_csv ---------------------------------------------------------


def test_stats_to_csv_3d() -> None:
    """3-D stats round-trip into a per-timestep CSV table."""
    from bowser._vector_overlay import stats_to_csv, zonal_stats_md

    da = _toy_3d_cube()
    geom = _square_geojson()["features"][0]["geometry"]
    stats = zonal_stats_md(da, geom)
    csv = stats_to_csv(stats)
    lines = csv.strip().split("\n")
    assert lines[0].startswith("time,mean,median,std,min,max,p5,p25,p75,p95")
    assert len(lines) == 1 + 3  # header + 3 timesteps


def test_stats_to_csv_2d() -> None:
    """2-D stats render as a single-row summary."""
    from bowser._vector_overlay import stats_to_csv, zonal_stats_md

    stats = zonal_stats_md(_toy_2d(), _square_geojson()["features"][0]["geometry"])
    csv = stats_to_csv(stats)
    lines = csv.strip().split("\n")
    assert "time" not in lines[0]
    assert len(lines) == 2  # header + 1 row
