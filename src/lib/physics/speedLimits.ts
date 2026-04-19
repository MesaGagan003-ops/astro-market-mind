// Two physical bounds on how far price can travel in a given window.
//
// 1) Quantum Speed Limit (Mandelstam–Tamm, finance-adapted):
//    The minimum time for a state to evolve to an orthogonal state is
//    tau_QSL = pi*hbar / (2*DeltaE).  Reframing energy as volatility energy
//    (DeltaE ~ sigma * sqrt(N)), the maximum reachable displacement in N
//    steps becomes ~ k * sigma * sqrt(N) with k ≈ 2.4 (95% bound).
//
// 2) Stochastic Speed Limit (Ito-process based):
//    For a diffusion dX = mu*dt + sigma*dW, the variance grows linearly with
//    time, and Chebyshev-style bounds give a probabilistic max excursion of
//    |X_T - X_0| <= mu*T + z * sigma * sqrt(T).  This bound widens with mean
//    drift and is generally tighter than QSL when |mu| is large.

export interface SpeedLimit {
  upper: number;
  lower: number;
  reachableRange: number;
  label: string;
  description: string;
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

export function stochasticSpeedLimit(
  currentPrice: number,
  drift: number,
  sigma: number,
  steps: number,
  z = 1.96, // 95% confidence
): SpeedLimit {
  const dt = steps;
  const driftTotal = drift * dt;
  const stoch = z * sigma * Math.sqrt(dt);
  return {
    upper: currentPrice + driftTotal + stoch,
    lower: currentPrice + driftTotal - stoch,
    reachableRange: 2 * stoch,
    label: "Stochastic Speed Limit",
    description: `Itô diffusion bound: μT ± ${z}σ√T (95% CI).`,
  };
}
