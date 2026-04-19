// 3-state Hidden Markov Model on log-returns.
// States: 0 = bearish, 1 = neutral/high-vol, 2 = bullish
// Emissions: Gaussian with means/sigmas from data quantiles.
//
// We compute:
//   - Forward probabilities (current state distribution)
//   - Viterbi most-likely state path
//   - Empirical transition matrix  P(s_t = j | s_{t-1} = i)
//     estimated by counting transitions in the Viterbi path (with Laplace
//     smoothing). This gives a *data-driven* matrix shown in the UI rather
//     than a hardcoded one.

export interface HmmResult {
  stateProbs: [number, number, number];
  dominantState: 0 | 1 | 2;
  confidence: number;
  expectedReturn: number;
  transitionMatrix: number[][]; // 3x3, rows sum to 1
  stateMeans: [number, number, number];
  stateSigmas: [number, number, number];
}

export const HMM_STATE_LABELS = ["Bearish trend", "High-vol reversal", "Bullish recovery"] as const;

function gauss(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 1e-12;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

export function fitHmm3(prices: number[]): HmmResult {
  if (prices.length < 12) {
    const eye = [
      [0.34, 0.33, 0.33],
      [0.33, 0.34, 0.33],
      [0.33, 0.33, 0.34],
    ];
    return {
      stateProbs: [0.33, 0.34, 0.33],
      dominantState: 1,
      confidence: 0.34,
      expectedReturn: 0,
      transitionMatrix: eye,
      stateMeans: [0, 0, 0],
      stateSigmas: [1e-6, 1e-6, 1e-6],
    };
  }
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));

  const sorted = [...returns].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) || 1e-6;

  const mus: [number, number, number] = [q1, mean, q3];
  const sigmas: [number, number, number] = [std * 0.8, std * 1.5, std * 0.8];

  // Sticky prior transition matrix used during Viterbi/forward pass
  const A = [
    [0.85, 0.10, 0.05],
    [0.15, 0.70, 0.15],
    [0.05, 0.10, 0.85],
  ];
  const pi = [1 / 3, 1 / 3, 1 / 3];
  const T = returns.length;

  // ---- Forward (with normalisation) ----
  let alpha = pi.map((p, s) => p * gauss(returns[0], mus[s], sigmas[s]));
  let sum = alpha.reduce((a, b) => a + b, 0) || 1e-12;
  alpha = alpha.map((a) => a / sum);
  for (let t = 1; t < T; t++) {
    const next = [0, 0, 0];
    for (let s = 0; s < 3; s++) {
      let acc = 0;
      for (let sp = 0; sp < 3; sp++) acc += alpha[sp] * A[sp][s];
      next[s] = acc * gauss(returns[t], mus[s], sigmas[s]);
    }
    sum = next.reduce((a, b) => a + b, 0) || 1e-12;
    alpha = next.map((a) => a / sum);
  }
  const stateProbs: [number, number, number] = [alpha[0], alpha[1], alpha[2]];
  const dominantState = stateProbs.indexOf(Math.max(...stateProbs)) as 0 | 1 | 2;
  const confidence = stateProbs[dominantState];
  const expectedReturn = stateProbs.reduce((acc, p, i) => acc + p * mus[i], 0);

  // ---- Viterbi for most-likely state sequence ----
  const logA = A.map((row) => row.map((v) => Math.log(v)));
  const logPi = pi.map((v) => Math.log(v));
  const delta: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
  const psi: number[][] = Array.from({ length: T }, () => [0, 0, 0]);
  for (let s = 0; s < 3; s++) {
    delta[0][s] = logPi[s] + Math.log(gauss(returns[0], mus[s], sigmas[s]) + 1e-300);
  }
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < 3; s++) {
      let bestVal = -Infinity;
      let bestPrev = 0;
      for (let sp = 0; sp < 3; sp++) {
        const v = delta[t - 1][sp] + logA[sp][s];
        if (v > bestVal) { bestVal = v; bestPrev = sp; }
      }
      delta[t][s] = bestVal + Math.log(gauss(returns[t], mus[s], sigmas[s]) + 1e-300);
      psi[t][s] = bestPrev;
    }
  }
  const path = new Array<number>(T);
  path[T - 1] = delta[T - 1].indexOf(Math.max(...delta[T - 1]));
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];

  // ---- Empirical transition matrix from Viterbi path (Laplace smoothing) ----
  const counts = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ];
  for (let t = 1; t < path.length; t++) counts[path[t - 1]][path[t]]++;
  const transitionMatrix = counts.map((row) => {
    const total = row.reduce((a, b) => a + b, 0);
    return row.map((c) => c / total);
  });

  return {
    stateProbs,
    dominantState,
    confidence,
    expectedReturn,
    transitionMatrix,
    stateMeans: mus,
    stateSigmas: sigmas,
  };
}
