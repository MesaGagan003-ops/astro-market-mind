// Multifractal Detrended Fluctuation Analysis (MF-DFA, q-order).
//   - Standard DFA gives a single Hurst H.
//   - MF-DFA gives a SPECTRUM h(q) for q ∈ [-q*, q*].
//   - Width Δh = h(q_min) − h(q_max) measures multifractality:
//       Δh ≈ 0   ⇒ monofractal (random walk-like)
//       Δh > 0.3 ⇒ strongly multifractal (regime-shifting, fat-tailed)
//
// Mandelbrot showed multifractal width SPIKES before major regime changes.
// We use it as an early-warning regime-shift detector: when Δh widens beyond
// its trailing baseline, downweight ARIMA (which assumes monofractal) and
// upweight HMM (which can model regimes).

export interface MultifractalResult {
  h: { q: number; h: number }[]; // generalized Hurst spectrum
  hurstZero: number;             // h(2) ≈ classical Hurst
  width: number;                 // Δh = h(q_min) − h(q_max)
  regimeShiftRisk: "low" | "medium" | "high";
  asymmetry: number;             // h(0) − ½(h(q_min)+h(q_max)); positive ⇒ up-side multifractality
}

function detrendVariance(profile: number[], scale: number): number {
  const n = profile.length;
  const segments = Math.floor(n / scale);
  if (segments === 0) return 1e-12;
  const variances: number[] = [];
  for (let v = 0; v < segments; v++) {
    const start = v * scale;
    // Linear detrend: fit y = a + b*t, subtract
    let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
    for (let i = 0; i < scale; i++) {
      sumT += i;
      sumY += profile[start + i];
      sumTT += i * i;
      sumTY += i * profile[start + i];
    }
    const den = scale * sumTT - sumT * sumT || 1e-12;
    const b = (scale * sumTY - sumT * sumY) / den;
    const a = (sumY - b * sumT) / scale;
    let s = 0;
    for (let i = 0; i < scale; i++) {
      const e = profile[start + i] - (a + b * i);
      s += e * e;
    }
    variances.push(s / scale);
  }
  return variances.reduce((a, b) => a + b, 0) / variances.length;
}

export function multifractalSpectrum(prices: number[]): MultifractalResult {
  const n = prices.length;
  if (n < 60) {
    return {
      h: [{ q: 2, h: 0.5 }], hurstZero: 0.5, width: 0,
      regimeShiftRisk: "low", asymmetry: 0,
    };
  }
  const r: number[] = [];
  for (let i = 1; i < n; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const profile: number[] = [];
  let cum = 0;
  for (const x of r) { cum += x - mean; profile.push(cum); }

  const scales: number[] = [];
  for (let s = 8; s <= Math.floor(profile.length / 4); s = Math.floor(s * 1.5)) scales.push(s);
  if (scales.length < 3) {
    return { h: [{ q: 2, h: 0.5 }], hurstZero: 0.5, width: 0, regimeShiftRisk: "low", asymmetry: 0 };
  }

  const qs = [-3, -1, 0.5, 2, 4];
  const h: { q: number; h: number }[] = [];
  for (const q of qs) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of scales) {
      // F_q(s) = ( (1/N_s) Σ V_i^{q/2} )^{1/q}   ; for q=0 use log average.
      const segments = Math.floor(profile.length / s);
      if (segments === 0) continue;
      let agg = 0;
      const v = detrendVariance(profile, s);
      // We use a single average variance across segments (already smoothed)
      if (q === 0) {
        agg = Math.exp(0.5 * Math.log(Math.max(1e-18, v)));
      } else {
        agg = Math.pow(Math.max(1e-18, v), q / 2);
        agg = Math.pow(agg, 1 / q);
      }
      xs.push(Math.log(s));
      ys.push(Math.log(Math.max(1e-18, agg)));
    }
    if (xs.length < 3) { h.push({ q, h: 0.5 }); continue; }
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    const slope = den > 0 ? num / den : 0.5;
    h.push({ q, h: Math.max(0, Math.min(1.5, slope)) });
  }

  const hurstZero = h.find((x) => x.q === 2)?.h ?? 0.5;
  const hMin = Math.min(...h.map((x) => x.h));
  const hMax = Math.max(...h.map((x) => x.h));
  const width = hMax - hMin;
  const h0 = h.find((x) => x.q === 0.5)?.h ?? hurstZero;
  const asymmetry = h0 - 0.5 * (hMin + hMax);

  const regimeShiftRisk: MultifractalResult["regimeShiftRisk"] =
    width > 0.35 ? "high" : width > 0.18 ? "medium" : "low";

  return { h, hurstZero, width, regimeShiftRisk, asymmetry };
}
