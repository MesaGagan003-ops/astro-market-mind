// Per-market tuning for the new physics modules.
//   - Crypto: aggressive jumps, Hawkes ON (liquidation cascades), wide PDF bands.
//   - NSE/BSE: moderate jumps, Hawkes OFF (no equivalent of liquidations
//     intraday — circuit breakers are rare and discrete), session-aware.
//   - Forex: tight jumps, session-aware (London/NY overlap = high σ),
//     transfer entropy from DXY proxy where available.
//
// These profiles parameterise how aggressively each module's signal is fed
// into the hybrid engine. They DO NOT change the math — only the weights.

import type { MarketKind } from "@/lib/markets";

export interface MarketPhysicsProfile {
  // Kalman pre-filter strength (1.0 = default; higher = more denoising)
  kalmanRScale: number;
  // Jump-diffusion influence on drift (0..1)
  jumpDriftWeight: number;
  // Hawkes self-excitation enabled?
  hawkesEnabled: boolean;
  // How much Hawkes cascade-prob shrinks confidence
  hawkesPenaltyMax: number;
  // Wavelet trend influence on ARIMA input (0 = raw, 1 = full smoothing)
  waveletSmoothing: number;
  // Multifractal regime-shift penalty on confidence
  multifractalPenaltyMax: number;
  // Transfer-entropy weight applied to drift
  transferEntropyWeight: number;
  // Fokker–Planck band overlay enabled in chart?
  fokkerPlanckOverlay: boolean;
}

const CRYPTO: MarketPhysicsProfile = {
  kalmanRScale: 1.4,           // crypto ticks are noisy → stronger denoise
  jumpDriftWeight: 0.55,       // jumps materially shift expected price
  hawkesEnabled: true,         // liquidation cascades are real
  hawkesPenaltyMax: 0.12,
  waveletSmoothing: 0.6,
  multifractalPenaltyMax: 0.10,
  transferEntropyWeight: 0.20,
  fokkerPlanckOverlay: true,
};

const EQUITY: MarketPhysicsProfile = {
  kalmanRScale: 0.8,           // exchange ticks are clean
  jumpDriftWeight: 0.30,
  hawkesEnabled: false,        // no liquidation chains in normal trading
  hawkesPenaltyMax: 0,
  waveletSmoothing: 0.45,
  multifractalPenaltyMax: 0.08,
  transferEntropyWeight: 0.15,
  fokkerPlanckOverlay: true,
};

const FOREX: MarketPhysicsProfile = {
  kalmanRScale: 1.0,
  jumpDriftWeight: 0.25,       // FX jumps are smaller (central-bank events)
  hawkesEnabled: true,         // events DO cluster (rate decisions, NFP)
  hawkesPenaltyMax: 0.08,
  waveletSmoothing: 0.55,
  multifractalPenaltyMax: 0.06,
  transferEntropyWeight: 0.25,  // FX has strong cross-pair info flow
  fokkerPlanckOverlay: true,
};

export function getMarketProfile(market: MarketKind): MarketPhysicsProfile {
  switch (market) {
    case "crypto": return CRYPTO;
    case "nse":
    case "bse": return EQUITY;
    case "forex": return FOREX;
    default: return CRYPTO;
  }
}
