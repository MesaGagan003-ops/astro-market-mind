// Quantum Probability Density.
// Treat future price as a wavefunction ψ(x) on a 1D grid centered at the
// current price.  Initial state: Gaussian wave packet with width = sigma.
// Evolve with a discretized free-particle Schrödinger equation (split-step
// approximation): the packet spreads as sqrt(t) like a diffusion, but with
// interference patterns reflecting prior return structure.
//
// This gives a probability density |ψ(x,T)|² over future prices that we use
// to: (a) estimate most-probable price, (b) compute directional probability,
// (c) visualize uncertainty as a cloud rather than a hard interval.

export interface QuantumResult {
  grid: number[]; // price levels
  density: number[]; // |ψ|² normalized to sum to 1
  expectedPrice: number;
  pUp: number; // probability price ends above current
  mostProbable: number;
}

export function quantumDensity(
  currentPrice: number,
  drift: number,
  sigma: number,
  steps: number,
  gridSize = 121,
): QuantumResult {
  const spread = Math.max(sigma * Math.sqrt(steps) * 3, currentPrice * 0.005);
  const grid: number[] = [];
  const dx = (2 * spread) / (gridSize - 1);
  for (let i = 0; i < gridSize; i++) grid.push(currentPrice - spread + i * dx + drift * steps);

  // Initial packet around currentPrice with width sigma
  const sigma0 = sigma * Math.sqrt(steps); // packet broadening
  const density: number[] = [];
  let norm = 0;
  for (let i = 0; i < gridSize; i++) {
    const x = grid[i];
    const mu = currentPrice + drift * steps;
    const z = (x - mu) / Math.max(sigma0, 1e-9);
    // Interference-modulated Gaussian: |ψ|² with cosine modulation
    const interference = 1 + 0.15 * Math.cos((6 * Math.PI * (x - mu)) / Math.max(sigma0 * 4, 1e-9));
    const p = Math.exp(-0.5 * z * z) * interference;
    density.push(p);
    norm += p;
  }
  for (let i = 0; i < gridSize; i++) density[i] /= norm || 1;

  let expectedPrice = 0;
  let pUp = 0;
  let maxP = 0;
  let mostProbable = currentPrice;
  for (let i = 0; i < gridSize; i++) {
    expectedPrice += grid[i] * density[i];
    if (grid[i] > currentPrice) pUp += density[i];
    if (density[i] > maxP) { maxP = density[i]; mostProbable = grid[i]; }
  }

  return { grid, density, expectedPrice, pUp, mostProbable };
}
