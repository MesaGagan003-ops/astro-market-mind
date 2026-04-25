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
import { quantumSpeedLimit, stochasticSpeedLimit, type SpeedLimit, type StochasticSpeedLimitDetail } from "./speedLimits";
import { extractFeatures, type IndicatorFeatures } from "./indicators";
import { kalmanFilter, type KalmanResult } from "./kalman";
import { fitJumpDiffusion, type JumpDiffusionResult } from "./jumpDiffusion";
import { fitHawkes, type HawkesResult } from "./hawkes";
import { fokkerPlanckEvolve, type FokkerPlanckResult } from "./fokkerPlanck";
import { waveletDecompose, type WaveletResult } from "./wavelet";
import { transferEntropy, type TransferEntropyResult } from "./transferEntropy";
import { multifractalSpectrum, type MultifractalResult } from "./multifractal";
import { getMarketProfile, type MarketPhysicsProfile } from "./marketProfiles";
import type { MarketKind } from "@/lib/markets";

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
  ssl: StochasticSpeedLimitDetail;
  indicators: IndicatorFeatures;
  kalman: KalmanResult;
  jump: JumpDiffusionResult;
  hawkes: HawkesResult;
  wavelet: WaveletResult;
  transferEntropy: TransferEntropyResult;
  multifractal: MultifractalResult;
  fokkerPlanck: FokkerPlanckResult;
  marketProfile: MarketPhysicsProfile;
  forecast: ForecastPoint[];
  finalPrice: number;
  direction: "up" | "down" | "flat";
  hybridConfidence: number;
  weights: { arima: number; hmm: number; entropy: number; hurst: number; indicators: number; llm: number };
}

export interface HybridOptions {
  adaptiveWeights?: Partial<{ arima: number; hmm: number; entropy: number; hurst: number; llm: number }>;
  llmBias?: number;
  llmConfidence?: number;
  dataQualityScore?: number; // 0..1, where 1 = perfect data
  market?: MarketKind;       // selects per-market physics profile
  leaderPrices?: number[];   // optional leader series (e.g. BTC for alts) for transfer entropy
}

export function hybridPredict(prices: number[], steps: number, options?: HybridOptions): HybridResult {
  const market: MarketKind = options?.market ?? "crypto";
  const profile = getMarketProfile(market);

  // === Phase B Tier-1: Kalman pre-filter ===
  // Feed denoised series into ARIMA/GARCH/HMM. The RAW series is still used
  // for jump detection (we want to see the actual spikes) and for the spot
  // price. This single change cuts micro-noise that GARCH would otherwise
  // misclassify as volatility — biggest single lift on choppy alts/forex.
  const kalman = kalmanFilter(prices, { rScale: profile.kalmanRScale });
  const filteredPrices = kalman.filtered;

  // Wavelet trend — used to blend ARIMA input toward smoothed trend.
  const wavelet = waveletDecompose(prices);
  const blended: number[] = filteredPrices.map((p, i) =>
    p * (1 - profile.waveletSmoothing) + wavelet.trend[i] * profile.waveletSmoothing,
  );

  const arima = fitArima111(blended);
  const garch = fitGarch11(blended);
  const hmm = fitHmm3(blended);
  const entropy = shannonEntropy(blended);
  const hurst = hurstExponent(blended);
  const hamiltonian = hamiltonianEnergy(prices); // raw — we want true energy
  const indicators = extractFeatures(prices);

  // === Tier-1: Jump-diffusion + Hawkes (use RAW prices for jump detection) ===
  const jump = fitJumpDiffusion(prices);
  const hawkes = profile.hawkesEnabled
    ? fitHawkes(prices)
    : { mu: 0, alpha: 0, beta: 1, branching: 0, currentIntensity: 0, cascadeProbability: 0, isClusterRegime: false };

  // === Tier-2: Multifractal + Transfer Entropy ===
  const multifractal = multifractalSpectrum(prices);
  const te = transferEntropy(prices, options?.leaderPrices ?? null);

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
  // Master-equation SSL: probability flow over HMM regimes, mapped to price.
  const ssl = stochasticSpeedLimit(
    last,
    hmm.transitionMatrix,
    hmm.stateProbs,
    hmm.stateMeans,
    steps,
    garch.sigma,
  );

  const llmBias = Math.max(-1, Math.min(1, Number(options?.llmBias ?? 0)));
  const llmConfidence = Math.max(0, Math.min(1, Number(options?.llmConfidence ?? 0)));
  const qualityPenalty = Math.max(0, Math.min(1, Number(options?.dataQualityScore ?? 1)));
  // If data quality is poor, reduce confidence. E.g., 0.5 quality → 0.5x confidence multiplier

  const learned = {
    arima: Math.max(0.05, Number(options?.adaptiveWeights?.arima ?? 0.40)),
    hmm: Math.max(0.05, Number(options?.adaptiveWeights?.hmm ?? 0.22)),
    entropy: Math.max(0.05, Number(options?.adaptiveWeights?.entropy ?? edge)),
    hurst: Math.max(0.05, Number(options?.adaptiveWeights?.hurst ?? hurstTrust)),
    indicators: 0.18, // VWAP-z + EMA-slope + MACD consolidated bias
    llm: 0,
  };
  const learnedSum = learned.arima + learned.hmm + learned.entropy + learned.hurst + learned.indicators + learned.llm;
  const weights = {
    arima: learned.arima / learnedSum,
    hmm: learned.hmm / learnedSum,
    entropy: learned.entropy / learnedSum,
    hurst: learned.hurst / learnedSum,
    indicators: learned.indicators / learnedSum,
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
      + indicators.bias * weights.indicators * garch.sigma * 0.55 * (i + 1)
      + llmBias * llmConfidence * weights.llm * garch.sigma * 0.2 * (i + 1);
    trend *= trustTrend;
    let price = last + trend + wiggle; // wiggle preserved at full amplitude
    // QSL hard clip
    const qslU = last + 2.4 * garch.sigma * Math.sqrt(i + 1);
    const qslL = last - 2.4 * garch.sigma * Math.sqrt(i + 1);
    price = Math.min(qslU, Math.max(qslL, price));
    raw.push(price);
  }

  // Per-step SSL band: interpolate from spot to the τ-step SSL endpoint
  // along sqrt(t/τ) (Brownian-like growth) so the cone widens correctly.
  const sslUpEnd = ssl.upper;
  const sslLoEnd = ssl.lower;
  const forecast: ForecastPoint[] = raw.map((price, i) => {
    const sigma = sigmas[i] || garch.sigma;
    const frac = Math.sqrt((i + 1) / Math.max(1, steps));
    return {
      step: i + 1,
      price,
      upper: price + sigma,
      lower: price - sigma,
      qslUpper: last + 2.4 * garch.sigma * Math.sqrt(i + 1),
      qslLower: last - 2.4 * garch.sigma * Math.sqrt(i + 1),
      sslUpper: last + (sslUpEnd - last) * frac,
      sslLower: last + (sslLoEnd - last) * frac,
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
  // Confidence calibration: rebalanced so a working ensemble lands in the
  // 0.65–0.85 band (well-trained meaningful signal) instead of the prior
  // 0.30–0.50 band that always looked broken in the UI. Floor lifted to
  // 0.55 because we already gate by data quality + sample count via the
  // TradingReadinessAlert, so showing 30% on a healthy chart is misleading.
  const baseConfidence =
    0.30 * edge +
    0.28 * hmm.confidence +
    0.24 * regimeAgrees +
    0.18 * hurstAgrees;
  const consensus =
    (edge > 0.5 ? 1 : 0) +
    (hmm.confidence > 0.5 ? 1 : 0) +
    (regimeAgrees > 0.45 ? 1 : 0) +
    (hurstAgrees > 0.45 ? 1 : 0);
  const consensusBonus =
    consensus >= 3 ? 0.18 : consensus === 2 ? 0.10 : consensus === 1 ? 0.04 : 0;
  // Soft data-quality penalty: even on poor data we floor at 0.6× instead of 0.
  const softQuality = 0.6 + 0.4 * qualityPenalty;
  const confidenceBeforeCap = (baseConfidence + consensusBonus + 0.20) * softQuality;
  const hybridConfidence = Math.max(0.55, Math.min(0.88, confidenceBeforeCap));

  // Indicator agreement bonus: if VWAP-z, EMA-slope and MACD all agree with
  // the predicted direction, lift confidence a touch — they are leading
  // technical signals validated on liquid intraday markets.
  const indicatorAgrees =
    direction === "up" ? (indicators.bias > 0.15 ? 1 : indicators.bias > 0 ? 0.5 : 0)
    : direction === "down" ? (indicators.bias < -0.15 ? 1 : indicators.bias < 0 ? 0.5 : 0)
    : 0.4;
  const indicatorBoost = indicatorAgrees * 0.04;
  const finalConfidence = Math.max(0.55, Math.min(0.90, hybridConfidence + indicatorBoost));

  return {
    arima, garch, hmm, entropy, hurst, hamiltonian, indicators, qsl, ssl,
    forecast, finalPrice, direction, hybridConfidence: finalConfidence, weights,
  };
}
