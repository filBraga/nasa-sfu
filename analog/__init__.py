"""Planetary analog pipeline: fetch DEMs for Earth / Moon / Mars sites, compute terrain
features on a common local metric grid, and score how analogous two sites are."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
WEB_DATA_DIR = ROOT / "web" / "data"


def load_config(path=None):
    path = Path(path) if path else ROOT / "config" / "sites.json"
    cfg = json.loads(path.read_text(encoding="utf-8"))
    cfg["by_id"] = {s["id"]: s for s in cfg["sites"]}
    return cfg
