"""Tests for GPS overlay endpoints with mocked geepers."""

from unittest.mock import MagicMock, patch

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import Point

from bowser.gps import _project_enu_to_los, init_gps, router
from bowser.manifest import LosConfig, LosVectorConstant


@pytest.fixture
def mock_gps_source():
    """Create a mock geepers UnrSource with synthetic station data."""
    source = MagicMock()

    # stations() returns a GeoDataFrame
    stations_gdf = gpd.GeoDataFrame(
        {"station_name": ["TEST", "ABC1", "XYZ2"]},
        geometry=[Point(-99.1, 19.4), Point(-99.2, 19.5), Point(-99.0, 19.3)],
        index=["TEST", "ABC1", "XYZ2"],
        crs="EPSG:4326",
    )
    source.stations.return_value = stations_gdf

    # station_lonlat() returns (lon, lat)
    source.station_lonlat.return_value = (-99.1, 19.4)

    # timeseries() returns a DataFrame with date index and ENU columns in meters
    dates = pd.date_range("2020-01-01", periods=50, freq="7D")
    rng = np.random.default_rng(42)
    ts_df = pd.DataFrame(
        {
            "east": rng.normal(0, 0.002, 50),  # meters
            "north": rng.normal(0, 0.003, 50),
            "up": np.linspace(0, -0.05, 50)
            + rng.normal(0, 0.001, 50),  # 50mm subsidence
        },
        index=dates,
    )
    source.timeseries.return_value = ts_df

    return source


@pytest.fixture
def constant_los_config():
    """Typical Sentinel-1 descending LOS vector."""
    return LosConfig(
        type="constant",
        los_enu=LosVectorConstant(east=0.477, north=-0.449, up=0.755),
    )


@pytest.fixture
def test_app(mock_gps_source, constant_los_config):
    """Create a test FastAPI app with GPS endpoints."""
    app = FastAPI()
    app.include_router(router)

    with patch("geepers.gps_sources.UnrSource", return_value=mock_gps_source):
        init_gps(constant_los_config)

    # Ensure module-level source is our mock
    import bowser.gps as gps_module

    gps_module._gps_source = mock_gps_source

    return TestClient(app)


def test_los_info(test_app):
    """Test GET /gps/los_info returns LOS config."""
    response = test_app.get("/gps/los_info")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "constant"
    assert abs(data["east"] - 0.477) < 1e-6
    assert abs(data["north"] - (-0.449)) < 1e-6
    assert abs(data["up"] - 0.755) < 1e-6


def test_get_stations(test_app):
    """Test GET /gps/stations returns station list."""
    response = test_app.get("/gps/stations?bbox=-99.5,19.0,-98.5,20.0")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 3
    assert data[0]["id"] == "TEST"
    assert abs(data[0]["lon"] - (-99.1)) < 1e-6


def test_get_station_timeseries(test_app):
    """Test GET /gps/stations/{id}/timeseries returns LOS + ENU."""
    response = test_app.get("/gps/stations/TEST/timeseries")
    assert response.status_code == 200
    data = response.json()
    assert data["station_id"] == "TEST"
    assert "los_vector" in data
    assert len(data["timeseries"]) > 0

    entry = data["timeseries"][0]
    assert "date" in entry
    assert "displacement" in entry
    assert "east" in entry
    assert "north" in entry
    assert "up" in entry


def test_enu_to_los_projection():
    """Verify dot product: pure subsidence with typical S1 descending geometry."""
    los_e, los_n, los_u = 0.477, -0.449, 0.755

    # Pure 10mm subsidence (up = -10mm)
    east = np.array([0.0])
    north = np.array([0.0])
    up = np.array([-10.0])

    result = _project_enu_to_los(east, north, up, los_e, los_n, los_u)
    # -10 * 0.755 = -7.55 (motion away from satellite)
    assert result[0] == pytest.approx(-7.55, abs=0.01)


def test_enu_to_los_pure_east():
    """Pure eastward motion."""
    los_e, los_n, los_u = 0.477, -0.449, 0.755
    result = _project_enu_to_los(
        np.array([10.0]),
        np.array([0.0]),
        np.array([0.0]),
        los_e,
        los_n,
        los_u,
    )
    assert result[0] == pytest.approx(4.77, abs=0.01)
