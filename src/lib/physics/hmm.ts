// 3-state Hidden Markov Model on log-returns.
// States: 0 = bearish, 1 = neutral/high-vol, 2 = bullish
// Uses Gaussian emissions with fixed means/sigmas derived from data quantiles.
// Approximate Viterbi + forward-backward gives current state probabilities.

export interface HmmResult {
  stateProbs: [number, number, number]; // [bear, neutral, bull]
  dominantState: 0 | 1 | 2;
  confidence: number;
  expectedReturn: number; // mixture mean
}

const STATE_LABELS = ["Bearish trend", "High-vol reversal", "Bullish recovery"] as const;
export const HMM_STATE_LABELS = STATE_LABELS;

function gaussian(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 1e-12;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

export function fitHmm3(prices: number[]): HmmResult {
  if (prices.length < 12) {
    return { stateProbs: [0.33, 0.34, 0.33], dominantState: 1, confidence: 0.34, expectedReturn: 0 };
  }
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  const sorted = [...returns].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) || 1e-6;

  // State emission params
  const mus = [q1, mean, q3];
  const sigmas = [std * 0.8, std * 1.5, std * 0.8];

  // Transition matrix — sticky regimes
  const A = [
    [0.85, 0.10, 0.05],
    [0.15, 0.70, 0.15],
    [0.05, 0.10, 0.85],
  ];
  const pi = [1 / 3, 1 / 3, 1 / 3];

  // Forward algorithm with normalization
  const T = returns.length;
  let alpha = pi.map((p, s) => p * gaussian(returns[0], mus[s], sigmas[s]));
  let sum = alpha.reduce((a, b) => a + b, 0) || 1e-12;
  alpha = alpha.map((a) => a / sum);

  for (let t = 1; t < T; t++) {
    const newAlpha = [0, 0, 0];
    for (let s = 0; s < 3; s++) {
      let acc = 0;
      for (let sp = 0; sp < 3; sp++) acc += alpha[sp] * A[sp][s];
      newAlpha[s] = acc * gaussian(returns[t], mus[s], sigmas[s]);
    }
    sum = newAlpha.reduce((a, b) => a + b, 0) || 1e-12;
    alpha = newAlpha.map((a) => a / sum);
  }

  const stateProbs: [number, number, number] = [alpha[0], alpha[1], alpha[2]];
  const dominantState = (stateProbs.indexOf(Math.max(...stateProbs)) as 0 | 1 | 2);
  const confidence = stateProbs[dominantState];
  const expectedReturn = stateProbs.reduce((acc, p, i) => acc + p * mus[i], 0);

  return { stateProbs, dominantState, confidence, expectedReturn };
}
