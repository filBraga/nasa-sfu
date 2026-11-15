"""Interactive live lunar place lookup; saves JSON and a readable HTML report."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from html import escape
import json
from pathlib import Path
import webbrowser

from retrieve_moon import ROOT, query


def as_list(value):
    return value if isinstance(value, list) else ([value] if value else [])


def lookup(name):
    resolved = query({"query": "featuredata", "odemetadb": "moon", "featurename": name})
    container = resolved["response"]["ODEResults"].get("Features")
    features = as_list(container.get("Feature")) if isinstance(container, dict) else []
    exact = [f for f in features if f["FeatureName"].casefold() == name.casefold()]
    if len(exact) != 1:
        raise ValueError("No unique exact lunar feature found. Try Shackleton, Tycho, or Copernicus. Use an official feature name, not a city on Earth.")
    feature = exact[0]
    bounds = {k: feature[v] for k, v in {
        "minlat": "MinLat", "maxlat": "MaxLat", "westernlon": "WestLon", "easternlon": "EastLon"}.items()}
    definitions = json.loads((ROOT / "config/dimensions.json").read_text())["dimensions"]
    probes = json.loads((ROOT / "config/probes.json").read_text())
    known = {d["id"] for d in definitions}
    definitions.extend({"id": key, "quantity": key, "unit": "see product label"}
                       for key in probes if key not in known)

    def probe(dimension):
        spec = probes[dimension["id"]]
        params = {"query": "product", "target": "moon", "ihid": "LRO", "results": "copmf",
                  "loc": "b", "limit": 3, "offset": 0, **bounds,
                  **{k: v for k, v in spec.items() if k not in ("note", "spatial")}}
        if spec.get("spatial") is False:
            for key in ["loc", *bounds]:
                params.pop(key, None)
        result = {"id": dimension["id"], "quantity": dimension["quantity"],
                  "unit": dimension["unit"], "value": None, "note": spec["note"],
                  "measurement_status": "not_extracted",
                  "spatial_scope": "archive_only" if spec.get("spatial") is False else "feature_bbox_candidates"}
        try:
            raw = query(params)
            container = raw["response"]["ODEResults"].get("Products")
            products = as_list(container.get("Product")) if isinstance(container, dict) else []
            status = ("archive_only_candidates" if spec.get("spatial") is False else "candidates_found") if products else "no_candidates"
            result.update(retrieval_status=status,
                          sample_count=len(products), request_url=raw["request_url"],
                          retrieved_at=raw["retrieved_at"], products=products)
        except (OSError, ValueError, KeyError, TypeError) as error:
            result.update(retrieval_status="error", error=str(error), products=[])
        return result

    with ThreadPoolExecutor(max_workers=3) as pool:
        dimensions = list(pool.map(probe, definitions))
    sources = {d["id"]: d for d in dimensions}
    categories = json.loads((ROOT / "config/categories.json").read_text())["categories"]
    for category in categories:
        for sub in category["subdimensions"]:
            statuses = [sources[key]["retrieval_status"] for key in sub["inputs"]]
            found = sum(status == "candidates_found" for status in statuses)
            sub.update(value=None, measurement_status="not_extracted",
                       available_input_count=found, required_input_count=len(statuses))
            if not statuses:
                sub["availability_status"] = sub["relationship"]
            elif found == len(statuses):
                sub["availability_status"] = "candidate_inputs_found"
            elif found:
                sub["availability_status"] = "partial_inputs_found"
            elif "error" in statuses:
                sub["availability_status"] = "input_query_error"
            elif "archive_only_candidates" in statuses:
                sub["availability_status"] = "archive_inputs_only_location_unverified"
            else:
                sub["availability_status"] = "no_candidate_inputs"
    return {"place": feature, "place_source": resolved["request_url"],
            "schema_version": "2.0", "categories": categories,
            "coordinate_convention": "degrees, east-positive longitude 0..360",
            "coverage_rule": "Candidate product bounding boxes intersect feature bounds; valid pixel coverage is unverified.",
            "dimensions": dimensions, "ready_for_scoring": False}


def html_report(report):
    sections = []
    for category in report["categories"]:
        rows = []
        for sub in category["subdimensions"]:
            references = ', '.join(f'<a href="#source-{escape(key)}">{escape(key.replace("_", " "))}</a>' for key in sub['inputs']) or 'No integrated data source'
            external = sub.get('reference', '')
            if external:
                references += f' · <a href="{escape(external, quote=True)}">Reference (not live-tested)</a>'
            rows.append(f'<tr><td><strong>{escape(sub["name"])}</strong><br>{escape(sub["relationship"].replace("_", " "))}</td><td>{escape(sub["availability_status"].replace("_", " "))}<br>{sub["available_input_count"]}/{sub["required_input_count"]} input sources</td><td>{escape(sub["note"])}<p>{references}</p></td></tr>')
        sections.append(f'<section><h2>{escape(category["name"])}</h2><table><thead><tr><th>Subdimension / evidence</th><th>Retrieval</th><th>Meaning and source inputs</th></tr></thead><tbody>{"".join(rows)}</tbody></table></section>')
    sections.append('<h2>Live source query details</h2><p>Source records are shared by multiple subdimensions. Reusing a source does not establish independent evidence or a measured operational score.</p>')
    for d in report["dimensions"]:
        items = []
        for p in d["products"]:
            # Link to the official product page, retaining raw file metadata in JSON.
            url = p.get("FilesURL", "")
            link = f'<a href="{escape(url, quote=True)}" target="_blank" rel="noopener">Open archive files</a>' if url.startswith("https://") else ""
            items.append(f'<li><strong>{escape(p.get("pdsid", "Unknown ID"))}</strong> {link}<p>{escape(p.get("Description", "No description supplied"))}</p></li>')
        query_link = f'<a href="{escape(d["request_url"], quote=True)}">Reproduce source query</a>' if d.get('request_url') else ''
        sections.append(f'<section id="source-{escape(d["id"])}"><h2>{escape(d["id"].replace("_", " ").title())}</h2><b>{escape(d["retrieval_status"].replace("_", " "))}</b> · {d.get("sample_count", 0)} sample records<p>Measured value: <strong>Not extracted</strong> · expected unit: {escape(d["unit"])}</p><p>{escape(d["note"])}</p><p>{escape(d.get("error", ""))}</p><p>{query_link}</p><details><summary>Product descriptions and archive links</summary><ul>{"".join(items)}</ul></details></section>')
    place = report["place"]
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Moon retrieval report</title>
<style>body{{font:16px system-ui;background:#101827;color:#e3eaf5;max-width:1200px;margin:40px auto;padding:0 24px}}section{{background:#1b293e;padding:24px;margin:20px 0;border-radius:14px;overflow:auto}}a{{color:#84d5ff}}li p{{white-space:pre-wrap;max-height:180px;overflow:auto;color:#bdcada}}h1{{font-size:36px}}h2{{margin-top:0}}table{{width:100%;border-collapse:collapse;min-width:650px}}th,td{{text-align:left;vertical-align:top;padding:14px;border-bottom:1px solid #3a4961}}th{{color:#84d5ff}}summary{{cursor:pointer}}</style>
<h1>{escape(place['FeatureName'])} · Moon</h1><p>{escape(place.get('FeatureClass', 'Feature'))} | Latitude {escape(place['MinLat'])} to {escape(place['MaxLat'])} | Longitude {escape(place['WestLon'])} to {escape(place['EastLon'])} °E</p>
<p>8 categories · {sum(len(c['subdimensions']) for c in report['categories'])} subdimensions · {len(report['dimensions'])} live source queries</p><p>Availability and handoff test. All measured values remain null. Candidate inputs, proxies and derived assessments are distinguished below. External references are not live-tested.</p><p>{escape(report['coverage_rule'])}</p>{''.join(sections)}</html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("place", nargs="?")
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    name = (args.place or input("Lunar place (e.g. Shackleton, Tycho, Copernicus): ")).strip()
    if not name or len(name) > 100:
        parser.error("Enter a lunar feature name of 1..100 characters")
    print(f"Looking up {name}: 8 categories and all subdimensions...", flush=True)
    report = lookup(name)
    destination = ROOT / "data/reports"
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "latest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    page = destination / "latest.html"
    page.write_text(html_report(report), encoding="utf-8")
    for d in report["dimensions"]:
        print(f'{d["id"]:20} {d["retrieval_status"]:18} {d.get("sample_count", 0)} samples | value: not extracted')
    print(f"Handoff: {len(report['categories'])} categories, {sum(len(c['subdimensions']) for c in report['categories'])} subdimensions")
    print(f"Report: {page}\nRaw JSON: {destination / 'latest.json'}")
    if not args.no_open:
        webbrowser.open(page.as_uri())


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise SystemExit(f"Lookup failed: {error}") from error
