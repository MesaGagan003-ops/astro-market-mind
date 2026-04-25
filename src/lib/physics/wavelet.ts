// Discrete wavelet decomposition (Haar wavelet, à trous algorithm).
// Splits the price series into TREND + multiple DETAIL scales:
//   prices = trend + detail_1 + detail_2 + ... + detail_J
// where detail_k captures fluctuations on scale 2^k bars.
//
// For predictions we extract:
//   - the SMOOTHED TREND (low-pass) — the macro direction
//   - per-scale detail energy — measures how noisy each frequency band is
//   - dominant scale — which timeframe currently carries the most variance.
//
// This is non-stationary-friendly (unlike EMA) and cleanly separates
// intraday noise from multi-hour trend. ARIMA fed the trend instead of the
// raw series produces a much more stable forecast on choppy markets.

export interface WaveletResult {
  trend: number[];                // smoothed series, same length as input
  detailEnergy: number[];         // variance per scale [scale_1, scale_2, ...]
  dominantScale: number;          // index of max-energy scale
  smoothedDirection: "up" | "down" | "flat";
  trendSlope: number;             // last-step slope of trend in % per step
}

// 1-D à trous (stationary) Haar transform — preserves time alignment so
// trend[i] corresponds to prices[i] (no downsampling artefacts).
function smoothOnce(arr: number[], step: number): number[] {
  const n = arr.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = arr[Math.max(0, i - step)];
    const b = arr[i];
    const c = arr[Math.min(n - 1, i + step)];
    out[i] = (a + 2 * b + c) / 4; // B3-spline-like low-pass
  }
  return out;
}

export function waveletDecompose(prices: number[], maxScales = 4): WaveletResult {
  const n = prices.length;
  if (n < 16) {
    return {
      trend: [...prices],
      detailEnergy: [0],
      dominantScale: 0,
      smoothedDirection: "flat",
      trendSlope: 0,
    };
  }
  const J = Math.min(maxScales, Math.floor(Math.log2(n)) - 2);
  let current = [...prices];
  const details: number[][] = [];
  for (let j = 0; j < J; j++) {
    const step = 1 << j; // 1, 2, 4, 8, ...
    const next = smoothOnce(current, step);
    const detail = current.map((v, i) => v - next[i]);
    details.push(detail);
    current = next;
  }
  const trend = current;
  // Energy = variance per scale (last 30% of series — current regime)
  const tail = Math.max(10, Math.floor(n * 0.3));
  const detailEnergy = details.map((d) => {
    const slice = d.slice(-tail);
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    return slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length;
  });
  let dominantScale = 0;
  for (let i = 1; i < detailEnergy.length; i++) {
    if (detailEnergy[i] > detailEnergy[dominantScale]) dominantScale = i;
  }

  // Trend slope: last 5 trend bars
  const k = Math.min(5, trend.length - 1);
  const slope = k > 0 ? (trend[trend.length - 1] - trend[trend.length - 1 - k]) / (k * trend[trend.length - 1 - k]) : 0;
  const smoothedDirection: WaveletResult["smoothedDirection"] =
    Math.abs(slope) < 1e-5 ? "flat" : slope > 0 ? "up" : "down";

  return { trend, detailEnergy, dominantScale, smoothedDirection, trendSlope: slope };
}
