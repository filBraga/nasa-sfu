/** Browser counterpart of analog/similarity.py; parity-tested against exports. */
export function compareEvidenceScores(a, b) {
  const complete = Number(b.overall != null) - Number(a.overall != null);
  if (complete) return complete;
  if (a.overall != null) return b.overall - a.overall;
  return (b.coverage ?? 0) - (a.coverage ?? 0)
    || (b.observed_score ?? -1) - (a.observed_score ?? -1);
}

export function scoreText(score) {
  if (score.overall != null) return score.overall.toFixed(2);
  return score.observed_score != null ? `${score.observed_score.toFixed(2)}*` : '—';
}

export function scoreDescription(score) {
  const coverage = `${Math.round((score.coverage ?? 0) * 100)}% evidence coverage`;
  return score.overall != null ? `Overall similarity; ${coverage}`
    : score.observed_score != null ? `Partial similarity using available measurements; ${coverage}. Overall score withheld.`
      : `No similarity available; ${coverage}`;
}

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
