/** Ways to combine per-dimension similarity scores (each 0-1) into one overall score.
 *
 *  The per-dimension scores themselves are computed in Python (analog/compare.py, analog/layers.py)
 *  and exported to web/data/results.json. This module only decides how they are weighted together,
 *  so the viewer can switch between the team's algorithms and re-weight live.
 *
 *  Every algorithm takes the same input and returns the same shape:
 *    combine({ scores, dims, weights, categoryWeights, minCoverage, body, expected })
 *      scores  {dimKey: 0-1}            only the dimensions that count for this pair
 *      expected [dimKey]                 dimensions the user asked for (with or without data)
 *      weights {dimKey: weight}          effective per-dimension weights (slider values)
 *    -> { overall, observed_score, coverage, groups }
 *  `overall` is the published score (null if nothing to score, or withheld for low coverage).
 */

// ------------------------------------------------------------------ original (main)
/** Weighted arithmetic mean: the original rule on main. */
export function weightedMean(pairs) {
  const live = pairs.filter(([, w]) => w > 0);
  const total = live.reduce((s, [, w]) => s + w, 0);
  return total > 0 ? live.reduce((s, [v, w]) => s + w * v, 0) / total : null;
}

// ------------------------------------------------------------------ feature/the-scoring-system
/** Weighted geometric mean of measured 0-1 matches. A measured zero is a mismatch.
 *  Ported from web/scoring.js on feature/the-scoring-system. */
export function weightedGeometricMean(pairs) {
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null; // every slider at 0: nothing to score (the original threw here)
  if (pairs.some(([score, weight]) =>
    !Number.isFinite(score) || !Number.isFinite(weight) || weight < 0 || score < 0 || score > 1)) {
    throw new Error("scores must be in [0, 1] and weights must be nonnegative with a positive total");
  }
  if (pairs.some(([score, weight]) => score === 0 && weight > 0)) return 0;
  return Math.exp(pairs.reduce((sum, [score, weight]) =>
    sum + (weight > 0 ? weight * Math.log(score) : 0), 0) / total);
}

// ------------------------------------------------------------------ fix/calculation
/** Default policy from config/similarity.json on fix/calculation. */
export const SIMILARITY_POLICY = {
  version: "physical-similarity-v1",
  epsilon: 1e-12,
  min_coverage: 0.8,
  dimension_weights: { terrain: 1, temperature: 1, dust: 1, plants: 1, materials: 1, radar: 1 },
};

/** Category of a dimension, as in analog/similarity.py: metric_category() on fix/calculation. */
export function metricCategory(key, d) {
  return d.category || (d.group === "terrain" || key === "demo_tpi" ? "terrain" : {
    cold: "temperature", thermal_amplitude: "temperature",
    surface_dust: "dust", barren_ground: "plants", albedo: "materials", radar_cpr: "radar",
  }[key] || key);
}

/** Hierarchical weighted geometric mean with evidence coverage.
 *  Ported from web/similarity.js: aggregateSimilarity() on fix/calculation.
 *  Metrics combine geometrically within categories, then categories combine geometrically.
 *  Missing values lower coverage instead of counting as zero; below `min_coverage` the
 *  overall score is withheld (null) while `observed_score` stays available. */
export function aggregateSimilarity(scores, dimensions, selected, {
  body = null, notApplicable = [], dimensionWeights = {}, config,
} = {}) {
  const { epsilon, min_coverage: threshold } = config;
  const weights = { ...config.dimension_weights, ...dimensionWeights };
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1 ||
      !Number.isFinite(epsilon) || epsilon <= 0 || epsilon >= 1 ||
      Object.values(weights).some(w => !Number.isFinite(w) || w < 0)) throw Error('Invalid similarity policy');
  const excluded = new Set(notApplicable), groups = new Map();
  const mean = values => {
    if (!values.length) return null;
    const scale = Math.max(...values.map(([, w]) => w));
    return Math.min(1, Math.exp(values.reduce((s, [v, w]) => s + (w / scale) * Math.log(Math.max(v, epsilon)), 0) / values.reduce((s, [, w]) => s + w / scale, 0)));
  };
  for (const key of selected) {
    const d = dimensions[key];
    if (excluded.has(key) || d.score_excluded_bodies?.includes(body)) continue;
    if (!Number.isFinite(d.weight) || d.weight < 0) throw Error('Invalid metric weight');
    const category = d.category || (d.group === 'terrain' ? 'terrain' : key);
    const weight = weights[category] ?? 1;
    if (d.weight === 0 || weight === 0) continue;
    if (!groups.has(category)) groups.set(category, { expected: [], values: [], weight });
    const group = groups.get(category);
    group.expected.push(d.weight);
    const value = scores[key];
    if (Number.isFinite(value) && value >= 0 && value <= 1) group.values.push([value, d.weight]);
  }
  let total = 0, covered = 0;
  const scale = Math.max(1e-300, ...[...groups.values()].map(g => g.weight));
  const observed = [], details = {};
  for (const [key, group] of groups) {
    const metricScale = Math.max(...group.expected);
    const coverage = group.values.reduce((s, [, w]) => s + w / metricScale, 0) / group.expected.reduce((s, w) => s + w / metricScale, 0);
    const score = mean(group.values);
    total += group.weight / scale;
    covered += (group.weight / scale) * coverage;
    if (score != null) observed.push([score, group.weight]);
    details[key] = { score, coverage, weight: group.weight };
  }
  const coverage = total ? Math.min(1, covered / total) : 0;
  const observedScore = mean(observed);
  return { score: observedScore != null && coverage >= threshold ? observedScore : null,
    observed_score: observedScore, coverage, groups: details };
}

/** Sort comparator from fix/calculation: published scores first, then by coverage. */
export function compareEvidenceScores(a, b) {
  const complete = Number(b.overall != null) - Number(a.overall != null);
  if (complete) return complete;
  if (a.overall != null) return b.overall - a.overall;
  return (b.coverage ?? 0) - (a.coverage ?? 0)
    || (b.observed_score ?? -1) - (a.observed_score ?? -1);
}

// ------------------------------------------------------------------ the switchable list
const flat = (fn) => ({ scores, weights }) => {
  const pairs = Object.entries(scores).map(([k, v]) => [v, weights[k]]).filter(([, w]) => w > 0);
  const overall = fn(pairs);
  return { overall, observed_score: overall, coverage: null, groups: null };
};

export const ALGORITHMS = {
  weighted_mean: {
    label: "Weighted mean",
    origin: "main (original)",
    summary: "Each dimension's score times its weight, divided by the total weight. A strong dimension can make up for a weak one.",
    combine: flat(weightedMean),
  },
  geometric: {
    label: "Weighted geometric mean",
    origin: "feature/the-scoring-system",
    summary: "exp(Σ w·ln score / Σ w). A weak dimension pulls the whole match down, and a measured 0 makes the match 0. Dimensions without data are left out.",
    combine: flat(weightedGeometricMean),
  },
  hierarchical: {
    label: "Category geometric mean + coverage",
    origin: "fix/calculation",
    summary: "Geometric mean inside each category (terrain, temperature, dust, plants…), then a geometric mean of the categories, so many correlated terrain metrics can't outvote one category. Missing data lowers evidence coverage; below the minimum coverage the score is withheld and shown with *.",
    usesCategories: true,
    combine: ({ scores, dims, weights, categoryWeights, minCoverage, body, expected }) => {
      const dimensions = {};
      for (const k of expected) dimensions[k] = { ...dims[k], weight: weights[k], category: metricCategory(k, dims[k]) };
      const r = aggregateSimilarity(scores, dimensions, expected, {
        body, dimensionWeights: categoryWeights,
        config: { ...SIMILARITY_POLICY, min_coverage: minCoverage ?? SIMILARITY_POLICY.min_coverage },
      });
      return { overall: r.score, observed_score: r.observed_score, coverage: r.coverage, groups: r.groups };
    },
  },
};
export const DEFAULT_ALGORITHM = "weighted_mean";

// ------------------------------------------------------------------ viewer-added datasets
/** Similarity of two values of a dataset the viewer uploaded. */
export const USER_METHODS = {
  difference: {
    label: "Difference",
    describe: (scale, unit) => `score = exp(-|difference| / ${scale}${unit ? " " + unit : ""}): 1.0 when equal, 0.37 at one scale apart.`,
    score: (a, b, scale) => Math.exp(-Math.abs(a - b) / scale),
  },
  ratio: {
    label: "Ratio",
    describe: () => "score = 0.5^(|ln(a/b)| / ln 4): 1.0 when equal, 0.5 at a 4x difference, 0.25 at 16x. Values must be > 0.",
    score: (a, b) => (a > 0 && b > 0 ? 0.5 ** (Math.abs(Math.log(a / b)) / Math.log(4)) : null),
  },
};

/** Parse "site,value" CSV/TSV (header optional) or JSON ({site: value} or [{site, value}]). */
export function parseSiteValues(text) {
  const t = text.trim();
  if (!t) return [];
  if (t[0] === "{" || t[0] === "[") {
    const j = JSON.parse(t);
    const rows = Array.isArray(j) ? j.map((r) => [r.site ?? r.id ?? r.name, r.value]) : Object.entries(j);
    return rows.map(([s, v]) => [String(s ?? "").trim(), Number(v)]).filter(([s, v]) => s && Number.isFinite(v));
  }
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    const v = Number(cells[cells.length - 1]);
    if (cells.length < 2 || cells[cells.length - 1] === "" || !Number.isFinite(v)) continue; // header or junk
    out.push([cells[0], v]);
  }
  return out;
}
