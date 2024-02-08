import logging
from enum import Enum
from os import fspath
from pathlib import Path
from typing import Sequence

import click
from osgeo import gdal
from tqdm.contrib.concurrent import thread_map

PathOrStr = Path | str

gdal.UseExceptions()

logger = logging.getLogger(__name__)

raster_type_to_resampling = {
    "unw": "average",
}


class Resampling(Enum):
    """GDAL resampling algorithm."""

    NEAREST = "nearest"
    AVERAGE = "average"
    LANCZOS = "lanczos"


def add_overviews(
    file_path: Path | str,
    overview_levels: Sequence[int] = [4, 8, 16, 32, 64],
    resampling: Resampling = Resampling.NEAREST,
    external: bool = False,
    overwrite: bool = False,
    compression: str = "LZW",
):
    """Add GDAL compressed overviews to an existing file.

    Parameters
    ----------
    file_path : Path
        Path to the file to process.
    overview_levels : list
        List of overview levels to add.
    resampling : str or Resampling
        GDAL resampling algorithm for overviews.
        Default = "nearest"
    external : bool, default = False
        Use external overviews (.ovr files).
    overwrite : bool, default = False
        Overwrite existing overviews
    compression: str, default = "LZW"
        Compression algorithm to use for overviews.
        See https://gdal.org/programs/gdaladdo.html for options.
    """
    ovr_path = Path(str(file_path) + ".ovr")
    if ovr_path.exists():
        if not overwrite:
            logger.debug("Skipping %s, exists", ovr_path)
            return
        logger.info("Removing existing %s", ovr_path)
        ovr_path.unlink()

    flags = gdal.GA_Update if not external else gdal.GA_ReadOnly
    raster = gdal.Open(fspath(file_path), flags)
    gdal.SetConfigOption("COMPRESS_OVERVIEW", compression)
    gdal.SetConfigOption("GDAL_NUM_THREADS", "2")
    raster.BuildOverviews(resampling.value, overview_levels)


def process_files(
    file_paths: Sequence[PathOrStr],
    levels: Sequence[int],
    resampling: Resampling,
    max_workers: int = 5,
    overwrite: bool = False,
):
    """Process files to add GDAL overviews and compression.

    Parameters
    ----------
    file_paths : Sequence[PathOrStr]
        Sequence of file paths to process.
    levels : Sequence[int]
        Sequence of overview levels to add.
    resampling : str or Resampling
        GDAL resampling algorithm for overviews.
        Default = "nearest"
    max_workers : int, default = 5
        Number of parallel threads to run.
    overwrite : bool, default = False
        Overwrite existing overviews
    """
    thread_map(
        lambda file_path: add_overviews(
            Path(file_path),
            overview_levels=list(levels),
            resampling=resampling,
            overwrite=overwrite,
        ),
        file_paths,
        max_workers=max_workers,
    )


@click.command()
@click.argument("file_paths", nargs=-1, type=click.Path(exists=True))
@click.option(
    "--levels",
    "-l",
    multiple=True,
    default=[4, 8, 16, 32, 64],
    type=int,
    help="Overview levels to add.",
    show_default=True,
)
@click.option(
    "--resampling",
    "-r",
    type=click.Choice([r.value for r in Resampling]),
    default="nearest",
    help="Resampling algorithm to use when building overviews",
    show_default=True,
)
@click.option(
    "--max-workers",
    "-n",
    default=5,
    type=int,
    help="Number of parallel files to process",
)
@click.option(
    "--overwrite",
    is_flag=True,
    help="Overwrite existing file. Otherwise, skips",
)
def addo(file_paths, levels, resampling, max_workers, overwrite):
    """Add compressed GDAL overviews to files."""
    return process_files(
        file_paths=file_paths,
        levels=levels,
        resampling=Resampling(resampling),
        max_workers=max_workers,
        overwrite=overwrite,
    )
