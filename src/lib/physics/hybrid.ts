// Hybrid prediction engine combining ARIMA, GARCH, HMM, Entropy, QSL, SSL,
// and Quantum probability into a single forecast path with confidence bands.

import { fitArima212 } from "./arima";
import { fitGarch11 } from "./garch";
import { fitHmm3 } from "./hmm";
import { shannonEntropy } from "./entropy";
import { quantumSpeedLimit, stochasticSpeedLimit, type SpeedLimit } from "./speedLimits";
import { quantumDensity, type QuantumResult } from "./quantum";

export interface ForecastPoint {
  step: number;
  price: number;
  upper: number; // GARCH 1σ upper
  lower: number;
  qslUpper: number;
  qslLower: number;
  sslUpper: number;
  sslLower: number;
}

export interface HybridResult {
  arima: ReturnType<typeof fitArima212>;
  garch: ReturnType<typeof fitGarch11>;
  hmm: ReturnType<typeof fitHmm3>;
  entropy: ReturnType<typeof shannonEntropy>;
  qsl: SpeedLimit;
  ssl: SpeedLimit;
  quantum: QuantumResult;
  forecast: ForecastPoint[];
  finalPrice: number;
  direction: "up" | "down" | "flat";
  hybridConfidence: number; // 0..1
  weights: { arima: number; hmm: number; quantum: number; entropy: number };
}

export function hybridPredict(prices: number[], steps: number): HybridResult {
  const arima = fitArima212(prices);
  const garch = fitGarch11(prices);
  const hmm = fitHmm3(prices);
  const entropy = shannonEntropy(prices);
  const last = prices[prices.length - 1];

  // Regime gating: scale ARIMA drift by HMM regime confidence,
  // and dampen by entropy edge.
  const regimeBias = hmm.stateProbs[2] - hmm.stateProbs[0]; // bull - bear, [-1, 1]
  const arimaDrift = arima.drift;
  const hmmDrift = (hmm.expectedReturn) * last; // log-return -> price-ish
  const edge = entropy.edge; // (1 - H) in [0,1]

  // Weights — entropy dampens overall signal magnitude
  const wArima = 0.35;
  const wHmm = 0.25;
  const wQuantum = 0.20;
  const wRegime = 0.20;

  const baseDrift = (wArima * arimaDrift + wHmm * hmmDrift + wRegime * regimeBias * arima.residualStd) * (0.2 + 0.8 * edge);

  const sigmas = garch.forecastSigma(steps);
  const arimaPath = arima.forecast(steps, last);

  // Quantum density computed at horizon
  const quantum = quantumDensity(last, baseDrift, garch.sigma, steps);

  // Blend ARIMA path toward quantum expected price using wQuantum
  const finalArima = arimaPath[arimaPath.length - 1];
  const finalBlended = finalArima * (1 - wQuantum) + quantum.expectedPrice * wQuantum;
  const totalShift = finalBlended - last;

  const qsl = quantumSpeedLimit(last, garch.sigma, steps);
  const ssl = stochasticSpeedLimit(last, baseDrift, garch.sigma, steps);

  const forecast: ForecastPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i + 1) / steps;
    let price = last + totalShift * t;
    // QSL hard clip
    const qslU = last + (qsl.upper - last) * Math.sqrt(t);
    const qslL = last - (last - qsl.lower) * Math.sqrt(t);
    price = Math.min(qslU, Math.max(qslL, price));
    const sigma = sigmas[i] || garch.sigma;
    const sslU = last + baseDrift * (i + 1) + 1.96 * sigma * Math.sqrt(i + 1);
    const sslL = last + baseDrift * (i + 1) - 1.96 * sigma * Math.sqrt(i + 1);
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

  // Confidence: combines entropy edge, HMM confidence, and quantum directional prob agreement
  const quantumAgrees = direction === "up" ? quantum.pUp : direction === "down" ? 1 - quantum.pUp : 0.5;
  const hybridConfidence = Math.max(0, Math.min(1,
    0.4 * edge + 0.3 * hmm.confidence + 0.3 * quantumAgrees,
  ));

  return {
    arima, garch, hmm, entropy, qsl, ssl, quantum,
    forecast, finalPrice, direction, hybridConfidence,
    weights: { arima: wArima, hmm: wHmm, quantum: wQuantum, entropy: edge },
  };
}
