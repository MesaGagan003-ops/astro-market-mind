// Extra physics features from the roadmap (guide phase 2):
//   - Hurst exponent (trend persistence vs mean-reversion)
//   - Hamiltonian energy (kinetic + potential price energy)
// These feed into the hybrid model as drift / trust modulators.

export interface HurstResult {
  H: number;          // 0.5 = random walk, >0.5 trending, <0.5 mean-reverting
  regime: "trending" | "mean_reverting" | "random";
}

// Rescaled-range / variance-of-lagged-diff estimator (Mandelbrot-Wallis flavour).
export function hurstExponent(prices: number[], maxLag = 20): HurstResult {
  if (prices.length < 30) return { H: 0.5, regime: "random" };
  const lags: number[] = [];
  const tau: number[] = [];
  const upper = Math.min(maxLag, Math.floor(prices.length / 4));
  for (let lag = 2; lag <= upper; lag++) {
    const diffs: number[] = [];
    for (let i = lag; i < prices.length; i++) diffs.push(prices[i] - prices[i - lag]);
    const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const v = diffs.reduce((a, b) => a + (b - m) * (b - m), 0) / diffs.length;
    const s = Math.sqrt(Math.max(v, 1e-18));
    if (s <= 0) continue;
    lags.push(Math.log(lag));
    tau.push(Math.log(s));
  }
  if (lags.length < 3) return { H: 0.5, regime: "random" };
  // OLS slope of log(tau) vs log(lag)
  const n = lags.length;
  const mx = lags.reduce((a, b) => a + b, 0) / n;
  const my = tau.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (lags[i] - mx) * (tau[i] - my);
    den += (lags[i] - mx) * (lags[i] - mx);
  }
  const H = den > 0 ? Math.max(0, Math.min(1, num / den)) : 0.5;
  const regime: HurstResult["regime"] =
    H > 0.55 ? "trending" : H < 0.45 ? "mean_reverting" : "random";
  return { H, regime };
}

export interface HamiltonianResult {
  H: number;        // total energy
  KE: number;       // kinetic (recent velocity²)
  PE: number;       // potential (squared deviation from MA)
  velocity: number; // signed recent drift
  direction: "up" | "down";
}

// H = ½ v² + ½ k (P − P_eq)²  with P_eq = SMA(window).
export function hamiltonianEnergy(prices: number[], window = 50): HamiltonianResult {
  if (prices.length < 6) return { H: 0, KE: 0, PE: 0, velocity: 0, direction: "up" };
  const slice = prices.slice(-Math.min(window, prices.length));
  const last = slice[slice.length - 1];
  // log-return velocity over last 5 bars (or as many as available)
  const k = Math.min(5, slice.length - 1);
  const v = Math.log(last / slice[slice.length - 1 - k]) / k;
  const KE = 0.5 * v * v;
  const ma = slice.reduce((a, b) => a + b, 0) / slice.length;
  const dev = (last - ma) / ma;
  const PE = 0.5 * dev * dev;
  return { H: KE + PE, KE, PE, velocity: v, direction: v >= 0 ? "up" : "down" };
}
