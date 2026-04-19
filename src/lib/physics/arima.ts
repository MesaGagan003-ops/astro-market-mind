// ARIMA(1,1,1) — exactly per the notebook spec:
//   y'_t = c + φ₁·y'_{t-1} + θ₁·ε_{t-1} + ε_t
// where y'_t = Y_t - Y_{t-1}  (d=1, first difference).
//
// Fit:
//   1. Difference the price series.
//   2. Grid-search (φ, θ) by minimising Sum-of-Squared-Errors of the
//      one-step-ahead prediction on the in-sample residual recursion
//      (the same procedure described in the notebook: guess → score → optimise).
//   3. Estimate residual σ from the best-fit residuals.
//
// Forecast:
//   Recursive — at each step we sample a fresh shock ε_t ~ N(0, σ_resid)
//   so the projected path has realistic *wiggles* instead of a smooth line.
//   Future ε terms used in the MA component are the *previous* sampled shocks,
//   matching the actual ARIMA recursion.

export interface ArimaResult {
  c: number;          // drift constant
  phi: number;        // AR(1) coefficient
  theta: number;      // MA(1) coefficient
  residualStd: number;
  driftPerStep: number; // long-run expected change per step = c / (1 - φ)
  // Returns one stochastic price path of `steps` future prices.
  forecast: (steps: number, lastPrice: number, seed?: number) => number[];
}

// Tiny seedable RNG (mulberry32) so renders are deterministic per (coin, time).
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller standard normal from a uniform RNG.
function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function diff(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

// Score a candidate (c, φ, θ) by SSE of the one-step prediction recursion.
function scoreSSE(d: number[], c: number, phi: number, theta: number): { sse: number; resid: number[] } {
  const resid: number[] = [];
  let prevY = d[0];
  let prevE = 0;
  let sse = 0;
  for (let t = 1; t < d.length; t++) {
    const pred = c + phi * prevY + theta * prevE;
    const err = d[t] - pred;
    sse += err * err;
    resid.push(err);
    prevY = d[t];
    prevE = err;
  }
  return { sse, resid };
}

export function fitArima111(prices: number[]): ArimaResult {
  if (prices.length < 8) {
    return {
      c: 0, phi: 0, theta: 0, residualStd: 0, driftPerStep: 0,
      forecast: (steps, last) => Array(steps).fill(last),
    };
  }
  const d = diff(prices);
  const meanD = d.reduce((a, b) => a + b, 0) / d.length;

  // Grid search φ ∈ (-0.95, 0.95), θ ∈ (-0.95, 0.95). Notebook's
  // "guess → score → optimise" loop, vectorised over a coarse grid then refined.
  let best = { sse: Infinity, c: meanD, phi: 0, theta: 0 };
  for (let phi = -0.9; phi <= 0.9; phi += 0.1) {
    for (let theta = -0.9; theta <= 0.9; theta += 0.1) {
      // Optimal c given (φ,θ): mean of (d_t - φ·d_{t-1} - θ·ε_{t-1})
      // Approximate by mean(d) · (1 - φ) which is the closed-form for c.
      const c = meanD * (1 - phi);
      const { sse } = scoreSSE(d, c, phi, theta);
      if (sse < best.sse) best = { sse, c, phi, theta };
    }
  }
  // Local refine
  const step = 0.02;
  for (let dphi = -0.1; dphi <= 0.1; dphi += step) {
    for (let dtheta = -0.1; dtheta <= 0.1; dtheta += step) {
      const phi = Math.max(-0.98, Math.min(0.98, best.phi + dphi));
      const theta = Math.max(-0.98, Math.min(0.98, best.theta + dtheta));
      const c = meanD * (1 - phi);
      const { sse } = scoreSSE(d, c, phi, theta);
      if (sse < best.sse) best = { sse, c, phi, theta };
    }
  }

  const { resid } = scoreSSE(d, best.c, best.phi, best.theta);
  const residualStd = Math.sqrt(
    resid.reduce((a, b) => a + b * b, 0) / Math.max(1, resid.length),
  ) || 1e-9;

  // Long-run drift per step (stationary mean of y'_t)
  const driftPerStep = Math.abs(1 - best.phi) > 1e-6 ? best.c / (1 - best.phi) : best.c;

  const forecast = (steps: number, lastPrice: number, seed = 1) => {
    const rng = mulberry32(seed || 1);
    const out: number[] = [];
    let p = lastPrice;
    let prevY = d[d.length - 1] ?? 0;        // last observed differenced value
    let prevE = resid[resid.length - 1] ?? 0; // last in-sample shock
    // Clamp shocks to ±2σ so a single outlier residual cannot send the
    // whole forecast flying — keeps wiggles realistic but bounded.
    const shockCap = 2 * residualStd;
    for (let i = 0; i < steps; i++) {
      let eps = gaussian(rng) * residualStd;
      if (eps > shockCap) eps = shockCap;
      else if (eps < -shockCap) eps = -shockCap;
      const yPrime = best.c + best.phi * prevY + best.theta * prevE + eps;
      p += yPrime;
      out.push(p);
      prevY = yPrime;
      prevE = eps;
    }
    return out;
  };

  return { c: best.c, phi: best.phi, theta: best.theta, residualStd, driftPerStep, forecast };
}
