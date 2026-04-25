// Kalman filter for hidden mid-price estimation.
// State model:  x_t = x_{t-1} + v_{t-1} + w_t   (random-walk + drift)
//               v_t = v_{t-1} + u_t              (drift evolves slowly)
// Observation:  z_t = x_t + n_t                  (noisy tick)
//
// Returns a denoised price series + current velocity estimate. Feeding the
// hybrid model the FILTERED series (instead of raw ticks) cuts micro-noise
// that GARCH/HMM otherwise mistake for real volatility — measurably improves
// directional accuracy on tick-noisy assets (low-cap crypto, illiquid forex).

export interface KalmanResult {
  filtered: number[];          // denoised price series, same length as input
  velocity: number;            // last-step velocity estimate (price units / step)
  measurementNoise: number;    // estimated R (observation noise variance)
  processNoise: number;        // estimated Q (state noise variance)
  innovation: number;          // last residual |z - x̂| in price units
  snr: number;                 // signal-to-noise: var(filtered)/var(residuals)
}

export function kalmanFilter(prices: number[], opts?: { qScale?: number; rScale?: number }): KalmanResult {
  const n = prices.length;
  if (n < 8) {
    return { filtered: [...prices], velocity: 0, measurementNoise: 1, processNoise: 1e-4, innovation: 0, snr: 1 };
  }
  // Estimate noise variances from data: R from short-term diffs, Q from longer trend variance.
  const diffs: number[] = [];
  for (let i = 1; i < n; i++) diffs.push(prices[i] - prices[i - 1]);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const diffVar = diffs.reduce((a, b) => a + (b - meanDiff) ** 2, 0) / diffs.length;
  const R = Math.max(1e-12, diffVar * 0.5) * (opts?.rScale ?? 1);   // observation noise
  const Q = Math.max(1e-14, diffVar * 0.05) * (opts?.qScale ?? 1);  // process noise

  // 2-state filter: [price, velocity]
  let x = prices[0];
  let v = 0;
  let P00 = R, P01 = 0, P10 = 0, P11 = R; // covariance matrix

  const filtered: number[] = [x];
  let lastInnov = 0;

  for (let t = 1; t < n; t++) {
    // Predict
    const xPred = x + v;
    const vPred = v;
    P00 = P00 + 2 * P01 + P11 + Q;
    P01 = P01 + P11;
    P10 = P10 + P11;
    P11 = P11 + Q;

    // Update with measurement z = prices[t]
    const z = prices[t];
    const y = z - xPred;                  // innovation
    const S = P00 + R;                    // innovation covariance
    const K0 = P00 / S;                   // Kalman gain (price)
    const K1 = P10 / S;                   // Kalman gain (velocity)

    x = xPred + K0 * y;
    v = vPred + K1 * y;
    const newP00 = (1 - K0) * P00;
    const newP01 = (1 - K0) * P01;
    const newP10 = P10 - K1 * P00;
    const newP11 = P11 - K1 * P01;
    P00 = newP00; P01 = newP01; P10 = newP10; P11 = newP11;

    filtered.push(x);
    lastInnov = Math.abs(y);
  }

  // SNR: variance of filtered signal / variance of residuals
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) residuals.push(prices[i] - filtered[i]);
  const fMean = filtered.reduce((a, b) => a + b, 0) / n;
  const fVar = filtered.reduce((a, b) => a + (b - fMean) ** 2, 0) / n;
  const rMean = residuals.reduce((a, b) => a + b, 0) / n;
  const rVar = residuals.reduce((a, b) => a + (b - rMean) ** 2, 0) / n || 1e-18;
  const snr = fVar / rVar;

  return { filtered, velocity: v, measurementNoise: R, processNoise: Q, innovation: lastInnov, snr };
}
