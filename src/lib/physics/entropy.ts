// Shannon entropy of return-sign sequence, normalized to [0, 1].
// H ~ 1 means returns are nearly random (no edge).
// H << 1 means strong directional structure.

export interface EntropyResult {
  H: number; // normalized entropy in [0, 1]
  edge: number; // 1 - H, the "information edge"
  upRatio: number;
}

export function shannonEntropy(prices: number[], bins = 8): EntropyResult {
  if (prices.length < 6) return { H: 1, edge: 0, upRatio: 0.5 };
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(prices[i] - prices[i - 1]);

  // Discretize into `bins` quantile buckets for richer entropy estimate
  const sorted = [...returns].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 1; i < bins; i++) cuts.push(sorted[Math.floor((sorted.length * i) / bins)]);

  const counts = Array(bins).fill(0);
  for (const r of returns) {
    let b = 0;
    while (b < cuts.length && r > cuts[b]) b++;
    counts[b]++;
  }
  const total = returns.length;
  let H = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    H -= p * Math.log2(p);
  }
  const Hnorm = H / Math.log2(bins);
  const ups = returns.filter((r) => r > 0).length;
  return { H: Math.min(1, Math.max(0, Hnorm)), edge: 1 - Hnorm, upRatio: ups / total };
}
