// Technical indicators used both as MODEL FEATURES (VWAP z-score, EMA slope)
// and as VISUAL OVERLAYS on the actual price line (MA, MACD, SuperTrend).
//
// Design rules:
//   • Indicators on the ACTUAL line only — never on the predicted line.
//     Computing MACD on a forecast is mathematically circular and adds no
//     predictive edge.
//   • The forecast carries its own statistical envelopes (GARCH 1σ + QSL).
//   • VWAP-z and EMA-slope feed the hybrid model as bias signals.

export interface IndicatorPoint {
  ts: number;
  price: number;
  ma20?: number;
  ma50?: number;
  ema12?: number;
  ema26?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  vwap?: number;
  vwapUpper?: number;
  vwapLower?: number;
  superTrend?: number;
  superTrendDir?: 1 | -1;
}

// ---------- moving averages ----------
export function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// ---------- MACD ----------
export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) => {
    const a = ef[i], b = es[i];
    return a !== undefined && b !== undefined ? a - b : undefined;
  });
  const lineFilled = line.map((v) => v ?? 0);
  const sig = ema(lineFilled, signal);
  return {
    macd: line,
    signal: line.map((_, i) => (line[i] === undefined ? undefined : sig[i])),
    hist: line.map((_, i) => {
      const m = line[i], s = sig[i];
      return m !== undefined && s !== undefined ? m - s : undefined;
    }),
  };
}

// ---------- VWAP (price-only proxy when no volume) ----------
// True VWAP needs (price · volume); we don't have per-tick volume from
// every provider, so we use a session-anchored rolling mean weighted by
// |Δprice| as a flow proxy. This is the standard fallback used in
// retail charting libraries when volume is unavailable.
export function vwapProxy(values: number[], window = 60): {
  vwap: (number | undefined)[];
  upper: (number | undefined)[];
  lower: (number | undefined)[];
  z: (number | undefined)[];
} {
  const vwap: (number | undefined)[] = new Array(values.length).fill(undefined);
  const upper: (number | undefined)[] = new Array(values.length).fill(undefined);
  const lower: (number | undefined)[] = new Array(values.length).fill(undefined);
  const z: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    let wSum = 0, pwSum = 0, sq = 0;
    for (let j = start; j <= i; j++) {
      const w = j === 0 ? 1 : Math.abs(values[j] - values[j - 1]) + 1e-9;
      wSum += w;
      pwSum += values[j] * w;
    }
    const v = pwSum / wSum;
    for (let j = start; j <= i; j++) sq += (values[j] - v) ** 2;
    const sd = Math.sqrt(sq / Math.max(1, i - start));
    vwap[i] = v;
    upper[i] = v + 2 * sd;
    lower[i] = v - 2 * sd;
    z[i] = sd > 0 ? (values[i] - v) / sd : 0;
  }
  return { vwap, upper, lower, z };
}

// ---------- EMA slope (velocity of trend) ----------
// Returns slope of EMA over the last `lookback` bars, normalised by price.
// Positive = uptrend, negative = downtrend. Used as a feature.
export function emaSlope(values: number[], period = 20, lookback = 5): number {
  const e = ema(values, period);
  const last = e[e.length - 1];
  const prev = e[e.length - 1 - lookback];
  if (last === undefined || prev === undefined) return 0;
  const ref = values[values.length - 1] || 1;
  return (last - prev) / lookback / ref; // per-bar normalised slope
}

// ---------- SuperTrend (ATR-based) ----------
export function superTrend(values: number[], period = 10, mult = 3) {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  const dir: (1 | -1)[] = new Array(values.length).fill(1);
  if (values.length < period + 1) return { line: out, dir };
  // approximate ATR from |Δprice| (no high/low without OHLC)
  const tr: number[] = [0];
  for (let i = 1; i < values.length; i++) tr.push(Math.abs(values[i] - values[i - 1]));
  const atr: number[] = new Array(values.length).fill(0);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += tr[i];
    if (i >= period) s -= tr[i - period];
    if (i >= period - 1) atr[i] = s / period;
  }
  let upper = values[period] + mult * atr[period];
  let lower = values[period] - mult * atr[period];
  let trend: 1 | -1 = 1;
  for (let i = period; i < values.length; i++) {
    const u = values[i] + mult * atr[i];
    const l = values[i] - mult * atr[i];
    upper = values[i - 1] <= upper ? Math.min(u, upper) : u;
    lower = values[i - 1] >= lower ? Math.max(l, lower) : l;
    if (trend === 1 && values[i] < lower) trend = -1;
    else if (trend === -1 && values[i] > upper) trend = 1;
    out[i] = trend === 1 ? lower : upper;
    dir[i] = trend;
  }
  return { line: out, dir };
}

// ---------- combined feature extraction for the hybrid model ----------
export interface IndicatorFeatures {
  vwapZ: number;          // current price's z-score vs rolling VWAP — mean-revert signal
  emaSlopeFast: number;   // EMA(20) slope per bar — trend velocity
  emaSlopeSlow: number;   // EMA(50) slope per bar — regime velocity
  macdHist: number;       // MACD histogram (momentum)
  bias: number;           // [-1, 1] consolidated directional bias for hybrid
}

export function extractFeatures(prices: number[]): IndicatorFeatures {
  if (prices.length < 30) return { vwapZ: 0, emaSlopeFast: 0, emaSlopeSlow: 0, macdHist: 0, bias: 0 };
  const { z } = vwapProxy(prices, Math.min(60, prices.length));
  const vwapZ = z[z.length - 1] ?? 0;
  const sFast = emaSlope(prices, 20, 5);
  const sSlow = emaSlope(prices, 50, 10);
  const m = macd(prices);
  const histArr = m.hist.filter((v): v is number => v !== undefined);
  const macdHist = histArr[histArr.length - 1] ?? 0;
  const last = prices[prices.length - 1] || 1;
  const macdNorm = macdHist / last;
  // Consolidated bias:
  //   • Strong VWAP-z (>2) → mean-revert signal opposite of z sign.
  //   • EMA-slope fast & slow agreement → trend continuation signal.
  //   • MACD hist polarity → momentum confirmation.
  // Output clipped to [-1, 1].
  const meanRevert = -Math.tanh(vwapZ / 2.5) * 0.35;
  const trend = Math.tanh((sFast * 5000 + sSlow * 3000)) * 0.45;
  const momentum = Math.tanh(macdNorm * 8000) * 0.25;
  const bias = Math.max(-1, Math.min(1, meanRevert + trend + momentum));
  return { vwapZ, emaSlopeFast: sFast, emaSlopeSlow: sSlow, macdHist, bias };
}
