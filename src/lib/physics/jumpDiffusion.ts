// Kou double-exponential jump-diffusion model.
//   dS/S = μ dt + σ dW + (J − 1) dN
//   N(t) ~ Poisson(λt), log(J) ~ asymmetric double-exponential
//     P(up jump)   = p,    log(J) ~ Exp(η_up)
//     P(down jump) = 1-p,  log(J) ~ -Exp(η_down)
//
// Why this matters: GARCH assumes continuous Gaussian shocks. Crypto, NSE/BSE
// and forex all have JUMPS (news, halts, liquidations) that GARCH systematically
// underestimates. Adding a jump term gives the hybrid model fat-tail awareness
// and improves catastrophic-move recall.

export interface JumpDiffusionResult {
  lambda: number;        // jumps per step (Poisson rate)
  pUp: number;           // P(jump is upward)
  etaUp: number;         // up-jump tail decay (1/mean up jump magnitude)
  etaDown: number;       // down-jump tail decay
  jumpVar: number;       // variance contribution from jumps (log-return units)
  diffusionVar: number;  // variance contribution from diffusion
  jumpFraction: number;  // jumpVar / (jumpVar + diffusionVar)
  recentJump: { t: number; size: number; direction: "up" | "down" } | null;
  expectedJumpDrift: number; // E[J-1] · λ — adds to drift
}

const JUMP_THRESHOLD_K = 3;   // |return| > k·σ ⇒ flagged as a jump

export function fitJumpDiffusion(prices: number[]): JumpDiffusionResult {
  const n = prices.length;
  if (n < 30) {
    return {
      lambda: 0, pUp: 0.5, etaUp: 50, etaDown: 50,
      jumpVar: 0, diffusionVar: 1e-8, jumpFraction: 0,
      recentJump: null, expectedJumpDrift: 0,
    };
  }
  const r: number[] = [];
  for (let i = 1; i < n; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const std = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length) || 1e-9;

  // Identify jumps: returns whose |z-score| exceeds threshold.
  const jumps: number[] = [];
  const ups: number[] = [];
  const downs: number[] = [];
  let recentJump: JumpDiffusionResult["recentJump"] = null;
  for (let i = 0; i < r.length; i++) {
    const z = (r[i] - mean) / std;
    if (Math.abs(z) > JUMP_THRESHOLD_K) {
      jumps.push(r[i]);
      if (r[i] > 0) ups.push(r[i]); else downs.push(-r[i]);
      // Track the latest jump (idx in the original prices array)
      if (i > r.length - 20) {
        recentJump = { t: i + 1, size: Math.abs(r[i]), direction: r[i] > 0 ? "up" : "down" };
      }
    }
  }

  const lambda = jumps.length / r.length; // jumps per step
  const pUp = ups.length + downs.length === 0 ? 0.5 : ups.length / (ups.length + downs.length);
  const meanUp = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : 1 / 50;
  const meanDown = downs.length ? downs.reduce((a, b) => a + b, 0) / downs.length : 1 / 50;
  const etaUp = 1 / Math.max(1e-6, meanUp);
  const etaDown = 1 / Math.max(1e-6, meanDown);

  // Diffusion variance: from the non-jump returns
  const nonJumps = r.filter((x) => Math.abs((x - mean) / std) <= JUMP_THRESHOLD_K);
  const nonJumpVar = nonJumps.length
    ? nonJumps.reduce((a, b) => a + (b - mean) ** 2, 0) / nonJumps.length
    : std * std;

  // Jump contribution to variance (Merton decomposition)
  // E[(log J)²] = pUp · 2/η_up² + (1-pUp) · 2/η_down²
  const jumpSecondMoment =
    pUp * (2 / (etaUp * etaUp)) + (1 - pUp) * (2 / (etaDown * etaDown));
  const jumpVar = lambda * jumpSecondMoment;
  const diffusionVar = nonJumpVar;
  const jumpFraction = jumpVar / Math.max(1e-18, jumpVar + diffusionVar);

  // Expected jump-driven drift per step: λ · (pUp · 1/η_up − (1-pUp) · 1/η_down)
  const expectedJumpDrift = lambda * (pUp / etaUp - (1 - pUp) / etaDown);

  return {
    lambda, pUp, etaUp, etaDown,
    jumpVar, diffusionVar, jumpFraction,
    recentJump, expectedJumpDrift,
  };
}
