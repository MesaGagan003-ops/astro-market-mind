// GARCH(1,1) on LOG-RETURNS (scale-invariant across BTC ↔ PEPE).
//   r_t = log(P_t / P_{t-1})
//   sigma_r^2_t = omega + alpha * eps^2_{t-1} + beta * sigma_r^2_{t-1}
// We expose `sigma` in PRICE units (sigma_r * lastPrice) so the rest of the
// hybrid model — which still operates in price space — sees identical
// behaviour for any asset price level.

export interface GarchResult {
  omega: number;
  alpha: number;
  beta: number;
  sigma: number;        // current 1-step sigma in PRICE units
  sigmaReturn: number;  // current 1-step sigma in LOG-RETURN units (scale-free)
  longRunVar: number;
  forecastSigma: (steps: number) => number[]; // per-step sigma horizon (price units)
}

export function fitGarch11(prices: number[]): GarchResult {
  if (prices.length < 20) {
    return {
      omega: 0, alpha: 0.05, beta: 0.92, sigma: 0, sigmaReturn: 0, longRunVar: 0,
      forecastSigma: (steps) => Array(steps).fill(0),
    };
  }
  const last = prices[prices.length - 1];
  // Use log-returns instead of price differences → identical statistics for
  // BTC ($100k) and PEPE ($0.000012). Without this switch, GARCH for low-
  // priced coins fits a near-zero omega and produces useless forecasts.
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const eps = returns.map((r) => r - mean);
  const variance = eps.reduce((a, b) => a + b * b, 0) / eps.length || 1e-12;

  let best = { ll: -Infinity, alpha: 0.08, beta: 0.9, omega: variance * 0.02 };
  for (let alpha = 0.02; alpha <= 0.2; alpha += 0.02) {
    for (let beta = 0.7; beta <= 0.97; beta += 0.03) {
      if (alpha + beta >= 0.999) continue;
      const omega = variance * (1 - alpha - beta);
      if (omega <= 0) continue;
      let s2 = variance;
      let ll = 0;
      for (let i = 0; i < eps.length; i++) {
        s2 = omega + alpha * eps[i] * eps[i] + beta * s2;
        if (s2 <= 0) { ll = -Infinity; break; }
        ll += -0.5 * (Math.log(2 * Math.PI * s2) + (eps[i] * eps[i]) / s2);
      }
      if (ll > best.ll) best = { ll, alpha, beta, omega };
    }
  }

  let s2 = variance;
  for (let i = 0; i < eps.length; i++) {
    s2 = best.omega + best.alpha * eps[i] * eps[i] + best.beta * s2;
  }
  const sigmaReturn = Math.sqrt(s2);
  // Map back to price units: σ_price ≈ σ_logreturn · P (first-order Itô)
  const sigma = sigmaReturn * last;
  const longRunVar = best.omega / Math.max(1e-12, 1 - best.alpha - best.beta);

  const forecastSigma = (steps: number) => {
    const out: number[] = [];
    let v = s2;
    const ab = best.alpha + best.beta;
    for (let i = 0; i < steps; i++) {
      v = best.omega + ab * v;
      out.push(Math.sqrt(v) * last); // price units
    }
    return out;
  };

  return { omega: best.omega, alpha: best.alpha, beta: best.beta, sigma, sigmaReturn, longRunVar, forecastSigma };
}
