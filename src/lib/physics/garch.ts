// GARCH(1,1): sigma_t^2 = omega + alpha * eps_{t-1}^2 + beta * sigma_{t-1}^2
// Method-of-moments + grid refinement on (alpha, beta) — fast and stable.

export interface GarchResult {
  omega: number;
  alpha: number;
  beta: number;
  sigma: number; // current 1-step sigma (in price units)
  longRunVar: number;
  forecastSigma: (steps: number) => number[]; // per-step sigma horizon
}

export function fitGarch11(prices: number[]): GarchResult {
  if (prices.length < 20) {
    return {
      omega: 0, alpha: 0.05, beta: 0.92, sigma: 0, longRunVar: 0,
      forecastSigma: (steps) => Array(steps).fill(0),
    };
  }
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(prices[i] - prices[i - 1]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const eps = returns.map((r) => r - mean);
  const variance = eps.reduce((a, b) => a + b * b, 0) / eps.length;

  // Grid search small space — alpha+beta < 1, keep persistent
  let best = { ll: -Infinity, alpha: 0.08, beta: 0.9, omega: variance * 0.02 };
  for (let alpha = 0.02; alpha <= 0.2; alpha += 0.02) {
    for (let beta = 0.7; beta <= 0.97; beta += 0.03) {
      if (alpha + beta >= 0.999) continue;
      const omega = variance * (1 - alpha - beta);
      if (omega <= 0) continue;
      // log-likelihood
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

  // Compute current sigma
  let s2 = variance;
  for (let i = 0; i < eps.length; i++) {
    s2 = best.omega + best.alpha * eps[i] * eps[i] + best.beta * s2;
  }
  const sigma = Math.sqrt(s2);
  const longRunVar = best.omega / (1 - best.alpha - best.beta);

  const forecastSigma = (steps: number) => {
    const out: number[] = [];
    let v = s2;
    const ab = best.alpha + best.beta;
    for (let i = 0; i < steps; i++) {
      v = best.omega + ab * v;
      out.push(Math.sqrt(v));
    }
    return out;
  };

  return { omega: best.omega, alpha: best.alpha, beta: best.beta, sigma, longRunVar, forecastSigma };
}
