"""Small per-site facts (e.g. typical low/high temperature) written by the data scripts and shown
in the viewer's facts strip. Stored as data/facts/<kind>/<site_id>.json."""

import json

from . import ROOT

FACTS_DIR = ROOT / "data" / "facts"


def write_fact(kind, site_id, **data):
    path = FACTS_DIR / kind / f"{site_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return path


def read_facts(site_id):
    out = {}
    if FACTS_DIR.exists():
        for d in FACTS_DIR.iterdir():
            p = d / f"{site_id}.json"
            if p.exists():
                out[d.name] = json.loads(p.read_text(encoding="utf-8"))
    return out
