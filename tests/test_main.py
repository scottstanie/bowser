import os
import subprocess
import tempfile
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_setup_aligned_disp_s1_command():
    """Test that the setup-aligned-disp-s1 command creates a config file."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        config_file = tmp.name

    # Run the setup command
    result = subprocess.run(
        ["bowser", "setup-aligned-disp-s1", "data/geotiffs", "-o", config_file],
        capture_output=True,
        text=True,
        cwd=Path(__file__).parent.parent,
    )

    assert result.returncode == 0, f"Command failed: {result.stderr}"
    assert Path(config_file).exists()
    assert Path(config_file).stat().st_size > 0


def test_fastapi_app_startup():
    """Test that the FastAPI app can start with the sample data."""
    # Set up environment for test
    os.environ["BOWSER_DATASET_CONFIG_FILE"] = "bowser_rasters.json"

    # Import after setting environment variables
    from bowser.main import app

    client = TestClient(app)

    # Test basic endpoints
    response = client.get("/mode")
    assert response.status_code == 200
    data = response.json()
    assert "mode" in data

    response = client.get("/datasets")
    assert response.status_code == 200


def test_bowser_cli_run_command():
    """Test that bowser run command doesn't crash immediately."""
    # Skip if bowser_rasters.json doesn't exist
    config_file = Path("bowser_rasters.json")
    if not config_file.exists():
        pytest.skip("bowser_rasters.json not found - run setup command first")

    # Start the server in background and kill it quickly
    proc = subprocess.Popen(
        ["bowser", "run", "-f", str(config_file), "--port", "8999"],
        cwd=Path(__file__).parent.parent,
    )

    # Give it a moment to start up
    time.sleep(2)

    # Kill the process
    proc.terminate()
    proc.wait(timeout=5)

    # Check it didn't crash immediately
    assert proc.returncode != 1, "Server crashed on startup"
