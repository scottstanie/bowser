from pathlib import Path

from .titiler import Algorithm

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


def get_disp_s1_outputs(disp_s1_dir: Path | str):
    def _glob(pattern: str, subdir: str) -> list[str]:
        return [str(p) for p in sorted((Path(disp_s1_dir) / subdir).glob(pattern))]

    return [
        {
            "name": "Displacement",
            "file_list": _glob("*.vrt", subdir="displacement"),
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
            "name": "Persistent Scatterer Mask",
            "file_list": _glob("*.vrt", subdir="persistent_scatterer_mask"),
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
            "name": "Timeseries Inversion Residuals",
            "file_list": _glob("*.vrt", subdir="timeseries_inversion_residuals"),
        },
        {
            "name": "Estimated Phase quality",
            "file_list": _glob("*.vrt", subdir="estimated_phase_quality"),
        },
        {
            "name": "SHP counts",
            "file_list": _glob("*.vrt", subdir="shp_counts"),
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
