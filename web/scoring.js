/** Weighted geometric mean of measured 0-1 matches. A measured zero is a mismatch. */
export function weightedGeometricMean(pairs) {
  if (!pairs.length) return null;
  const total = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0 || pairs.some(([score, weight]) =>
    !Number.isFinite(score) || !Number.isFinite(weight) || weight < 0 || score < 0 || score > 1)) {
    throw new Error("scores must be in [0, 1] and weights must be nonnegative with a positive total");
  }
  if (pairs.some(([score, weight]) => score === 0 && weight > 0)) return 0;
  return Math.exp(pairs.reduce((sum, [score, weight]) =>
    sum + (weight > 0 ? weight * Math.log(score) : 0), 0) / total);
}
