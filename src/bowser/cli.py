import json
import os
from pathlib import Path

import click

from .add_overviews import addo


@click.group()
def cli_app():
    """CLI for bowser."""


cli_app.add_command(addo)


@cli_app.command()
@click.option(
    "--rasters-file",
    default="bowser_rasters.json",
    help="Name of JSON file from `bowser set-data`.",
)
@click.option(
    "--port",
    "-p",
    default=None,
    type=int,
    help="Port to run the web server on.",
    show_default=True,
)
@click.option(
    "--reload",
    is_flag=True,
    help="Reload the server on file change.",
)
@click.option(
    "--workers",
    "-w",
    default=1,
    type=int,
    help="Number of uvicorn workers to spawn",
    show_default=True,
)
@click.option(
    "--log-level",
    default="warning",
    type=click.Choice(["error", "warning", "info", "debug"]),
    help="Logging verbosity level",
    show_default=True,
)
@click.option(
    "--ignore-sidecar-files",
    is_flag=True,
    help=(
        "Tell GDAL to ignore extra files in the directory containing the files to"
        " read. This is useful for S3 buckets with huge number of files (but not"
        " for local reading)."
    ),
)
def run(rasters_file, port, reload, workers, log_level, ignore_sidecar_files):
    """Run the web server."""
    import uvicorn

    if port is None:
        port = _find_available_port(8000)

    # https://developmentseed.org/titiler/advanced/performance_tuning/
    cfg = {
        "DATASET_CONFIG_FILE": rasters_file,
        "GDAL_HTTP_MULTIPLEX": "YES",
        "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
        "GDAL_CACHEMAX": "800",
        "CPL_VSIL_CURL_CACHE_SIZE": "800",
        "VSI_CACHE": "TRUE",
        "VSI_CACHE_SIZE": "5000000",
    }
    for k, v in cfg.items():
        os.environ[k] = v
    if ignore_sidecar_files:
        os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"

    print(f"Setting up on http://localhost:{port}")
    uvicorn.run(
        "bowser.main:app",
        port=port,
        reload=reload,
        workers=workers,
        log_level=log_level,
    )


@cli_app.command()
# @click.argument("name")
# @click.argument("files", nargs=-1)
@click.option(
    "-o",
    "--output",
    type=click.Path(writable=True),
    default="bowser_rasters.json",
    show_default=True,
)
def set_data(output):
    """Specify what raster data to use.

    Saves to `output` JSON file.
    """
    from .titiler import Algorithm, RasterGroup, _find_files

    # rg = RasterGroup(name=name, file_list=list(files))
    raster_groups = []

    # Make an interactive loop
    def add_files():
        file_list: list[str] = []
        while not file_list:
            g = click.prompt(
                "Enter the filename or a glob pattern for the files", type=str
            )
            file_list = _find_files(g.strip())
            if not file_list:
                click.echo("No files found. Try again.")

        click.echo(f"Found {len(file_list)} files.")

        name = click.prompt("Enter a name for the raster group", type=str)
        algorithm = None
        uses_spatial_ref = False
        mask_file_list = []
        if click.confirm(
            "Does this dataset us a relative spatial reference? (e.g. unwrapped phase)"
        ):
            uses_spatial_ref = True
            algorithm = Algorithm.SHIFT.value

        if algorithm is None and click.confirm(
            "Do you want to apply `np.abs`,`np.angle`, rewrap the data?"
        ):
            algorithm = click.prompt(
                "Which algorithm?",
                type=click.Choice([a.value for a in Algorithm]),
            )
        if click.confirm("Do you have .conncomp.tif files you want to mask on?"):
            mask_file_list = [
                f.replace("unw.tif", "unw.conncomp.tif") for f in file_list
            ]
        if not mask_file_list and click.confirm(
            "Do you want to search for mask files?"
        ):
            g = click.prompt(
                "Enter the filename or a glob pattern for the mask files", type=str
            )
            mask_file_list = _find_files(g.strip())
            if not mask_file_list:
                click.echo("No files found. Try again.")

        click.echo("Building raster group...")
        rg = RasterGroup(
            file_list=file_list,
            mask_file_list=mask_file_list,
            name=name,
            algorithm=algorithm,
            uses_spatial_ref=uses_spatial_ref,
        )
        raster_groups.append(rg)

    while True:
        add_files()
        if click.confirm("Add another dataset?", default=False):
            continue
        else:
            break

    _dump_raster_groups(raster_groups, output=output)


def _dump_raster_groups(raster_groups, output):
    out_dicts = [rg.model_dump() for rg in raster_groups]
    with open(output, "w") as f:
        json.dump(out_dicts, f, indent=2)


@cli_app.command()
@click.argument("dolphin-work-dir", type=str)
@click.option(
    "-o",
    "--output",
    type=click.Path(writable=True),
    default="bowser_rasters.json",
    show_default=True,
)
def setup_dolphin(dolphin_work_dir, output):
    """Set up output data configuration for a dolphin workflow.

    Saves to `output` JSON file.
    """
    from .titiler import Algorithm, RasterGroup, _find_files

    def _glob(g):
        try:
            return _find_files(g.replace("'", "").replace('"', ""))
        except RuntimeError:
            return []

    wd = dolphin_work_dir.rstrip("/")
    dolphin_outputs = [
        {
            "name": "time series",
            "file_list": _glob(f"{wd}/timeseries/2*[0-9].tif"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {
            "name": "velocity",
            "file_list": [f"{wd}/timeseries/velocity.tif"],
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {
            "name": "Filtered time series",
            "file_list": _glob(f"{wd}/filtered_timeseries2/2*[0-9].tif"),
        },
        {
            "name": "Filterd velocity",
            "file_list": [f"{wd}/filtered_timeseries2/velocity.tif"],
        },
        {
            "name": "unwrapped",
            "file_list": _glob(f"{wd}/unwrapped/2*[0-9].unw.tif"),
            "mask_file_list": _glob(f"{wd}/unwrapped/*.unw.conncomp.tif"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {
            "name": "Connected components",
            "file_list": _glob(f"{wd}/unwrapped/*.unw.conncomp.tif"),
        },
        {
            "name": "Re-wrapped phase",
            "file_list": _glob(f"{wd}/unwrapped/2*[0-9].unw.tif"),
            "algorithm": Algorithm.REWRAP.value,
        },
        {
            "name": "(Pseudo) correlation",
            "file_list": _glob(f"{wd}/interferograms/*.cor.tif"),
        },
        {
            "name": "PS mask",
            "file_list": _glob(f"{wd}/interferograms/ps_mask_looked*.tif"),
        },
        {
            "name": "Temporal coherence",
            "file_list": _glob(f"{wd}/interferograms/temporal_coherence*.tif"),
        },
        {
            "name": "Phase cosine similarity",
            "file_list": _glob(f"{wd}/interferograms/similarity*.tif"),
        },
        {
            "name": "Time series residuals",
            "file_list": _glob(f"{wd}/timeseries/residuals_2*[0-9].tif"),
        },
        {
            "name": "Time series residuals (total sum)",
            "file_list": _glob(f"{wd}/timeseries/unw_inversion_residuals.tif"),
        },
        {
            "name": "Amplitude dispersion",
            "file_list": _glob(f"{wd}/interferograms/amp_dispersion_looked*.tif"),
        },
        {
            "name": "SHP counts",
            "file_list": _glob(f"{wd}/interferograms/shp_counts*.tif"),
        },
    ]
    raster_groups = []
    for group in dolphin_outputs:
        try:
            rg = RasterGroup(**group)
        except Exception as e:
            print(e)
            continue
        raster_groups.append(rg)

    _dump_raster_groups(raster_groups, output=output)


def _find_available_port(port_request: int = 8000):
    import socket

    port = port_request - 1
    while (result := 0) == 0:
        port += 1
        # Check if the port is open
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            result = s.connect_ex(("127.0.0.1", port))

        if result != 0:
            return port


@cli_app.command()
@click.argument(
    "input_files",
    nargs=-1,
    type=click.Path(exists=True, file_okay=True, dir_okay=False),
)
@click.option(
    "-o",
    "--output-dir",
    required=True,
    help="Path to the output directory where VRT files will be saved.",
)
@click.option(
    "--corrections/--no-corrections",
    default=False,
    help="Include corrections in addition to core datasets.",
)
def prepare_disp_s1(input_files, output_dir, corrections: bool):
    """Process NetCDF files to create VRT files with overviews.

    INPUT_FILES: Paths to input NetCDF files.
    """
    from bowser._prepare_disp_s1 import (
        CORE_DATASETS,
        CORRECTION_DATASETS,
        process_netcdf_files,
    )

    input_paths = [Path(f) for f in input_files]

    datasets_to_process = (
        CORE_DATASETS + CORRECTION_DATASETS if corrections else CORE_DATASETS
    )

    click.echo(f"Processing {len(input_files)} files into VRTS in {output_dir}")
    process_netcdf_files(input_paths, Path(output_dir), datasets_to_process)


@cli_app.command()
@click.argument(
    "disp_s1_dir", type=click.Path(exists=True, file_okay=False, dir_okay=True)
)
@click.option(
    "-o",
    "--output",
    type=click.Path(writable=True),
    default="bowser_rasters.json",
    show_default=True,
)
def setup_disp_s1(disp_s1_dir: str, output: str):
    """Set up output data configuration for OPERA L3 DISP-S1 products.

    Saves to `output` JSON file.
    """
    from .titiler import Algorithm, RasterGroup

    def _glob(pattern: str, subdir: str) -> list[str]:
        return [str(p) for p in sorted((Path(disp_s1_dir) / subdir).glob(pattern))]

    disp_s1_outputs = [
        {
            "name": "Displacement",
            "file_list": _glob("*.vrt", subdir="displacement"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
            "mask_file_list": _glob("*.vrt", subdir="connected_component_labels"),
        },
        {
            "name": "Displacement",
            "file_list": _glob("*.vrt", subdir="unwrapped_phase"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
            "mask_file_list": _glob("*.vrt", subdir="connected_component_labels"),
        },
        {
            "name": "Short Wavelength Displacement",
            "file_list": _glob("*.vrt", subdir="short_wavelength_displacement"),
        },
        {
            "name": "Connected Component Labels",
            "file_list": _glob("*.vrt", subdir="connected_component_labels"),
        },
        {
            "name": "Re-wrapped phase",
            "file_list": _glob("*.vrt", subdir="displacement"),
            "algorithm": Algorithm.REWRAP.value,
        },
        {
            "name": "Estimated Phase quality",
            "file_list": _glob("*.vrt", subdir="estimated_phase_quality"),
        },
        {
            "name": "Temporal Coherence",
            "file_list": _glob("*.vrt", subdir="temporal_coherence"),
        },
        {
            "name": "Phase Similarity",
            "file_list": _glob("*.vrt", subdir="phase_similarity"),
        },
        {
            "name": "Persistent Scatterer Mask",
            "file_list": _glob("*.vrt", subdir="persistent_scatterer_mask"),
        },
        {
            "name": "Water Mask",
            "file_list": _glob("*.vrt", subdir="water_mask"),
        },
        {
            "name": "Unwrapper Mask",
            "file_list": _glob("*.vrt", subdir="unwrapper_mask"),
        },
        {
            "name": "Ionospheric Delay",
            "file_list": _glob("*vrt", subdir="corrections/ionospheric_delay"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {
            "name": "Perpendicular Baseline",
            "file_list": _glob("*vrt", subdir="corrections/perpendicular_baseline"),
        },
        {
            "name": "Solid Earth Tide",
            "file_list": _glob("*vrt", subdir="corrections/solid_earth_tide"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
    ]

    raster_groups = []
    for group in disp_s1_outputs:
        try:
            rg = RasterGroup(**group)
        except Exception as e:
            print(f"Error processing {group['name']}: {e}")
            continue
        raster_groups.append(rg)

    _dump_raster_groups(raster_groups, output=output)
