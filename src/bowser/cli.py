import json
import os

import click

from .add_overviews import addo


@click.group()
def cli_app():
    """CLI for bowser."""


cli_app.add_command(addo)


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
        if click.confirm(
            "Does this dataset us a relative spatial reference? (e.g. unwrapped phase)"
        ):
            uses_spatial_ref = True
            algorithm = Algorithm.SHIFT.value

        if algorithm is None and click.confirm(
            "Do you want to apply `np.abs` or `np.angle` to the data?"
        ):
            algorithm = click.prompt(
                "Which algorithm?",
                type=click.Choice([a.value for a in Algorithm]),
            )
        click.echo("Building raster group...")
        rg = RasterGroup(
            file_list=file_list,
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
        json.dump(out_dicts, f)


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
            "file_list": _glob(f"{wd}/timeseries/2*.tif"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {"name": "velocity", "file_list": [f"{wd}/timeseries/velocity.tif"]},
        {
            "name": "unwrapped",
            "file_list": _glob(f"{wd}/unwrapped/2*[0-9].unw.tif"),
            "uses_spatial_ref": True,
            "algorithm": Algorithm.SHIFT.value,
        },
        {
            "name": "Connected components",
            "file_list": _glob(f"{wd}/unwrapped/*.unw.conncomp.tif"),
        },
        {
            "name": "Correlation",
            "file_list": _glob(f"{wd}/interferograms/*.cor.tif"),
        },
        {
            "name": "PS mask",
            "file_list": [f"{wd}/interferograms/ps_mask_looked.tif"],
        },
        {
            "name": "Temporal coherence",
            "file_list": [f"{wd}/interferograms/temporal_coherence.tif"],
        },
        {
            "name": "Amplitude dispersion",
            "file_list": [f"{wd}/interferograms/amp_dispersion_looked.tif"],
        },
        {
            "name": "SHP counts",
            "file_list": [f"{wd}/interferograms/shp_counts.tif"],
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
def run(rasters_file, port, reload, workers, log_level):
    """Run the web server."""
    import uvicorn

    if port is None:
        port = _find_available_port(8000)

    # https://developmentseed.org/titiler/advanced/performance_tuning/
    cfg = {
        "DATASET_CONFIG_FILE": rasters_file,
        "GDAL_HTTP_MULTIPLEX": "YES",
        "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
        "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
        "GDAL_CACHEMAX": "800",
        "CPL_VSIL_CURL_CACHE_SIZE": "800",
        "VSI_CACHE": "TRUE",
        "VSI_CACHE_SIZE": "5000000",
    }
    for k, v in cfg.items():
        os.environ[k] = v

    print(f"Setting up on http://localhost:{port}")
    uvicorn.run(
        "bowser.main:app",
        port=port,
        reload=reload,
        workers=workers,
        log_level=log_level,
    )
