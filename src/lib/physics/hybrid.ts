// Hybrid prediction engine: ARIMA + GARCH + HMM + Shannon Entropy
// constrained by Quantum Speed Limit (QSL) and Stochastic Speed Limit (SSL).
//
// Path construction (per step i = 1..N):
//   1. ARIMA(1,1,1) recursive forecast with sampled shocks → wiggly path.
//   2. Add HMM regime drift bias  =  (P(bull) - P(bear)) · σ_garch
//      so the path leans in the direction of the dominant regime.
//   3. Dampen the deviation from the spot price by Shannon entropy edge
//      (high entropy → pull path back toward spot; low entropy → trust signal).
//   4. Hard-clip to QSL (Mandelstam–Tamm) ±2.4·σ·√i envelope.
//   5. Per-step bands: GARCH 1σ band, SSL 95% band.

import { fitArima111 } from "./arima";
import { fitGarch11 } from "./garch";
import { fitHmm3 } from "./hmm";
import { shannonEntropy } from "./entropy";
import { quantumSpeedLimit, stochasticSpeedLimit, type SpeedLimit } from "./speedLimits";

export interface ForecastPoint {
  step: number;
  price: number;
  upper: number; // GARCH 1σ
  lower: number;
  qslUpper: number;
  qslLower: number;
  sslUpper: number;
  sslLower: number;
}

export interface HybridResult {
  arima: ReturnType<typeof fitArima111>;
  garch: ReturnType<typeof fitGarch11>;
  hmm: ReturnType<typeof fitHmm3>;
  entropy: ReturnType<typeof shannonEntropy>;
  qsl: SpeedLimit;
  ssl: SpeedLimit;
  forecast: ForecastPoint[];
  finalPrice: number;
  direction: "up" | "down" | "flat";
  hybridConfidence: number;
  weights: { arima: number; hmm: number; entropy: number };
}

export function hybridPredict(prices: number[], steps: number): HybridResult {
  const arima = fitArima111(prices);
  const garch = fitGarch11(prices);
  const hmm = fitHmm3(prices);
  const entropy = shannonEntropy(prices);
  const last = prices[prices.length - 1];

  // Seed RNG from the last price + length so wiggles are stable per snapshot
  // but evolve as new ticks arrive.
  const seed = Math.floor(Math.abs(last * 1000) + prices.length * 7919) || 1;
  const arimaPath = arima.forecast(steps, last, seed);

  const sigmas = garch.forecastSigma(steps);
  const regimeBias = hmm.stateProbs[2] - hmm.stateProbs[0]; // [-1, 1]
  const edge = entropy.edge; // [0, 1]; higher = more signal vs noise

  const qsl = quantumSpeedLimit(last, garch.sigma, steps);
  const ssl = stochasticSpeedLimit(last, arima.driftPerStep + regimeBias * garch.sigma * 0.1, garch.sigma, steps);

  // Weights are reported only — not "magic numbers". The actual blending
  // happens via the additive HMM bias and entropy damping below.
  const weights = { arima: 0.5, hmm: 0.3, entropy: edge };

  const forecast: ForecastPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const sigma = sigmas[i] || garch.sigma;
    // 1) ARIMA stochastic baseline
    let price = arimaPath[i];
    // 2) HMM regime push: cumulative drift over time
    price += regimeBias * garch.sigma * 0.25 * (i + 1);
    // 3) Entropy damping: shrink deviation toward spot when entropy high
    const dev = price - last;
    price = last + dev * (0.25 + 0.75 * edge);
    // 4) QSL hard clip
    const qslU = last + 2.4 * garch.sigma * Math.sqrt(i + 1);
    const qslL = last - 2.4 * garch.sigma * Math.sqrt(i + 1);
    price = Math.min(qslU, Math.max(qslL, price));

    // SSL band (Itô diffusion 95% CI)
    const drift = arima.driftPerStep + regimeBias * garch.sigma * 0.1;
    const sslU = last + drift * (i + 1) + 1.96 * sigma * Math.sqrt(i + 1);
    const sslL = last + drift * (i + 1) - 1.96 * sigma * Math.sqrt(i + 1);

    forecast.push({
      step: i + 1,
      price,
      upper: price + sigma,
      lower: price - sigma,
      qslUpper: qslU,
      qslLower: qslL,
      sslUpper: sslU,
      sslLower: sslL,
    });
  }

  const finalPrice = forecast[forecast.length - 1].price;
  const delta = finalPrice - last;
  const direction: "up" | "down" | "flat" =
    Math.abs(delta) < garch.sigma * 0.3 ? "flat" : delta > 0 ? "up" : "down";

  // Confidence = entropy edge ⊕ HMM confidence ⊕ regime/direction agreement
  const regimeAgrees =
    direction === "up" ? hmm.stateProbs[2] :
    direction === "down" ? hmm.stateProbs[0] :
    hmm.stateProbs[1];
  const hybridConfidence = Math.max(0, Math.min(1,
    0.4 * edge + 0.3 * hmm.confidence + 0.3 * regimeAgrees,
  ));

  return {
    arima, garch, hmm, entropy, qsl, ssl,
    forecast, finalPrice, direction, hybridConfidence, weights,
  };
}
