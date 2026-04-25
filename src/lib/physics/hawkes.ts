// Hawkes self-exciting point process for jump CLUSTERING.
//   λ(t) = μ + Σ_{t_i < t} α · exp(-β (t - t_i))
//
// One jump increases the probability of more jumps in the near future
// (decays exponentially). This captures liquidation cascades in crypto,
// circuit-breaker chains in equities, and central-bank surprise clusters
// in forex. Without it, the model treats each shock as independent — which
// is empirically false.
//
// Branching ratio n = α/β  ∈ [0,1).
//   n > 0.5 ⇒ heavily clustered, expect cascade to continue.
//   n < 0.2 ⇒ jumps are isolated, regime is calm.

export interface HawkesResult {
  mu: number;            // baseline intensity (jumps/step)
  alpha: number;         // self-excitation strength
  beta: number;          // decay rate
  branching: number;     // n = α/β
  currentIntensity: number; // λ at the most recent step
  cascadeProbability: number; // P(another jump in next ~10 steps | current λ)
  isClusterRegime: boolean;
}

const JUMP_K = 3; // same threshold as jumpDiffusion.ts

export function fitHawkes(prices: number[]): HawkesResult {
  const n = prices.length;
  if (n < 40) {
    return {
      mu: 0.01, alpha: 0, beta: 1, branching: 0,
      currentIntensity: 0.01, cascadeProbability: 0, isClusterRegime: false,
    };
  }
  const r: number[] = [];
  for (let i = 1; i < n; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const std = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) || 1e-9;

  // Extract jump times (indices where |z| > threshold)
  const jumpTimes: number[] = [];
  for (let i = 0; i < r.length; i++) {
    if (Math.abs((r[i] - mean) / std) > JUMP_K) jumpTimes.push(i);
  }
  const T = r.length;
  const muHat = Math.max(1e-4, jumpTimes.length / T);

  if (jumpTimes.length < 3) {
    return {
      mu: muHat, alpha: 0, beta: 1, branching: 0,
      currentIntensity: muHat, cascadeProbability: 0, isClusterRegime: false,
    };
  }

  // Coarse grid search for α, β maximizing log-likelihood:
  //   ℓ = Σ_i log λ(t_i) − ∫₀ᵀ λ(s) ds
  let best = { ll: -Infinity, alpha: 0.05, beta: 0.5 };
  for (let beta = 0.1; beta <= 2.0; beta += 0.1) {
    for (let alpha = 0.0; alpha < beta * 0.95; alpha += beta * 0.1) {
      // Compute λ at each jump time (exponential kernel, recursive)
      let ll = 0;
      let R_i = 0; // recursive sum of decayed past excitations at jump i
      let valid = true;
      for (let i = 0; i < jumpTimes.length; i++) {
        if (i > 0) {
          const dt = jumpTimes[i] - jumpTimes[i - 1];
          R_i = (R_i + 1) * Math.exp(-beta * dt);
        }
        const lam = muHat + alpha * R_i;
        if (lam <= 0) { valid = false; break; }
        ll += Math.log(lam);
      }
      if (!valid) continue;
      // Compensator term: μT + (α/β) Σ (1 − exp(-β(T - t_i)))
      let comp = muHat * T;
      for (const t of jumpTimes) comp += (alpha / beta) * (1 - Math.exp(-beta * (T - t)));
      ll -= comp;
      if (ll > best.ll) best = { ll, alpha, beta };
    }
  }

  // Current intensity: λ at t = T using recursive sum
  let R = 0;
  for (let i = 0; i < jumpTimes.length; i++) {
    if (i > 0) {
      const dt = jumpTimes[i] - jumpTimes[i - 1];
      R = (R + 1) * Math.exp(-best.beta * dt);
    } else {
      R = 0;
    }
  }
  const dtLast = T - jumpTimes[jumpTimes.length - 1];
  const decayFromLast = (R + 1) * Math.exp(-best.beta * dtLast);
  const currentIntensity = muHat + best.alpha * decayFromLast;

  const branching = best.alpha / Math.max(1e-9, best.beta);
  // Probability of ≥1 jump in next 10 steps given current λ (Poisson approx)
  const cascadeProbability = 1 - Math.exp(-currentIntensity * 10);
  const isClusterRegime = branching > 0.4 && currentIntensity > muHat * 1.5;

  return {
    mu: muHat, alpha: best.alpha, beta: best.beta, branching,
    currentIntensity, cascadeProbability, isClusterRegime,
  };
}
