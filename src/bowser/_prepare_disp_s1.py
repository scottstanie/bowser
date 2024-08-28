import subprocess
from pathlib import Path
from typing import Sequence

from tqdm.auto import tqdm
from tqdm.contrib.concurrent import thread_map

CORE_DATASETS = [
    "connected_component_labels",
    "displacement",
    "interferometric_correlation",
    "persistent_scatterer_mask",
    "short_wavelength_displacement",
    "temporal_coherence",
    "unwrapper_mask",
]
CORRECTION_DATASETS = [
    "corrections/ionospheric_delay",
    "corrections/perpendicular_baseline",
    "corrections/solid_earth_tide",
    "corrections/tropospheric_delay",
]


def process_netcdf_files(
    netcdf_files: Sequence[Path],
    output_dir: str,
    datasets: list[str],
    max_workers: int = 5,
) -> None:
    """Process NetCDF files in the input directory, create VRT files, and build overviews.

    Parameters
    ----------
    input_dir : str
        Path to the directory containing input NetCDF files.
    output_dir : str
        Path to the directory where output VRT files will be saved.
    datasets : list[str]
        list of dataset names to process from each NetCDF file.
    max_workers : int
        Number of parallel files to process.
        Default is 5.

    Returns
    -------
    None

    Notes
    -----
    This function processes all NetCDF files in the input directory, creates VRT files
    for each specified dataset, and builds overviews for the created VRT files.

    """
    # Ensure output directory exists
    out_path = Path(output_dir)
    out_path.mkdir(exist_ok=True)

    thread_map(
        lambda f: process_single_file(f, output_dir, datasets),
        netcdf_files,
        max_workers=max_workers,
    )


def process_single_file(netcdf_file: str, output_dir: str, datasets: list[str]) -> None:
    """Create VRT files from subdatasets and build overviews.

    Parameters
    ----------
    netcdf_file : str
        Path to the input NetCDF file.
    output_dir : str
        Path to the directory where output VRT files will be saved.
    datasets : list[str]
        list of dataset names to process from the NetCDF file.

    Returns
    -------
    None

    """
    # Extract date information from the filename
    from opera_utils import get_dates

    dates = get_dates(netcdf_file)[:2]

    fmt = "%Y%m%d"
    for dataset in tqdm(datasets):
        vrt_filename = (
            f"{dates[0].strftime(fmt)}_{dates[1].strftime(fmt)}.{dataset}.vrt"
        )
        vrt_path = output_dir / vrt_filename

        # Create VRT file
        gdal_translate_cmd = [
            "gdal_translate",
            "-q",
            f"netcdf:{netcdf_file}:{dataset}",
            vrt_path,
        ]
        subprocess.run(gdal_translate_cmd, check=True, stdout=subprocess.PIPE)

        # Build overviews
        rio_overview_cmd = ["rio", "overview", "--build", "2^2..6", vrt_path]
        subprocess.run(rio_overview_cmd, check=True)
