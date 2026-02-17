"""Tests for bowser.titiler date formatting and reference date detection."""

from datetime import datetime

import pytest

from bowser.titiler import _format_dates


class TestFormatDates:
    def test_single_date(self):
        d = datetime(2025, 3, 13)
        assert _format_dates(d) == "2025-03-13"

    def test_two_dates_uses_last(self):
        ref = datetime(2025, 3, 10)
        sec = datetime(2025, 3, 13)
        assert _format_dates(ref, sec) == "2025-03-13"

    def test_three_dates_uses_last(self):
        d1 = datetime(2025, 1, 1)
        d2 = datetime(2025, 6, 15)
        d3 = datetime(2025, 12, 31)
        assert _format_dates(d1, d2, d3) == "2025-12-31"

    def test_no_dates_raises(self):
        with pytest.raises((IndexError, TypeError)):
            _format_dates()


class TestRasterGroupReferenceDate:
    """Test reference_date via the integration test data.

    Uses the displacement COG files in tests/data/geotiffs/ which have
    filenames like displacement_20160708_20160801.tif (shared ref date).
    """

    @pytest.fixture()
    def raster_group_shared_ref(self):
        """RasterGroup with a shared reference date across all files."""
        import os
        import subprocess
        import tempfile
        from pathlib import Path

        from bowser.titiler import RasterGroup

        data_dir = Path(__file__).parent / "data/geotiffs"
        disp_files = sorted(data_dir.glob("displacement_*.tif"))
        assert len(disp_files) > 1, "Need displacement test files"

        rg = RasterGroup(
            name="test_displacement",
            file_list=[str(f) for f in disp_files],
            file_date_fmt="%Y%m%d",
        )
        return rg

    @pytest.fixture()
    def raster_group_no_dates(self):
        """RasterGroup with date parsing disabled."""
        from pathlib import Path

        from bowser.titiler import RasterGroup

        data_dir = Path(__file__).parent / "data/geotiffs"
        disp_file = sorted(data_dir.glob("displacement_*.tif"))[0]

        rg = RasterGroup(
            name="test_no_dates",
            file_list=[str(disp_file)],
            file_date_fmt=None,
        )
        return rg

    def test_x_values_are_iso_dates(self, raster_group_shared_ref):
        x = raster_group_shared_ref.x_values
        assert all(isinstance(v, str) for v in x)
        # Should be ISO format like "2016-08-01"
        assert all("-" in v for v in x)
        assert x[0] == "2016-08-01"

    def test_reference_date_detected(self, raster_group_shared_ref):
        assert raster_group_shared_ref.reference_date == "2016-07-08"

    def test_no_dates_falls_back_to_indexes(self, raster_group_no_dates):
        x = raster_group_no_dates.x_values
        assert x == [0]

    def test_no_dates_reference_date_is_none(self, raster_group_no_dates):
        assert raster_group_no_dates.reference_date is None
