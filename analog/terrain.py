"""Terrain features computed on a local metric grid (square array, pixel size `res` m)."""

import numpy as np
from scipy.ndimage import gaussian_filter

SLOPE_BINS = np.linspace(0, 60, 31)            # degrees
ROUGH_BINS = np.linspace(-1.0, 2.5, 36)        # log10(TRI in metres)
PROFILE_R = np.linspace(0, 1.5, 61)            # r / crater radius
HYPSO_Q = np.linspace(0, 1, 51)                # area fraction


def slope_deg(z, res):
    gy, gx = np.gradient(z, res)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def tri(z):
    """Terrain Ruggedness Index (Riley 1999): mean absolute elevation difference to the 8 neighbours."""
    zp = np.pad(z, 1, mode="edge")
    acc = np.zeros_like(z)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy or dx:
                acc += np.abs(zp[1 + dy:zp.shape[0] - 1 + dy, 1 + dx:zp.shape[1] - 1 + dx] - z)
    return acc / 8.0


def refine_center(z, res, radius_m, search_frac=0.35):
    """Move the centre to the lowest point of the smoothed DEM within search_frac * radius.
    Catalogue coordinates are often a few km off the true crater centre."""
    n = z.shape[0]
    zs = gaussian_filter(z, sigma=max(1.0, 0.1 * radius_m / res))
    yy, xx = np.mgrid[0:n, 0:n]
    cx = cy = (n - 1) / 2
    inside = np.hypot((xx - cx) * res, (yy - cy) * res) <= search_frac * radius_m
    zs = np.where(inside, zs, np.inf)
    iy, ix = np.unravel_index(np.argmin(zs), zs.shape)
    return float(ix), float(iy)


N_SECTORS = 8


def radial_profile(z, res, radius_m, center, n_sectors=N_SECTORS):
    """Median elevation vs r/R, overall and for each of n_sectors compass sectors.
    A real crater has the same bowl-and-rim shape in every direction; random terrain does not."""
    n = z.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    dx, dy = (xx - center[0]) * res, (center[1] - yy) * res
    r = np.hypot(dx, dy) / radius_m
    sector = ((np.arctan2(dy, dx) + np.pi) / (2 * np.pi) * n_sectors).astype(int) % n_sectors
    edges = np.concatenate([[0], (PROFILE_R[1:] + PROFILE_R[:-1]) / 2, [PROFILE_R[-1] + 0.0125]])
    idx = (np.digitize(r.ravel(), edges) - 1)
    zf, sf = z.ravel(), sector.ravel()
    keep = (idx >= 0) & (idx < len(PROFILE_R)) & np.isfinite(zf)
    idx, zf, sf = idx[keep], zf[keep], sf[keep]
    prof = np.full(len(PROFILE_R), np.nan)
    sectors = np.full((n_sectors, len(PROFILE_R)), np.nan)
    for i in range(len(PROFILE_R)):
        m = idx == i
        if m.any():
            prof[i] = np.median(zf[m])
            for k in range(n_sectors):
                mk = m & (sf == k)
                if mk.any():
                    sectors[k, i] = np.median(zf[mk])
    return prof, sectors


def crater_metrics(profile):
    """Depth = rim height (max between 0.8R and 1.2R) minus floor (min inside 0.5R)."""
    r = PROFILE_R
    rim = np.nanmax(profile[(r >= 0.8) & (r <= 1.2)])
    floor = np.nanmin(profile[r <= 0.5])
    return float(rim), float(floor), float(max(rim - floor, 0.0))


def hypsometry(z):
    """Hypsometric curve: normalised elevation (2nd-98th percentile) at each area fraction."""
    v = z[np.isfinite(z)]
    lo, hi = np.percentile(v, [2, 98])
    q = np.percentile(v, 100 * (1 - HYPSO_Q))  # elevation exceeded by fraction q of the area
    return np.clip((q - lo) / max(hi - lo, 1e-6), 0, 1)


FLAT_SLOPE_DEG = 5.0                          # "landable / buildable" threshold
ILLUM_AZIMUTHS = 16
ILLUM_MAX_DIST_M = 20_000
ILLUM_MAX_PX = 256
ILLUM_BINS = np.linspace(0, 1, ILLUM_AZIMUTHS + 2) - 0.5 / ILLUM_AZIMUTHS  # one bin per lit-azimuth count
SPECTRUM_WAVELENGTHS = np.logspace(np.log10(100), np.log10(20_000), 25)  # metres


def _shift(a, dy, dx):
    """out[r, c] = a[r + dy, c + dx], NaN where that falls outside the grid."""
    h, w = a.shape
    out = np.full_like(a, np.nan)
    ys, ye = max(0, -dy), min(h, h - dy)
    xs, xe = max(0, -dx), min(w, w - dx)
    if ys < ye and xs < xe:
        out[ys:ye, xs:xe] = a[ys + dy:ye + dy, xs + dx:xe + dx]
    return out


def illumination(z, res, body_radius_m, sun_elev_deg):
    """Fraction of sun azimuths (out of 16) from which each pixel is lit at a fixed, low sun elevation.

    For every azimuth we march outward up to 20 km and keep the steepest horizon angle, after
    subtracting the drop caused by the body's curvature (d^2 / 2R, ~115 m at 20 km on the Moon).
    Only the central half of the window is returned, so horizons are not cut off by the edge."""
    from .sources import resample  # local import: sources does not depend on terrain
    n = z.shape[0]
    if n > ILLUM_MAX_PX:
        new_res = res * n / ILLUM_MAX_PX
        z, res = resample(z, res, new_res), new_res
    z = np.nan_to_num(z, nan=float(np.nanmin(z))).astype(np.float64)
    tan_sun = np.tan(np.radians(sun_elev_deg))
    steps = int(min(ILLUM_MAX_DIST_M, z.shape[0] * res) / res)
    lit = np.zeros_like(z)
    for k in range(ILLUM_AZIMUTHS):
        az = 2 * np.pi * k / ILLUM_AZIMUTHS
        ux, uy = np.sin(az), -np.cos(az)          # north is up (row index decreases)
        horizon = np.full_like(z, -np.inf)
        seen = set()
        for s in range(1, steps + 1):
            dx, dy = int(round(ux * s)), int(round(uy * s))
            if (dx, dy) in seen:
                continue
            seen.add((dx, dy))
            d = np.hypot(dx, dy) * res
            t = (_shift(z, dy, dx) - z - d * d / (2 * body_radius_m)) / d
            horizon = np.fmax(horizon, t)
        lit += horizon < tan_sun
    frac = lit / ILLUM_AZIMUTHS
    q = z.shape[0] // 4
    return frac[q:-q, q:-q].ravel()


def power_spectrum(z, res):
    """Radially averaged log10 power vs wavelength (SPECTRUM_WAVELENGTHS), shape only.

    The DEM is detrended (best-fit plane) and Hann-windowed first. Wavelengths outside
    [4 * res, extent / 4] are NaN, because the grid cannot measure them reliably."""
    z = np.nan_to_num(z, nan=float(np.nanmean(z))).astype(np.float64)
    n = z.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    A = np.column_stack([xx.ravel(), yy.ravel(), np.ones(n * n)])
    coef, *_ = np.linalg.lstsq(A, z.ravel(), rcond=None)
    z = z - (A @ coef).reshape(n, n)
    win = np.outer(np.hanning(n), np.hanning(n))
    P = np.abs(np.fft.fftshift(np.fft.fft2(z * win))) ** 2
    f = np.fft.fftshift(np.fft.fftfreq(n, d=res))
    kr = np.hypot(*np.meshgrid(f, f))
    lam = np.divide(1.0, kr, out=np.full_like(kr, np.inf), where=kr > 0)
    edges = np.sqrt(SPECTRUM_WAVELENGTHS[1:] * SPECTRUM_WAVELENGTHS[:-1])
    edges = np.concatenate([[SPECTRUM_WAVELENGTHS[0] ** 2 / edges[0]], edges, [SPECTRUM_WAVELENGTHS[-1] ** 2 / edges[-1]]])
    out = np.full(len(SPECTRUM_WAVELENGTHS), np.nan)
    for i in range(len(SPECTRUM_WAVELENGTHS)):
        lo, hi = edges[i], edges[i + 1]
        if lo < 4 * res or hi > n * res / 4:
            continue
        m = (lam >= lo) & (lam < hi)
        if m.any():
            out[i] = np.log10(P[m].mean() + 1e-12)
    return out


def site_features(z, res, site, metrics=None, sun_elev_deg=None, body_radius_m=None):
    """Features for one site. `metrics` limits the expensive ones (profile/depth, texture,
    illumination) to the dimensions the comparison actually uses."""
    metrics = set(metrics or ["slope", "roughness", "hypsometry", "profile", "depth"])
    n = z.shape[0]
    s = slope_deg(z, res)
    t = np.log10(tri(z) + 0.1)
    finite = np.isfinite(z)
    rng = np.random.default_rng(0)
    take = lambda a: rng.choice(a[finite], size=min(200_000, int(finite.sum())), replace=False)
    f = {
        "res_m": res,
        "slope_samples": take(s),
        "rough_samples": take(t),
        "slope_hist": np.histogram(s[finite], SLOPE_BINS, density=True)[0],
        "rough_hist": np.histogram(t[finite], ROUGH_BINS, density=True)[0],
        "slope_median": float(np.nanmedian(s)),
        "slope_p90": float(np.nanpercentile(s, 90)),
        "flat_fraction": float((s[finite] < FLAT_SLOPE_DEG).mean()),
        "hypsometry": hypsometry(z),
        "relief_m": float(np.nanmax(z) - np.nanmin(z)),
    }
    if metrics & {"profile", "depth"}:
        radius_m = site["diameter_km"] * 500.0
        center = refine_center(z, res, radius_m) if site.get("refine_center") else ((n - 1) / 2, (n - 1) / 2)
        prof, sectors = radial_profile(z, res, radius_m, center)
        rim, floor, depth = crater_metrics(prof)
        f.update({
            "center_offset_km": [round((center[0] - (n - 1) / 2) * res / 1000, 2),
                                 round(((n - 1) / 2 - center[1]) * res / 1000, 2)],
            "profile": prof, "sector_profiles": sectors,
            "rim_m": rim, "floor_m": floor, "depth_m": depth,
            "depth_over_diameter": depth / (2 * radius_m),
        })
    if "illumination" in metrics:
        lit = illumination(z, res, body_radius_m, sun_elev_deg)
        f["illum_samples"] = lit
        f["illum_hist"] = np.histogram(lit, ILLUM_BINS)[0] / max(lit.size, 1)
        f["illum_mean"] = float(lit.mean())
        f["sun_elevation_deg"] = sun_elev_deg
    if "texture" in metrics:
        f["spectrum"] = power_spectrum(z, res)
    return f
