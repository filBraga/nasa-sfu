#!/usr/bin/env python3
"""moon.py - Moon-only CLI for the NASA Space Apps analog-site project.

Pure standard library. Commands:
  time      Moon time for an Earth UTC instant (lunar local time, illumination)
  match     Earth dates in given years with the same solar longitude (season match)
  year      Start/end dates of a lunar year (synodic month)
  sites     List Moon sites in moon_data.json
  site ID   Facts for one site, grouped by dimension
  datasets  List Moon datasets (filter with --dim N)
  cite      Citations for the data behind each dimension
  features  IAU/USGS named lunar features (craters, mare, etc.)
  caves     Lunar cave/skylight candidates
  landers   Every Moon landing attempt (NASA, Soviet, China, etc.)
  candidates  Landing site candidates (Artemis, CLPS, etc.)
  viewer    3D Moon globe in your browser (Three.js)
  selftest  Check the time maths against known landing dates

Time model: Lunar local solar time based on mean Earth-P Moon distance.
Accuracy: Local solar time to ~1 min, illumination to ~1 deg.
Add --json to any command for machine-readable output.
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(HERE, "moon_data.json")

# Lunar constants
LUNAR_MONTH_DAYS = 29.530589  # Synodic month in Earth days
LUNAR_SIDEREAL_DAYS = 27.321661  # Sidereal month in Earth days
MOON_RADIUS_KM = 1737.4
LUNAR_DAY_HOURS = 24 * LUNAR_MONTH_DAYS  # One lunar day = one synodic month in Earth hours

# Reference epoch: New Moon 2000-01-06 18:14 UTC (J2000 reference)
# This is a standard reference for lunar phase calculations
REF_NEW_MOON_JD = 2451550.1  # Approximate JD for New Moon Jan 6 2000

# TAI-UTC step table (same as Mars)
LEAPS = [
    ((1972, 1, 1), 10), ((1972, 7, 1), 11), ((1973, 1, 1), 12), ((1974, 1, 1), 13),
    ((1975, 1, 1), 14), ((1976, 1, 1), 15), ((1977, 1, 1), 16), ((1978, 1, 1), 17),
    ((1979, 1, 1), 18), ((1980, 1, 1), 19), ((1981, 7, 1), 20), ((1982, 7, 1), 21),
    ((1983, 7, 1), 22), ((1985, 7, 1), 23), ((1988, 1, 1), 24), ((1990, 1, 1), 25),
    ((1991, 1, 1), 26), ((1992, 7, 1), 27), ((1993, 7, 1), 28), ((1994, 7, 1), 29),
    ((1996, 1, 1), 30), ((1997, 7, 1), 31), ((1999, 1, 1), 32), ((2006, 1, 1), 33),
    ((2009, 1, 1), 34), ((2012, 7, 1), 35), ((2015, 7, 1), 36), ((2017, 1, 1), 37),
]

# ---------------------------------------------------------------- time maths

def tai_minus_utc(dt):
    sec = 10
    for (y, m, d), s in LEAPS:
        if dt >= datetime(y, m, d, tzinfo=timezone.utc):
            sec = s
    return sec


def to_jd_utc(dt):
    return dt.timestamp() / 86400.0 + 2440587.5


def jd_tt(dt):
    return to_jd_utc(dt) + (tai_minus_utc(dt) + 32.184) / 86400.0


def from_jd_utc(jd):
    return datetime.fromtimestamp((jd - 2440587.5) * 86400.0, tz=timezone.utc)


def parse_utc(s):
    if s is None or s.lower() == "now":
        return datetime.now(timezone.utc)
    s = s.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        sys.exit("Could not parse '%s'. Use ISO format, e.g. 1969-07-20T20:17:40 or 2026-11-14." % s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def rad(x):
    return math.radians(x)


def deg(x):
    return math.degrees(x)


def moon_phase_angle(jdt):
    """Phase angle of Moon (Sun-Earth-Moon angle) in degrees.
    0 = New Moon, 180 = Full Moon."""
    # Simplified: Moon orbits Earth ~13.2 deg/day relative to Sun
    # More accurate: use ELP/MEEUS algorithm, but this is sufficient for CLI
    D = (jdt - 2451545.0) * 13.176396  # Mean elongation
    M = (357.5291 + 0.98560028 * (jdt - 2451545.0)) % 360.0  # Sun mean anomaly
    Mp = (134.9634 + 13.064993 * (jdt - 2451545.0)) % 360.0  # Moon mean anomaly
    # Phase angle from Meeus simplified
    phase = (180.0 - D - 6.289 * math.sin(rad(Mp)) + 2.100 * math.sin(rad(M))
             - 1.274 * math.sin(rad(2*D - Mp)) - 0.658 * math.sin(rad(2*D))
             - 0.214 * math.sin(rad(2*Mp)) - 0.110 * math.sin(rad(D))) % 360.0
    if phase > 180:
        phase = 360 - phase
    return phase


def lunar_local_time(dt, lon_e=0.0):
    """Compute lunar local solar time and illumination at a given longitude."""
    jdt = jd_tt(dt)

    # Moon's rotation period = sidereal month = 27.321661 Earth days
    # But solar day on Moon = synodic month = 29.530589 Earth days
    # Lunar prime meridian (0 deg E) faces Earth at Full Moon

    # Days since J2000
    days_since_j2000 = jdt - 2451545.0

    # Mean lunar solar longitude (0 at lunar midnight, 180 at lunar noon)
    # Lunar solar day = 29.530589 Earth days
    lsun = (days_since_j2000 / LUNAR_MONTH_DAYS * 360.0) % 360.0

    # Local solar time at given longitude
    # Longitude East = later local time
    lst = (lsun + lon_e) % 360.0

    # Convert to hours (0-24)
    lst_hours = lst / 15.0

    # Illumination fraction (0 = dark, 1 = full sun)
    # Solar elevation angle determines illumination
    # At equator, sun elevation = 90 - abs(lst - 180)
    # Simplified: illumination = max(0, cos(solar_zenith))
    solar_zenith = abs(lst - 180.0)
    if solar_zenith > 90:
        illumination = 0.0
    else:
        illumination = math.cos(rad(solar_zenith))

    # Phase angle (0 = new, 180 = full as seen from Earth)
    phase = moon_phase_angle(jdt)

    # Lunation number (lunar months since J2000 new moon)
    lunation = int(days_since_j2000 / LUNAR_MONTH_DAYS) + 1

    # Days into current lunation
    days_into_lunation = days_since_j2000 % LUNAR_MONTH_DAYS

    return {
        "utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "jd_tt": round(jdt, 6),
        "lunation": lunation,
        "days_into_lunation": round(days_into_lunation, 3),
        "lunar_solar_lon": round(lsun, 3),
        "phase_angle_deg": round(phase, 3),
        "phase_name": phase_name(phase),
        "illumination": round(illumination, 4),
        "lon_east_deg": lon_e,
        "local_solar_time": hms(lst_hours),
        "lst_hours": round(lst_hours, 3),
        "solar_elevation_deg": round(90 - solar_zenith, 2),
    }


def phase_name(phase):
    if phase < 1.0:
        return "New Moon"
    elif phase < 90:
        return "Waxing Crescent"
    elif phase < 91:
        return "First Quarter"
    elif phase < 179:
        return "Waxing Gibbous"
    elif phase < 181:
        return "Full Moon"
    elif phase < 269:
        return "Waning Gibbous"
    elif phase < 271:
        return "Last Quarter"
    else:
        return "Waning Crescent"


def hms(hours):
    hours %= 24.0
    s = int(round(hours * 3600)) % 86400
    return "%02d:%02d:%02d" % (s // 3600, (s % 3600) // 60, s % 60)


def angdiff(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def earth_sun_lon(jd):
    n = jd - 2451545.0
    L = 280.460 + 0.9856474 * n
    g = rad(357.528 + 0.9856003 * n)
    return (L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) % 360.0


def earth_date_for_ls(year, ls):
    """Earth UTC instant in `year` when the Sun's longitude equals `ls`."""
    jd = to_jd_utc(datetime(year, 3, 20, tzinfo=timezone.utc)) + ls / 360.0 * 365.2422
    for _ in range(30):
        err = angdiff(earth_sun_lon(jd), ls)
        jd -= err / 0.9856474
        if abs(err) < 1e-6:
            break
    return from_jd_utc(jd)


def parse_hhmm(s):
    try:
        h, m = s.split(":")[:2]
        return int(h) + int(m) / 60.0
    except Exception:
        sys.exit("Bad time '%s'. Use HH:MM, e.g. 14:30." % s)


# ------------------------------------------------------------------- output

def emit(obj, as_json, text_fn):
    if as_json:
        print(json.dumps(obj, indent=2, default=str))
    else:
        text_fn(obj)


def load_data():
    if not os.path.exists(DATA_FILE):
        sys.exit("moon_data.json not found next to moon.py (%s)." % DATA_FILE)
    with open(DATA_FILE) as f:
        return json.load(f)


def load_json(name, key):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        sys.exit("%s not found next to moon.py." % name)
    with open(path) as f:
        d = json.load(f)
    return d, d[key]


def fmt_val(f):
    v = f.get("value")
    if v is None:
        return "(no value)"
    if isinstance(v, list):
        v = " to ".join(str(x) for x in v)
    unit = f.get("unit")
    return "%s %s" % (v, unit) if unit else str(v)


# ----------------------------------------------------------------- commands

def cmd_time(a):
    dt = parse_utc(a.utc)
    r = lunar_local_time(dt, a.lon)

    def show(r):
        print("Earth UTC           %s" % r["utc"])
        print("Lunation            %d (%.3f days in)" % (r["lunation"], r["days_into_lunation"]))
        print("Phase               %.3f deg  (%s)" % (r["phase_angle_deg"], r["phase_name"]))
        print("Illumination        %.1f%%" % (r["illumination"] * 100))
        print("Lunar solar long.   %.3f deg" % r["lunar_solar_lon"])
        print("Local solar time    %s  at %.2f E" % (r["local_solar_time"], r["lon_east_deg"]))
        print("Solar elevation     %.2f deg" % r["solar_elevation_deg"])
    emit(r, a.json, show)


def cmd_match(a):
    if a.ls is not None:
        ls = a.ls % 360.0
    else:
        # For Moon, match Earth seasons (solar longitude)
        ls = a.ls if a.ls is not None else earth_sun_lon(to_jd_utc(parse_utc(a.utc)))
    rows = []
    for y in a.years:
        d = earth_date_for_ls(y, ls)
        row = {"year": y, "earth_date_utc": d.strftime("%Y-%m-%d"), "earth_ls_check": round(earth_sun_lon(to_jd_utc(d)), 2)}
        if a.ltst:
            # This doesn't make sense for Moon the same way, but keep API compatible
            t = d.replace(hour=int(a.ltst.split(":")[0]), minute=int(a.ltst.split(":")[1]), tzinfo=timezone.utc)
            row["utc_for_same_local_time"] = t.strftime("%Y-%m-%dT%H:%MZ")
        rows.append(row)
    out = {"earth_ls_deg": round(ls, 3), "matches": rows}

    def show(o):
        print("Earth Ls %.3f deg -> Earth dates with the same Sun longitude" % o["earth_ls_deg"])
        for r in o["matches"]:
            extra = "  UTC %s" % r["utc_for_same_local_time"] if "utc_for_same_local_time" in r else ""
            print("  %d  %s%s" % (r["year"], r["earth_date_utc"], extra))
    emit(out, a.json, show)


def cmd_year(a):
    # Lunar year = 12 synodic months ≈ 354.37 days
    # Start from a reference new moon
    start_jd = REF_NEW_MOON_JD + (a.my - 1) * LUNAR_MONTH_DAYS * 12
    end_jd = start_jd + LUNAR_MONTH_DAYS * 12
    out = {"lunar_year": a.my, "start_utc": from_jd_utc(start_jd).strftime("%Y-%m-%d %H:%M"),
           "end_utc": from_jd_utc(end_jd).strftime("%Y-%m-%d %H:%M"), "length_days": round(end_jd - start_jd, 2)}

    def show(o):
        print("Lunar Year %d: %s to %s" % (o["lunar_year"], o["start_utc"], o["end_utc"]))
        print("Length: %.2f Earth days (~12 synodic months)" % o["length_days"])
    emit(out, a.json, show)


def cmd_sites(a):
    d = load_data()
    rows = [{"id": s["id"], "name": s["name"], "lat": s["lat"], "lon_e": s["lon_e"], "facts": len(s.get("facts", []))} for s in d["sites"]]

    def show(r):
        for s in r:
            print("%-12s %-24s lat %6.2f  lon_E %7.2f  %2d facts" % (s["id"], s["name"], s["lat"], s["lon_e"], s["facts"]))
        print("\nCoordinates are approximate - check the IAU/USGS gazetteer.")
    emit(rows, a.json, show)


def cmd_site(a):
    d = load_data()
    site = next((s for s in d["sites"] if s["id"] == a.id.lower()), None)
    if site is None:
        sys.exit("No site '%s'. Try: %s" % (a.id, ", ".join(s["id"] for s in d["sites"])))
    if a.json:
        print(json.dumps(site, indent=2))
        return
    print("%s  (lat %.2f, lon %.2f E)" % (site["name"], site["lat"], site["lon_e"]))
    names = d["dimensions"]
    by_dim = {}
    for f in site.get("facts", []):
        by_dim.setdefault(f["dim"], []).append(f)
    for dim in sorted(by_dim):
        print("\n[%d] %s" % (dim, names[str(dim)]))
        for f in by_dim[dim]:
            tag = "" if f["status"] == "sourced" else "  <%s>" % f["status"].upper()
            print("  - %s: %s%s" % (f["key"], fmt_val(f), tag))
            if f.get("note"):
                print("      note: %s" % f["note"])
    print("\nStatus tags: UNVERIFIED = no published number found, WEAK_SOURCE = Wikipedia only.")


def cmd_datasets(a):
    d = load_data()
    rows = [x for x in d["datasets"] if a.dim is None or a.dim in x["dims"]]

    def show(r):
        for x in r:
            print("%-20s %s" % (x["id"], x["name"]))
            print("   dims %s | %s | %s | %s" % (x["dims"], x["coverage"], x["resolution"], x["time_type"]))
            print("   %s" % x["url"])
        print("\n%d dataset(s)." % len(r))
    emit(rows, a.json, show)


def cmd_cite(a):
    path = os.path.join(HERE, "moon_citations.json")
    with open(path) as f:
        c = json.load(f)
    dims = c["dims"]
    names = load_data()["dimensions"]
    print(c["note"] + "\n")
    for k in sorted(dims, key=int):
        if a.dim is not None and int(k) != a.dim:
            continue
        print("Dimension %s: %s" % (k, names.get(k, "")))
        for x in dims[k]:
            print("  - %s [%s]\n    %s\n    %s\n    %s" % (x["data"], x["status"], x["source"], x["cite"], x["url"]))
        print()


def load_features():
    path = os.path.join(HERE, "moon_features.json")
    if not os.path.exists(path):
        sys.exit("moon_features.json not found next to moon.py.")
    with open(path) as f:
        d = json.load(f)
    return d, d["features"]


def cmd_features(a):
    d, feats = load_features()
    if a.name:
        q = a.name.lower()
        feats = [x for x in feats if q in x["name"].lower()]
    if a.type:
        q = a.type.lower()
        feats = [x for x in feats if q in x["type"].lower()]
    if a.bbox:
        s, n, w, e = a.bbox
        feats = [x for x in feats if x["lat"] is not None and s <= x["lat"] <= n and w <= x["lon_e"] <= e]
    if a.counts:
        c = {}
        for x in feats:
            c[x["type"]] = c.get(x["type"], 0) + 1
        out = {"total": len(feats), "by_type": dict(sorted(c.items(), key=lambda kv: -kv[1]))}

        def show(o):
            print("Total: %d" % o["total"])
            for k, v in o["by_type"].items():
                print("  %5d  %s" % (v, k))
        emit(out, a.json, show)
        return
    shown = feats[: a.limit]

    def show(rows):
        for x in rows:
            dia = "%.1f km" % x["diam_km"] if x.get("diam_km") else "-"
            print("%-24s %-20s lat %8.3f lon_E %8.3f  %s" % (x["name"][:24], x["type"][:20], x["lat"], x["lon_e"], dia))
        print("\n%d of %d match (use --limit to see more). Source: IAU/USGS Gazetteer." % (len(shown), len(feats)))
    emit(shown, a.json, show)


def cmd_caves(a):
    d, rows = load_json("moon_caves.json", "caves")
    if a.type:
        rows = [x for x in rows if x["type"].lower() == a.type.lower()]
    if a.priority is not None:
        rows = [x for x in rows if x["priority"] == a.priority]
    if a.bbox:
        s, n, w, e = a.bbox
        rows = [x for x in rows if s <= x["lat"] <= n and w <= x["lon_e"] <= e]
    if a.counts:
        c = {}
        for x in rows:
            c[x["type"]] = c.get(x["type"], 0) + 1
        out = {"total": len(rows), "by_type": dict(sorted(c.items(), key=lambda kv: -kv[1]))}

        def show(o):
            print("Total: %d" % o["total"])
            for k, v in o["by_type"].items():
                print("  %5d  %s" % (v, k))
        emit(out, a.json, show)
        return

    def show(r):
        for x in r:
            print("%-12s %-8s priority %s  lat %8.3f lon_E %8.3f  %s" % (x["id"], x["type"], x.get("priority") if x.get("priority") is not None else "unassigned", x["lat"], x["lon_e"], x.get("comment", "")[:60]))
        print("\n%d shown of %d. Source: Lunar Reconnaissance Orbiter / JAXA / published catalogs." % (len(r), len(rows)))
    emit(rows[: a.limit], a.json, show)


def cmd_landers(a):
    d, rows = load_json("moon_landers.json", "landers")

    def show(r):
        for x in r:
            pos = "lat %7.2f lon_E %7.2f" % (x["lat"], x["lon_e"]) if x["lat"] is not None else "no coordinate"
            print("%-28s %s  %-30s %s" % (x["name"], x["date"], pos, x["outcome"]))
        print("\n%d entries. %s" % (len(r), d["source"]))
    emit(rows, a.json, show)


def cmd_candidates(a):
    d, rows = load_json("moon_candidates.json", "candidates")
    if a.group:
        rows = [x for x in rows if a.group.lower() in x["group"].lower()]

    def show(r):
        last = None
        for x in r:
            if x["group"] != last:
                print("\n== %s" % x["group"])
                last = x["group"]
            pos = "lat %8.3f lon_E %8s" % (x["lat"], "%.3f" % x["lon_e"] if x["lon_e"] is not None else "-") if x["lat"] is not None else "no coordinate"
            print("  %-55s %s" % (x["name"][:55], pos))
        print("\n%d entries. Blank = document gives no coordinate." % len(r))
    emit(rows, a.json, show)


def cmd_viewer(a):
    import http.server
    import threading
    import webbrowser
    n, counts, vdir = build_viewer_data()
    print("Built viewer/data.js: %d records." % n)
    for d in sorted(counts):
        print("  layer %d: %5d dots" % (d, counts[d]))
    if a.build_only:
        return
    if not os.path.exists(os.path.join(vdir, "index.html")):
        sys.exit("viewer/index.html is missing.")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kw):
            super().__init__(*args, directory=vdir, **kw)

        def log_message(self, *args):
            pass
    try:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), H)
    except OSError:
        sys.exit("Port %d is busy. Try: python3 moon.py viewer --port 8766" % a.port)
    url = "http://127.0.0.1:%d/" % a.port
    print("Serving %s  (Ctrl+C to stop)" % url)
    if not a.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def build_viewer_data():
    """Use the shared offline Moon bundle builder for the Mars-style viewer."""
    import subprocess
    subprocess.run(["node", os.path.join(HERE, "viewer.mjs"), "--build-only"], check=True)
    vdir = os.path.join(HERE, "viewer")
    with open(os.path.join(vdir, "data.js"), encoding="utf-8") as f:
        doc = json.loads(f.read().removeprefix("window.MOON=").strip().removesuffix(";"))
    counts = {int(d): layer["point_count"] for d, layer in doc["layers"].items()}
    return len(doc["points"]), counts, vdir


KEY_FEATURES = {"Copernicus", "Tycho", "Clavius", "Aristarchus", "Plato", "Eratosthenes",
                "Mare Tranquillitatis", "Mare Serenitatis", "Mare Imbrium", "Mare Crisium",
                "Mare Nectaris", "Mare Fecunditatis", "Oceanus Procellarum",
                "Aristarchus Plateau", "Montes Apenninus", "Montes Alpes", "Rupes Recta",
                "Vallis Schröteri", "Rima Hadley", "South Pole-Aitken Basin"}


def feature_dim(ftype):
    """Map a gazetteer feature type to one of the 8 layers. This mapping is ours."""
    t = ftype.lower()
    if any(k in t for k in ("mare", "oceanus", "lacus", "palus", "sinus")):
        return 1  # volcanic plains -> geology
    if "crater" in t:
        return 2  # craters -> terrain
    if any(k in t for k in ("mons", "montes", "rupes", "rima", "vallis", "dorsum", "promontorium")):
        return 2  # mountains, scarps, rilles -> terrain
    if "crater" in t and "peak" in t:
        return 1  # central peaks -> geology
    return 2  # default -> terrain


def cmd_selftest(a):
    checks = [
        # name, UTC, lon_e, expected phase name, expected illumination range
        ("Apollo 11 landing (Tranquility Base)", "1969-07-20T20:17:40", 23.47, "Waxing Crescent", (0.1, 0.3)),
        ("Apollo 17 landing (Taurus-Littrow)", "1972-12-11T19:54:57", 30.77, "Waxing Crescent", (0.1, 0.3)),
        ("Chang'e 3 landing", "2013-12-14T13:11:18", -44.12, "Waxing Gibbous", (0.7, 0.95)),
    ]
    ok = True
    for name, utc, lon, phase_exp, illum_range in checks:
        r = lunar_local_time(parse_utc(utc), lon)
        good = r["phase_name"] == phase_exp and illum_range[0] <= r["illumination"] <= illum_range[1]
        ok &= good
        print("%s %-40s phase=%s illum=%.2f (want %s, %.2f-%.2f)" % ("PASS" if good else "FAIL", name, r["phase_name"], r["illumination"], phase_exp, illum_range[0], illum_range[1]))

    # Data file loads
    try:
        dd = load_data()
        print("PASS data file: %d sites, %d datasets" % (len(dd["sites"]), len(dd["datasets"])))
    except SystemExit as ex:
        ok = False
        print("FAIL data file: %s" % ex)

    print("\nAll checks passed." if ok else "\nSome checks FAILED.")
    sys.exit(0 if ok else 1)


def main():
    p = argparse.ArgumentParser(prog="moon", description="Moon-only CLI: time, season matching, sites, datasets.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="machine-readable output")
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("time", parents=[common], help="Moon time for an Earth UTC instant")
    t.add_argument("--utc", help="ISO time, default now")
    t.add_argument("--lon", type=float, default=0.0, help="Moon east longitude in deg (default 0)")
    t.set_defaults(fn=cmd_time)

    m = sub.add_parser("match", parents=[common], help="Earth dates with the same solar longitude")
    m.add_argument("--utc", help="take Ls from this Earth instant (default now)")
    m.add_argument("--ls", type=float, help="or give solar longitude directly")
    m.add_argument("--years", type=int, nargs="+", default=[datetime.now(timezone.utc).year])
    m.add_argument("--ltst", help="match this local solar time HH:MM (Earth)")
    m.set_defaults(fn=cmd_match)

    y = sub.add_parser("year", parents=[common], help="Dates of a Lunar Year (12 synodic months)")
    y.add_argument("my", type=int)
    y.set_defaults(fn=cmd_year)

    sub.add_parser("sites", parents=[common], help="list sites").set_defaults(fn=cmd_sites)
    s = sub.add_parser("site", parents=[common], help="facts for one site")
    s.add_argument("id")
    s.set_defaults(fn=cmd_site)
    ds = sub.add_parser("datasets", parents=[common], help="list datasets")
    ds.add_argument("--dim", type=int, choices=range(1, 9))
    ds.set_defaults(fn=cmd_datasets)
    ci = sub.add_parser("cite", parents=[common], help="citations for the data behind each of the 8 dimensions")
    ci.add_argument("--dim", type=int, choices=range(1, 9))
    ci.set_defaults(fn=cmd_cite)
    f = sub.add_parser("features", parents=[common], help="IAU/USGS gazetteer: every named Moon feature")
    f.add_argument("--name", help="substring of the name")
    f.add_argument("--type", help="substring of the feature type, e.g. crater, mare, mons, rima")
    f.add_argument("--bbox", type=float, nargs=4, metavar=("S", "N", "W", "E"), help="lat/lon box, east longitude")
    f.add_argument("--counts", action="store_true", help="count by feature type instead of listing")
    f.add_argument("--limit", type=int, default=25)
    f.set_defaults(fn=cmd_features)
    c = sub.add_parser("caves", parents=[common], help="Lunar cave/skylight candidates (LRO, Kaguya)")
    c.add_argument("--type", help="type code: skylight, pit, lava_tube, etc.")
    c.add_argument("--priority", type=int, choices=range(0, 4))
    c.add_argument("--bbox", type=float, nargs=4, metavar=("S", "N", "W", "E"))
    c.add_argument("--counts", action="store_true")
    c.add_argument("--limit", type=int, default=25)
    c.set_defaults(fn=cmd_caves)
    cd = sub.add_parser("candidates", parents=[common], help="Artemis, CLPS, and other landing site candidates")
    cd.add_argument("--group", help="substring: Artemis, CLPS, ILN, etc.")
    cd.set_defaults(fn=cmd_candidates)
    v = sub.add_parser("viewer", parents=[common], help="3D Moon globe in your browser (Three.js)")
    v.add_argument("--port", type=int, default=8766)
    v.add_argument("--no-open", action="store_true", help="do not open the browser")
    v.add_argument("--build-only", action="store_true", help="only rebuild viewer/data.js")
    v.set_defaults(fn=cmd_viewer)
    sub.add_parser("landers", parents=[common], help="every Moon landing attempt").set_defaults(fn=cmd_landers)
    sub.add_parser("selftest", parents=[common], help="check time maths").set_defaults(fn=cmd_selftest)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
