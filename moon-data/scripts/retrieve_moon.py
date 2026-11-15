"""Retrieve lunar PDS ODE metadata using Python's standard library.

Discovery returns valid instrument/product-type combinations. Products returns
one explicit page of metadata and file links, not raster-derived measurements.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = "https://oderest.rsl.wustl.edu/live2/"


def query(params):
    url = ENDPOINT + "?" + urlencode({**params, "output": "JSON"})
    request = Request(url, headers={"User-Agent": "MoonAnalogData/1.0"})
    with urlopen(request, timeout=90) as response:
        payload = json.load(response)
    result = payload.get("ODEResults")
    if not isinstance(result, dict):
        raise ValueError("Unexpected ODE response: missing ODEResults")
    if str(result.get("Status", "")).lower() != "success":
        raise ValueError("ODE returned an unsuccessful response: " + json.dumps(result))
    return {"retrieved_at": datetime.now(timezone.utc).isoformat(),
            "request_url": url, "response": payload}


def bounds_from(path):
    region = json.loads(path.read_text(encoding="utf-8"))
    if region.get("body") != "Moon":
        raise ValueError("Region body must be Moon")
    b = region["bounds"]
    if not -90 <= b["minlat"] < b["maxlat"] <= 90:
        raise ValueError("Latitude bounds must satisfy -90 <= minlat < maxlat <= 90")
    if not all(0 <= b[k] <= 360 for k in ("westernlon", "easternlon")):
        raise ValueError("Longitude bounds must be in 0..360 degrees east")
    if b["westernlon"] == b["easternlon"]:
        raise ValueError("Equal longitude bounds are ambiguous; use 0..360 for full coverage")
    return {k: b[k] for k in ("minlat", "maxlat", "westernlon", "easternlon")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["discover", "products"])
    parser.add_argument("--instrument", help="Exact IID from discovery")
    parser.add_argument("--product-type", help="Exact PT from discovery")
    parser.add_argument("--region", type=Path, default=ROOT / "config/region.json")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.limit <= 100 or args.offset < 0:
        parser.error("limit must be 1..100 and offset must be nonnegative")
    params = {"query": "iipt", "odemetadb": "moon"}
    default_name = "holdings.json"
    if args.command == "products":
        if not args.instrument or not args.product_type:
            parser.error("products requires --instrument and --product-type from discovery")
        params = {"query": "product", "target": "moon", "ihid": "LRO",
                  "iid": args.instrument, "pt": args.product_type,
                  "results": "copmf", "loc": "b", "limit": args.limit,
                  "offset": args.offset, **bounds_from(args.region)}
        # A fixed output filename avoids treating remote/user identifiers as paths.
        default_name = "products.json"
    if args.dry_run:
        print(ENDPOINT + "?" + urlencode({**params, "output": "JSON"}))
        return
    document = query(params)
    document["scope"] = "lunar_holdings" if args.command == "discover" else "product_metadata_page"
    if args.command == "products":
        document["pagination"] = {"offset": args.offset, "limit": args.limit,
                                  "complete_catalog": False,
                                  "note": "Request successive offsets; inspect Count and stop at exhaustion."}
    destination = args.out or ROOT / "data/catalogs" / default_name
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(destination)
    print(f"Saved {destination}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Retrieval failed: {error}") from error
