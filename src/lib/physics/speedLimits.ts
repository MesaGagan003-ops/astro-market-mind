// Two physical bounds on how far price can travel in a given window.
//
// 1) Quantum Speed Limit (Mandelstam–Tamm, finance-adapted):
//    The minimum time for a state to evolve to an orthogonal state is
//    tau_QSL = pi*hbar / (2*DeltaE).  Reframing energy as volatility energy
//    (DeltaE ~ sigma * sqrt(N)), the maximum reachable displacement in N
//    steps becomes ~ k * sigma * sqrt(N) with k ≈ 2.4 (95% bound).
//
// 2) Stochastic Speed Limit (Master-Equation form, per handout):
//      Step 1: choose initial p_i(0) and final p_i(τ) distributions over
//              regimes (here: HMM states {bear, neutral, bull}).
//      Step 2: D_TV = ½ Σ |p_i(τ) − p_i(0)|             (Total Variation)
//      Step 3: ṗ_i = Σ_j (W_ij p_j − W_ji p_i)          (Master Equation)
//      Step 4: v(t) = ½ Σ |ṗ_i(t)|                      (instant. speed)
//      Step 5: ⟨v⟩ = (1/τ) ∫ v(t) dt                    (mean speed)
//      Step 6: τ ≥ D_TV / ⟨v⟩                           (the bound)
//      Tightness Q = D_TV / (τ ⟨v⟩) ∈ (0, 1]; Q→1 means optimal/geodesic.
//
//    The maximum reachable price displacement consistent with this bound is
//    derived by mapping each regime to its expected log-return μ_i and
//    computing the maximum |Δlog P| reachable when probability mass moves
//    optimally between regimes:  Δlog P_max = (μ_max − μ_min) · D_TV · τ.
//    We then exponentiate to a price band around the spot.
//
// QSL is universal (volatility budget). SSL is regime-aware (probability flow
// budget). The forecast envelope must respect BOTH simultaneously.

export interface SpeedLimit {
  upper: number;
  lower: number;
  reachableRange: number;
  label: string;
  description: string;
}

export interface StochasticSpeedLimitDetail extends SpeedLimit {
  dTV: number;        // total-variation distance between p(0) and p(τ)
  meanSpeed: number;  // ⟨v⟩
  tau: number;        // chosen integration window (steps)
  tightness: number;  // Q = D_TV / (τ ⟨v⟩)
  pInitial: number[]; // p_i(0)
  pFinal: number[];   // p_i(τ)
}

export function quantumSpeedLimit(
  currentPrice: number,
  sigma: number,
  steps: number,
  k = 2.4,
): SpeedLimit {
  const range = k * sigma * Math.sqrt(steps);
  return {
    upper: currentPrice + range,
    lower: currentPrice - range,
    reachableRange: 2 * range,
    label: "Quantum Speed Limit",
    description: `Mandelstam–Tamm bound. Max ${k.toFixed(1)}σ·√N excursion.`,
  };
}

// ---- helpers for the master-equation SSL ----

function totalVariation(p: number[], q: number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.abs(p[i] - q[i]);
  return 0.5 * s;
}

// Build rate matrix W from a discrete-time transition matrix A.
// For small dt = 1 step, W_ij ≈ A_ij (i ≠ j); diagonals enforce row sums = 0.
function rateMatrix(A: number[][]): number[][] {
  const n = A.length;
  const W: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    let off = 0;
    for (let j = 0; j < n; j++) {
      if (j !== i) {
        // W[j][i] is the rate i → j (column-stochastic generator convention)
        W[j][i] = A[i][j];
        off += A[i][j];
      }
    }
    W[i][i] = -off;
  }
  return W;
}

// dp/dt = W p
function derivative(W: number[][], p: number[]): number[] {
  const n = p.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += W[i][j] * p[j];
    out[i] = s;
  }
  return out;
}

// 4th-order Runge-Kutta integration of dp/dt = W p over [0, tau], dt = 1.
// Returns trajectory p(0..tau) with tau+1 sample points.
function integrate(W: number[][], p0: number[], tau: number): number[][] {
  const traj: number[][] = [p0.slice()];
  let p = p0.slice();
  const dt = 1;
  for (let step = 0; step < tau; step++) {
    const k1 = derivative(W, p);
    const p2 = p.map((v, i) => v + 0.5 * dt * k1[i]);
    const k2 = derivative(W, p2);
    const p3 = p.map((v, i) => v + 0.5 * dt * k2[i]);
    const k3 = derivative(W, p3);
    const p4 = p.map((v, i) => v + dt * k3[i]);
    const k4 = derivative(W, p4);
    p = p.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    // re-normalize against tiny numerical drift
    const s = p.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    p = p.map((v) => Math.max(0, v) / s);
    traj.push(p);
  }
  return traj;
}

/**
 * Stochastic Speed Limit per the master-equation handout.
 *
 * @param currentPrice  spot price
 * @param transition    HMM 3x3 transition matrix (rows sum to 1)
 * @param pInitial      current state probabilities p_i(0)
 * @param stateMeans    expected log-return per state μ_i (e.g. HMM means)
 * @param tau           horizon in steps
 * @param sigma         per-step σ (price units) — used as a fallback floor
 */
export function stochasticSpeedLimit(
  currentPrice: number,
  transition: number[][],
  pInitial: number[],
  stateMeans: number[],
  tau: number,
  sigma: number,
): StochasticSpeedLimitDetail {
  const W = rateMatrix(transition);
  const traj = integrate(W, pInitial, tau);
  const pFinal = traj[traj.length - 1];

  const dTV = totalVariation(pInitial, pFinal);

  // mean instantaneous speed ⟨v⟩ = (1/τ) ∫ ½ Σ |ṗ_i| dt   (trapezoidal)
  let speedSum = 0;
  for (let t = 0; t < traj.length; t++) {
    const dot = derivative(W, traj[t]);
    let s = 0;
    for (const v of dot) s += Math.abs(v);
    const inst = 0.5 * s;
    const w = t === 0 || t === traj.length - 1 ? 0.5 : 1; // trapezoidal
    speedSum += inst * w;
  }
  const meanSpeed = speedSum / Math.max(1, tau);
  const tightness = dTV / Math.max(1e-12, tau * meanSpeed);

  // Map probability flow → price displacement.
  // The maximum cumulative log-return achievable is bounded by the
  // probability mass that can flow from the lowest-mean to the highest-mean
  // regime times the spread of state means, integrated over τ.
  const muMax = Math.max(...stateMeans);
  const muMin = Math.min(...stateMeans);
  const muSpread = Math.max(0, muMax - muMin);
  // Expected log-return at τ given trajectory:
  //   E[log P_τ / P_0] = Σ_t Σ_i p_i(t) μ_i  (sum across the path)
  let expLog = 0;
  for (let t = 1; t < traj.length; t++) {
    let mu = 0;
    for (let i = 0; i < pInitial.length; i++) mu += traj[t][i] * stateMeans[i];
    expLog += mu;
  }
  // Maximum admissible deviation from that mean (per bound):
  const maxDevLog = muSpread * dTV * tau;
  // Floor by Gaussian σ-bound so we never under-bound when D_TV ≈ 0.
  const gaussianFloor = 1.96 * (sigma / Math.max(currentPrice, 1e-12)) * Math.sqrt(tau);
  const halfWidthLog = Math.max(maxDevLog, gaussianFloor);

  const upper = currentPrice * Math.exp(expLog + halfWidthLog);
  const lower = currentPrice * Math.exp(expLog - halfWidthLog);

  return {
    upper,
    lower,
    reachableRange: upper - lower,
    label: "Stochastic Speed Limit",
    description: `Master-equation bound: τ ≥ D_TV/⟨v⟩. Q=${tightness.toFixed(2)} (→1 = optimal).`,
    dTV,
    meanSpeed,
    tau,
    tightness: Math.min(1, tightness),
    pInitial: pInitial.slice(),
    pFinal,
  };
}
