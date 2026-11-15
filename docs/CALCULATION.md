# Physical similarity calculation

Scores summarize configured measured properties, not a probability of being a
planetary analog. Mission-specific interpretation requires independently justified
activity weights and tolerances. Existing 0.4/0.7 verdict boundaries remain
provisional labels.

`config/similarity.json` defines the calculation policy. Metric similarity is
`exp(-ln(2) * (distance/tau)^p)`. Legacy e-folding scales are converted using
`tau = scale * ln(2)` with p=1, retaining their original distance response.
Exponents 1 and 2 are supported. The normalized sector-profile distance has a
new, explicitly provisional half-similarity tolerance of 0.5. Depth uses a
symmetric log-ratio, halving at a factor-of-two difference.

Slope, roughness and illumination retain Wasserstein distances. Profile scoring
compares normalized sector-height distributions at matched r/R, making it
symmetric, rotation independent and equal to one for identical valid inputs.
Depth/diameter separately retains crater amplitude information.

The cold metric now compares absolute target/Earth temperature midpoints. Its
provisional e-folding scale, 51.65 K, is frozen from the old Earth normalization
span rather than changing whenever candidates are added. Midpoints and thermal
swings have different seasonal/local-time support across instruments, so remain
cross-body proxies; availability coverage does not certify comparability or
instrument accuracy. No missing temperatures are fabricated.

Selected metrics combine geometrically within categories, followed by a geometric
mean of category scores. Terrain metrics share a fixed category budget, limiting
the influence of correlated slope/flatness/roughness measurements. This does not
claim to statistically remove all correlations. Temperature midpoint and swing
share a category. Categories have equal default weight; a site type may override
them with `dimension_weights` in `config/site_types.json`.

Evidence coverage is weighted availability, reported separately at category and
overall levels. Missing/invalid measurements do not become zero similarity.
An observed score remains available, but the published total is null below the
provisional 80% coverage threshold. Intentionally disabled metrics/sources and
inapplicable metrics leave the expected evidence set. Missing data inside a
category does not change that category's configured priority. Zero metric scores
use the documented epsilon floor, not an undeclared hard veto. Moon dust remains
filter/evidence-only and contributes neither score nor expected coverage.

Terrain grids are compared at a resolution no finer than either input. Shared
terrain distributions use a common physical window; crater profiles/depth retain
their full, radius-normalized windows. If native DEM caches are absent, a
calculations-only rebuild uses exported terrain at its actual coarser resolution
and records that provenance. Such grids cannot recover small-scale hazards.

Rebuild without changing any terrain assets:

```powershell
python scripts/analyze.py --calculations-only
```

The Python and browser aggregation paths are parity-tested. The rebuild writes
`web/data/calculation_validation.json`, reporting known analog/control results
without rank bonuses or fitting tolerances to force expected winners. A control
can legitimately match an individual property better than a known analog.
