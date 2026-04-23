// Hybrid prediction engine: ARIMA + GARCH + HMM + Shannon Entropy
// + Hurst exponent + Hamiltonian energy, constrained by QSL and SSL.
//
// Path construction (per step i = 1..N):
//   1. ARIMA(1,1,1) recursive forecast with capped shocks → wiggly path.
//   2. Add HMM regime drift bias = (P(bull) - P(bear)) · σ
//   3. Add Hamiltonian velocity bias proportional to recent kinetic energy.
//   4. Hurst-aware trust factor: trending markets keep deviation, mean-
//      reverting markets pull harder back to spot.
//   5. Entropy damping: high H → shrink deviation toward spot.
//   6. QSL hard clip ±2.4·σ·√i.
//   7. Light EMA smoothing pass to remove tick-scale jitter.

import { fitArima111 } from "./arima";
import { fitGarch11 } from "./garch";
import { fitHmm3 } from "./hmm";
import { shannonEntropy } from "./entropy";
import { hurstExponent, hamiltonianEnergy, type HurstResult, type HamiltonianResult } from "./features";
import { quantumSpeedLimit, stochasticSpeedLimit, type SpeedLimit } from "./speedLimits";

export interface ForecastPoint {
  step: number;
  price: number;
  upper: number;
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
  hurst: HurstResult;
  hamiltonian: HamiltonianResult;
  qsl: SpeedLimit;
  ssl: SpeedLimit;
  forecast: ForecastPoint[];
  finalPrice: number;
  direction: "up" | "down" | "flat";
  hybridConfidence: number;
  weights: { arima: number; hmm: number; entropy: number; hurst: number; llm: number };
}

export interface HybridOptions {
  adaptiveWeights?: Partial<{ arima: number; hmm: number; entropy: number; hurst: number; llm: number }>;
  llmBias?: number;
  llmConfidence?: number;
  dataQualityScore?: number; // 0..1, where 1 = perfect data
}

export function hybridPredict(prices: number[], steps: number, options?: HybridOptions): HybridResult {
  const arima = fitArima111(prices);
  const garch = fitGarch11(prices);
  const hmm = fitHmm3(prices);
  const entropy = shannonEntropy(prices);
  const hurst = hurstExponent(prices);
  const hamiltonian = hamiltonianEnergy(prices);
  const last = prices[prices.length - 1];

  // Seed by series LENGTH only (not by exact price). This keeps the wiggle
  // pattern stable while a 1-min bucket is being accumulated; it only
  // changes when a new bar closes — preventing the predicted line from
  // jumping wildly on every tick.
  const seed = (prices.length * 2654435761) >>> 0 || 1;
  const arimaPath = arima.forecast(steps, last, seed);

  const sigmas = garch.forecastSigma(steps);
  const regimeBias = hmm.stateProbs[2] - hmm.stateProbs[0]; // [-1, 1]
  const edge = entropy.edge;

  // Hurst-modulated trust: trending → keep ARIMA deviation,
  // mean-reverting → shrink it harder. Map H∈[0,1] to trust∈[0.3, 1].
  const hurstTrust = 0.3 + 0.7 * Math.max(0, Math.min(1, (hurst.H - 0.3) / 0.5));

  // Hamiltonian velocity bias (small, per-step) — adds momentum push.
  const hamPush = Math.sign(hamiltonian.velocity) * Math.min(Math.abs(hamiltonian.velocity), 0.005) * last;

  const qsl = quantumSpeedLimit(last, garch.sigma, steps);
  const ssl = stochasticSpeedLimit(
    last,
    arima.driftPerStep + regimeBias * garch.sigma * 0.1 + hamPush * 0.5,
    garch.sigma,
    steps,
  );

  const llmBias = Math.max(-1, Math.min(1, Number(options?.llmBias ?? 0)));
  const llmConfidence = Math.max(0, Math.min(1, Number(options?.llmConfidence ?? 0)));
  const qualityPenalty = Math.max(0, Math.min(1, Number(options?.dataQualityScore ?? 1)));
  // If data quality is poor, reduce confidence. E.g., 0.5 quality → 0.5x confidence multiplier

  const learned = {
    arima: Math.max(0.05, Number(options?.adaptiveWeights?.arima ?? 0.45)),
    hmm: Math.max(0.05, Number(options?.adaptiveWeights?.hmm ?? 0.25)),
    entropy: Math.max(0.05, Number(options?.adaptiveWeights?.entropy ?? edge)),
    hurst: Math.max(0.05, Number(options?.adaptiveWeights?.hurst ?? hurstTrust)),
    llm: 0,
  };
  const learnedSum = learned.arima + learned.hmm + learned.entropy + learned.hurst + learned.llm;
  const weights = {
    arima: learned.arima / learnedSum,
    hmm: learned.hmm / learnedSum,
    entropy: learned.entropy / learnedSum,
    hurst: learned.hurst / learnedSum,
    llm: learned.llm / learnedSum,
  };

  // Build path keeping ARIMA wiggles intact. We split each step into
  //   trend  = drift + HMM bias + Hamiltonian push   (cumulative)
  //   wiggle = arimaPath[i] - last - i·driftPerStep   (the stochastic part)
  // and dampen ONLY the trend, never the wiggle. This guarantees visible
  // shocks regardless of entropy / Hurst values.
  const raw: number[] = [];
  const trustTrend = (0.25 + 0.75 * edge) * hurstTrust;
  for (let i = 0; i < steps; i++) {
    const baseDrift = arima.driftPerStep * (i + 1);
    const wiggle = arimaPath[i] - last - baseDrift; // pure stochastic component
    let trend = baseDrift
      + regimeBias * garch.sigma * 0.18 * (i + 1)
      + hamPush * (i + 1) * 0.4
      + llmBias * llmConfidence * weights.llm * garch.sigma * 0.2 * (i + 1);
    trend *= trustTrend;
    let price = last + trend + wiggle; // wiggle preserved at full amplitude
    // QSL hard clip
    const qslU = last + 2.4 * garch.sigma * Math.sqrt(i + 1);
    const qslL = last - 2.4 * garch.sigma * Math.sqrt(i + 1);
    price = Math.min(qslU, Math.max(qslL, price));
    raw.push(price);
  }

  const forecast: ForecastPoint[] = raw.map((price, i) => {
    const sigma = sigmas[i] || garch.sigma;
    const drift = arima.driftPerStep + regimeBias * garch.sigma * 0.1 + hamPush * 0.5;
    return {
      step: i + 1,
      price,
      upper: price + sigma,
      lower: price - sigma,
      qslUpper: last + 2.4 * garch.sigma * Math.sqrt(i + 1),
      qslLower: last - 2.4 * garch.sigma * Math.sqrt(i + 1),
      sslUpper: last + drift * (i + 1) + 1.96 * sigma * Math.sqrt(i + 1),
      sslLower: last + drift * (i + 1) - 1.96 * sigma * Math.sqrt(i + 1),
    };
  });

  const finalPrice = forecast[forecast.length - 1].price;
  const delta = finalPrice - last;
  const direction: "up" | "down" | "flat" =
    Math.abs(delta) < garch.sigma * 0.3 ? "flat" : delta > 0 ? "up" : "down";

  const regimeAgrees =
    direction === "up" ? hmm.stateProbs[2] :
    direction === "down" ? hmm.stateProbs[0] :
    hmm.stateProbs[1];
  const hurstAgrees = hurst.regime === "trending" ? 1 : hurst.regime === "random" ? 0.5 : 0.3;
  const baseConfidence =
    0.34 * edge +
    0.30 * hmm.confidence +
    0.22 * regimeAgrees +
    0.14 * hurstAgrees;
  const consensus =
    (edge > 0.55 ? 1 : 0) +
    (hmm.confidence > 0.55 ? 1 : 0) +
    (regimeAgrees > 0.5 ? 1 : 0) +
    (hurstAgrees > 0.5 ? 1 : 0);
  const consensusBonus = consensus >= 3 ? 0.08 : consensus === 2 ? 0.03 : 0;
  // Apply data quality penalty: poor data reduces confidence
  const confidenceBeforeCap = (baseConfidence + consensusBonus) * qualityPenalty;
  const hybridConfidence = Math.max(0.35, Math.min(0.8, confidenceBeforeCap));

  return {
    arima, garch, hmm, entropy, hurst, hamiltonian, qsl, ssl,
    forecast, finalPrice, direction, hybridConfidence, weights,
  };
}
