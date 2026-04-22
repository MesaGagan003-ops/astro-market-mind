// Walk-forward backtest engine.
//
// Methodology (no look-ahead):
//   1. Slice history into expanding windows. Train on prices[0..t], forecast
//      next `horizon` bars with hybridPredict.
//   2. Take the SIGN of the predicted return as the trade direction.
//      +1 = long, -1 = short, 0 = no trade if |ret| < threshold.
//   3. PnL per trade = direction · realized_return − roundTripCost.
//   4. Equity curve compounds 1+pnl. Sharpe / Sortino / MaxDD computed on
//      the per-bar returns.
//   5. Brier score on directional probability (mapped from confidence).
//
// This is honest backtesting: each forecast uses ONLY data available up to
// that point. No retraining of weights mid-backtest (the live system does
// that separately via the learning loop).

import { hybridPredict } from "./physics/hybrid";
import { bpsToFrac, totalCostBps, type CostModel } from "./costs";

export interface BacktestBar {
  ts: number;
  price: number;
}

export interface BacktestOptions {
  /** How many bars ahead each forecast looks (matches "horizon"). */
  horizon: number;
  /** Minimum predicted absolute return (fraction) to take a trade. */
  threshold?: number;
  /** Round-trip cost model. */
  cost: CostModel;
  /** Step size between successive walk-forward windows. */
  step?: number;
  /** Minimum training window length. */
  minTrain?: number;
}

export interface BacktestTrade {
  ts: number;
  entry: number;
  exit: number;
  direction: 1 | -1;
  predictedRet: number;
  realizedRet: number;
  pnl: number;        // net of costs, fractional (e.g. 0.0034 = +34 bps)
  confidence: number;
  brier: number;      // (conf - hit)^2
  hit: boolean;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: Array<{ ts: number; equity: number }>;
  metrics: {
    nTrades: number;
    grossReturn: number;     // sum of gross trade returns
    netReturn: number;       // sum of net (after-cost) returns
    hitRate: number;         // share of profitable trades after costs
    avgWin: number;
    avgLoss: number;
    sharpe: number;          // annualized (assumes ~252 bars/yr scale)
    sortino: number;
    maxDrawdown: number;     // fractional, positive number
    calmar: number;
    brierMean: number;
    directionalAccuracy: number; // sign-only, ignores threshold filter
  };
}

export function walkForwardBacktest(
  bars: BacktestBar[],
  opts: BacktestOptions,
): BacktestResult {
  const horizon  = Math.max(1, opts.horizon);
  const threshold = opts.threshold ?? 0.0005; // 5 bps default deadband
  const step      = Math.max(1, opts.step ?? horizon);
  const minTrain  = Math.max(40, opts.minTrain ?? 60);
  const costFrac  = bpsToFrac(totalCostBps(opts.cost));

  const trades: BacktestTrade[] = [];
  let allReturnSum = 0;
  let signCorrect = 0;
  let signTotal   = 0;

  for (let t = minTrain; t + horizon < bars.length; t += step) {
    const train = bars.slice(0, t).map((b) => b.price);
    const entry = bars[t].price;
    const exit  = bars[t + horizon].price;
    if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0) continue;

    let pred;
    try {
      pred = hybridPredict(train, horizon);
    } catch {
      continue;
    }
    const predExit  = pred.forecast[horizon - 1].price;
    const predRet   = (predExit - entry) / entry;
    const realRet   = (exit - entry) / entry;

    // Sign-only directional accuracy (across ALL forecasts, even sub-threshold)
    if (Math.sign(predRet) === Math.sign(realRet) && realRet !== 0) signCorrect++;
    if (realRet !== 0) signTotal++;
    allReturnSum += realRet;

    if (Math.abs(predRet) < threshold) continue; // no trade

    const direction: 1 | -1 = predRet > 0 ? 1 : -1;
    const grossPnl = direction * realRet;
    const netPnl   = grossPnl - costFrac;
    const hit      = netPnl > 0;
    const conf     = Math.max(0, Math.min(1, pred.hybridConfidence));
    const brier    = (conf - (hit ? 1 : 0)) ** 2;

    trades.push({
      ts: bars[t].ts,
      entry, exit, direction,
      predictedRet: predRet,
      realizedRet: realRet,
      pnl: netPnl,
      confidence: conf,
      brier,
      hit,
    });
  }

  // Equity curve
  let eq = 1;
  let peak = 1;
  let maxDD = 0;
  const equityCurve: Array<{ ts: number; equity: number }> = [{ ts: bars[minTrain]?.ts ?? Date.now(), equity: 1 }];
  const perBarReturns: number[] = [];
  for (const tr of trades) {
    eq *= (1 + tr.pnl);
    perBarReturns.push(tr.pnl);
    peak = Math.max(peak, eq);
    const dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ ts: tr.ts, equity: eq });
  }

  const grossReturn = trades.reduce((a, b) => a + b.pnl + costFrac, 0);
  const netReturn   = eq - 1;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const hitRate = trades.length ? wins.length / trades.length : 0;
  const avgWin  = wins.length ? wins.reduce((a, b) => a + b.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b.pnl, 0) / losses.length : 0;

  // Sharpe/Sortino — annualize assuming ~252 trading periods per year
  // (rough scaling; more accurate scaling is per-bar-frequency dependent).
  const mean = perBarReturns.length ? perBarReturns.reduce((a, b) => a + b, 0) / perBarReturns.length : 0;
  const variance = perBarReturns.length
    ? perBarReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / perBarReturns.length
    : 0;
  const stddev = Math.sqrt(variance);
  const downside = perBarReturns.filter((r) => r < 0);
  const downVar = downside.length
    ? downside.reduce((a, b) => a + b * b, 0) / downside.length
    : 0;
  const downStd = Math.sqrt(downVar);
  const sharpe  = stddev > 0 ? (mean / stddev) * Math.sqrt(252) : 0;
  const sortino = downStd > 0 ? (mean / downStd) * Math.sqrt(252) : 0;
  const calmar  = maxDD > 0 ? netReturn / maxDD : 0;
  const brierMean = trades.length ? trades.reduce((a, b) => a + b.brier, 0) / trades.length : 0;
  const directionalAccuracy = signTotal ? signCorrect / signTotal : 0;

  void allReturnSum;

  return {
    trades,
    equityCurve,
    metrics: {
      nTrades: trades.length,
      grossReturn, netReturn, hitRate,
      avgWin, avgLoss, sharpe, sortino, maxDrawdown: maxDD, calmar,
      brierMean, directionalAccuracy,
    },
  };
}
