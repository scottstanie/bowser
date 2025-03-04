import subprocess
from functools import partial
from pathlib import Path
from typing import Sequence

from tqdm.auto import tqdm
from tqdm.contrib.concurrent import process_map

from bowser.credentials import AWSCredentials

CORE_DATASETS = [
    "displacement",
    "short_wavelength_displacement",
    "recommended_mask",
    "connected_component_labels",
    "temporal_coherence",
    "estimated_phase_quality",
    "persistent_scatterer_mask",
    "shp_counts",
    "water_mask",
    "phase_similarity",
    "timeseries_inversion_residuals",
]
CORRECTION_DATASETS = [
    "corrections/ionospheric_delay",
    "corrections/perpendicular_baseline",
    "corrections/solid_earth_tide",
]


def process_netcdf_files(
    netcdf_files: Sequence[Path | str],
    output_dir: str,
    datasets: list[str],
    max_workers: int = 5,
) -> None:
    """Process NetCDF files in the input directory, create VRT files, build overviews.

    Parameters
    ----------
    netcdf_files : Sequence[Path]
        Paths to input NetCDF files.
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
    out_path.mkdir(exist_ok=True, parents=True)

    aws_credentials = credentials.get_earthaccess_s3_creds("opera-uat")
    func = partial(
        process_single_file,
        output_dir=output_dir,
        datasets=datasets,
        aws_credentials=aws_credentials,
    )

    process_map(
        func,
        # lambda f: process_single_file(f, output_dir, datasets),
        netcdf_files,
        max_workers=max_workers,
    )


def process_single_file(
    netcdf_file: str,
    output_dir: str,
    datasets: list[str],
    aws_credentials: AWSCredentials | None,
) -> None:
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
    import h5py
    from opera_utils import get_dates
    from opera_utils._disp import get_remote_h5

    dates = get_dates(netcdf_file)[:2]

    if str(netcdf_file).startswith("s3://"):
        hf = get_remote_h5(netcdf_file, aws_credentials=aws_credentials)
        print(f"Read remote {netcdf_file}")
    else:
        hf = h5py.File(netcdf_file)

    fmt = "%Y%m%d"
    for dataset in tqdm(datasets):
        if dataset not in hf:
            continue
        cur_output_dir = output_dir / dataset
        cur_output_dir.mkdir(exist_ok=True, parents=True)
        vrt_filename = f"{dates[0].strftime(fmt)}_{dates[1].strftime(fmt)}.vrt"
        vrt_path = cur_output_dir / vrt_filename

        # Create VRT file
        gdal_translate_cmd = [
            "gdal_translate",
            "-q",
            str(vrt_path),
            f"netcdf:{netcdf_file.replace('s3://', '/vsis3/')}:{dataset}",
        ]
        subprocess.run(gdal_translate_cmd, check=True, stdout=subprocess.PIPE)

        # Build overviews
        rio_overview_cmd = ["rio", "overview", "--build", "2^2..6", vrt_path]
        subprocess.run(rio_overview_cmd, check=True)
