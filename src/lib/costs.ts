// Conservative round-trip cost defaults per market (in basis points).
// 1 bp = 0.01% of notional. These are intentionally pessimistic so that any
// surviving edge is real. Override via the Cost Model panel.
//
//   Crypto (Binance retail):   10 bps fees + 2 bps slippage  = 12 bps RT
//   NSE / BSE (incl. STT, GST, stamp, brokerage): 30 bps + 5 = 35 bps RT
//   Forex (retail spread):      2 bps spread + 1 bp slip     =  3 bps RT
//
// Costs are applied per ROUND-TRIP trade in the backtest PnL.

import type { MarketKind } from "./markets";

export interface CostModel {
  feesBps: number;     // exchange + broker fees (round-trip)
  slippageBps: number; // expected slippage per round-trip
}

export const DEFAULT_COSTS: Record<MarketKind, CostModel> = {
  crypto: { feesBps: 10, slippageBps: 2 },
  nse:    { feesBps: 30, slippageBps: 5 },
  bse:    { feesBps: 30, slippageBps: 5 },
  forex:  { feesBps: 2,  slippageBps: 1 },
};

export function totalCostBps(c: CostModel): number {
  return c.feesBps + c.slippageBps;
}

// Convert basis points → fractional decimal (10 bps → 0.001)
export function bpsToFrac(bps: number): number {
  return bps / 10_000;
}

// Tick-size rounding so prices look professional.
export function tickSize(market: MarketKind, price: number): number {
  if (market === "crypto") {
    if (price >= 1000) return 0.01;
    if (price >= 1)    return 0.0001;
    return 1e-6;
  }
  if (market === "nse" || market === "bse") return 0.05; // SEBI standard tick
  if (market === "forex") return price > 10 ? 0.0001 : 0.00001;
  return 0.01;
}

export function roundToTick(market: MarketKind, price: number): number {
  const t = tickSize(market, price);
  return Math.round(price / t) * t;
}
