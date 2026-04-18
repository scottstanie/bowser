"""Dataset catalog for bowser.

A catalog is a TOML file listing one or more GeoZarr stores that bowser
can serve. Each entry points at any fsspec-compatible URI — local path,
``s3://``, ``file://``, or ``http(s)://`` — so the same catalog works
whether the data lives on disk or in object storage.

Schema (TOML)::

    [[dataset]]
    id = "mexico-city"
    name = "Mexico City subsidence (Jun–Aug 2024)"
    uri = "s3://bowser-demo-data/mexico_city/cube.zarr"
    bbox = [-99.063, 19.331, -99.017, 19.374]  # lon_min, lat_min, lon_max, lat_max
    description = "DISP-S1 demo from the Capella workflow"

Notes
-----
- We keep the format minimal on purpose. A STAC Collection view of a
  GeoZarr pyramid is not yet standardised; if it lands, migrating is a
  matter of adding a compatibility loader here. See TECH_DEBT.md.
- ``id`` is the routing key used by the server; it must be URL-safe.
- ``bbox`` is in WGS84 lon/lat order to match the frontend map.

"""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path

__all__ = ["CatalogEntry", "load_catalog", "save_catalog", "entry_is_valid_id"]

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


@dataclass
class CatalogEntry:
    """One dataset in the catalog.

    Attributes
    ----------
    id : str
        Routing key. Lowercase, digits, ``_`` and ``-`` only; must start
        with an alphanumeric.
    name : str
        Human-readable title for the picker UI.
    uri : str
        Any fsspec-compatible URI to the zarr store:
        ``s3://bucket/path.zarr``, ``/abs/path/cube.zarr``, ``file://…``,
        ``http(s)://…``.
    bbox : tuple[float, float, float, float]
        ``(lon_min, lat_min, lon_max, lat_max)`` in WGS84.
    description : str
        Free-form text shown in the picker tooltip.
    """

    id: str
    name: str
    uri: str
    bbox: tuple[float, float, float, float]
    description: str = ""

    def __post_init__(self) -> None:
        if not entry_is_valid_id(self.id):
            raise ValueError(f"catalog id {self.id!r} must match ^[a-z0-9][a-z0-9_-]*$")
        if len(self.bbox) != 4:
            raise ValueError(f"bbox must have 4 floats, got {self.bbox!r}")
        self.bbox = tuple(float(x) for x in self.bbox)  # type: ignore[assignment]

    def to_dict(self) -> dict:
        """Return the entry as a dict suitable for JSON serialisation."""
        d = asdict(self)
        d["bbox"] = list(d["bbox"])
        return d


def entry_is_valid_id(entry_id: str) -> bool:
    """Return ``True`` if ``entry_id`` is a valid catalog routing key."""
    return bool(_ID_RE.fullmatch(entry_id))


def load_catalog(path: str | Path) -> list[CatalogEntry]:
    """Load a catalog from a TOML file.

    Returns an empty list if the file does not exist so callers can
    treat an absent catalog as "no datasets yet" rather than an error.
    """
    p = Path(path)
    if not p.exists():
        return []
    raw = tomllib.loads(p.read_text())
    entries = [CatalogEntry(**d) for d in raw.get("dataset", [])]
    _assert_unique_ids(entries)
    return entries


def save_catalog(entries: list[CatalogEntry], path: str | Path) -> None:
    r"""Write ``entries`` to a TOML catalog file, overwriting any prior content.

    String values are serialised via ``json.dumps`` (with ``ensure_ascii=True``
    so BIDI/control chars get ``\\uXXXX`` escapes). TOML basic-string escape
    rules are a superset of JSON's for the characters we care about, so the
    output round-trips through ``tomllib.loads`` cleanly — including names
    with quotes, backslashes, tabs, newlines, or any other control char.
    """
    _assert_unique_ids(entries)
    lines = []
    for e in entries:
        lines.append("[[dataset]]")
        lines.append(f"id = {json.dumps(e.id)}")
        lines.append(f"name = {json.dumps(e.name)}")
        lines.append(f"uri = {json.dumps(e.uri)}")
        lines.append(f"bbox = [{', '.join(f'{v:.10g}' for v in e.bbox)}]")
        if e.description:
            lines.append(f"description = {json.dumps(e.description)}")
        lines.append("")
    Path(path).write_text("\n".join(lines))


def _assert_unique_ids(entries: list[CatalogEntry]) -> None:
    from collections import Counter  # noqa: PLC0415

    dupes = [eid for eid, count in Counter(e.id for e in entries).items() if count > 1]
    if dupes:
        raise ValueError(f"duplicate catalog ids: {sorted(dupes)}")
