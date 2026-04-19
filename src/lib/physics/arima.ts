// ARIMA(2,1,2) — autoregressive integrated moving average
// Differencing once, then AR(2) + MA(2) on returns. Lightweight OLS-style fit.

export interface ArimaResult {
  drift: number; // expected change per step
  ar1: number;
  ar2: number;
  ma1: number;
  ma2: number;
  residualStd: number;
  forecast: (steps: number, lastPrice: number) => number[];
}

function diff(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) out.push(series[i] - series[i - 1]);
  return out;
}

// Simple Yule-Walker style AR(2) coefficient estimation
function estimateAR(series: number[]): [number, number] {
  const n = series.length;
  if (n < 4) return [0, 0];
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const centered = series.map((x) => x - mean);
  let r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < n; i++) r0 += centered[i] ** 2;
  for (let i = 0; i < n - 1; i++) r1 += centered[i] * centered[i + 1];
  for (let i = 0; i < n - 2; i++) r2 += centered[i] * centered[i + 2];
  r0 /= n; r1 /= n; r2 /= n;
  if (r0 === 0) return [0, 0];
  const rho1 = r1 / r0;
  const rho2 = r2 / r0;
  const denom = 1 - rho1 * rho1;
  if (Math.abs(denom) < 1e-9) return [0, 0];
  const phi1 = (rho1 * (1 - rho2)) / denom;
  const phi2 = (rho2 - rho1 * rho1) / denom;
  return [
    Math.max(-0.99, Math.min(0.99, phi1)),
    Math.max(-0.99, Math.min(0.99, phi2)),
  ];
}

export function fitArima212(prices: number[]): ArimaResult {
  if (prices.length < 8) {
    return {
      drift: 0, ar1: 0, ar2: 0, ma1: 0, ma2: 0, residualStd: 0,
      forecast: (steps, last) => Array(steps).fill(last),
    };
  }
  const returns = diff(prices);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const [ar1, ar2] = estimateAR(returns);

  // Residuals from AR fit
  const resid: number[] = [];
  for (let i = 2; i < returns.length; i++) {
    const pred = mean + ar1 * (returns[i - 1] - mean) + ar2 * (returns[i - 2] - mean);
    resid.push(returns[i] - pred);
  }
  // MA terms via lag-1/lag-2 autocorrelation of residuals (approximation)
  let ma1 = 0, ma2 = 0;
  if (resid.length > 4) {
    const rmean = resid.reduce((a, b) => a + b, 0) / resid.length;
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < resid.length; i++) s0 += (resid[i] - rmean) ** 2;
    for (let i = 0; i < resid.length - 1; i++) s1 += (resid[i] - rmean) * (resid[i + 1] - rmean);
    for (let i = 0; i < resid.length - 2; i++) s2 += (resid[i] - rmean) * (resid[i + 2] - rmean);
    if (s0 > 0) {
      ma1 = Math.max(-0.95, Math.min(0.95, s1 / s0));
      ma2 = Math.max(-0.95, Math.min(0.95, s2 / s0));
    }
  }

  const residualStd = Math.sqrt(
    resid.reduce((a, b) => a + b * b, 0) / Math.max(1, resid.length),
  );

  const drift = mean + ar1 * mean + ar2 * mean;

  const forecast = (steps: number, lastPrice: number) => {
    const out: number[] = [];
    let p = lastPrice;
    let r1 = returns[returns.length - 1] ?? 0;
    let r2 = returns[returns.length - 2] ?? 0;
    let e1 = resid[resid.length - 1] ?? 0;
    let e2 = resid[resid.length - 2] ?? 0;
    for (let i = 0; i < steps; i++) {
      const r = mean + ar1 * (r1 - mean) + ar2 * (r2 - mean) + ma1 * e1 + ma2 * e2;
      p += r;
      out.push(p);
      r2 = r1; r1 = r;
      e2 = e1; e1 = 0; // future shocks expected to be zero
    }
    return out;
  };

  return { drift, ar1, ar2, ma1, ma2, residualStd, forecast };
}
