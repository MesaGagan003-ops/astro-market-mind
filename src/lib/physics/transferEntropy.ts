// Transfer entropy — a directional, non-linear measure of information flow.
//   T(X → Y) = Σ p(y_{t+1}, y_t, x_t) · log [ p(y_{t+1} | y_t, x_t) / p(y_{t+1} | y_t) ]
//
// In markets it answers: "Does X cause Y?" beyond linear correlation.
// For us, the most useful application is BTC → altcoin (BTC leads almost
// every crypto move) and SPX/DXY → forex pair. Even without a full
// cross-asset feed, we use SELF-transfer-entropy across scales (does
// short-scale return predict long-scale return?) as a regime filter.
//
// We bin returns into {down, flat, up} and estimate probabilities by counting.

export interface TransferEntropyResult {
  selfTE: number;          // info flow from short-scale → long-scale of same asset
  crossTE: number | null;  // X → Y if a leader series is supplied
  selfDirection: number;   // signed: + means short-scale predicts UP next, - DOWN
  significance: "low" | "medium" | "high"; // heuristic strength label
}

function binReturn(r: number, eps: number): 0 | 1 | 2 {
  if (r > eps) return 2;
  if (r < -eps) return 0;
  return 1;
}

function teFromSequences(
  source: (0 | 1 | 2)[],
  target: (0 | 1 | 2)[],
): number {
  // T(source → target): how much source_t reduces uncertainty about target_{t+1}
  // beyond what target_t already tells us.
  if (source.length !== target.length || target.length < 20) return 0;
  // 3-state, 1-lag → 27 joint cells
  const joint = new Map<string, number>();
  const ty = new Map<string, number>(); // (target_t, target_{t+1})
  const tyx = new Map<string, number>(); // (target_t, target_{t+1}, source_t)
  const tyOnly = new Map<string, number>(); // target_t

  for (let t = 0; t < target.length - 1; t++) {
    const yk = `${target[t]}`;
    const yyk = `${target[t]},${target[t + 1]}`;
    const yyxk = `${target[t]},${target[t + 1]},${source[t]}`;
    const yxk = `${target[t]},${source[t]}`;
    tyOnly.set(yk, (tyOnly.get(yk) ?? 0) + 1);
    ty.set(yyk, (ty.get(yyk) ?? 0) + 1);
    tyx.set(yyxk, (tyx.get(yyxk) ?? 0) + 1);
    joint.set(yxk, (joint.get(yxk) ?? 0) + 1);
  }
  const N = target.length - 1;
  let te = 0;
  for (const [yyxk, c_yyx] of tyx) {
    const [yt, yt1, xt] = yyxk.split(",");
    const c_yyx_n = c_yyx;
    const c_yx = joint.get(`${yt},${xt}`) ?? 0;
    const c_yy = ty.get(`${yt},${yt1}`) ?? 0;
    const c_y = tyOnly.get(yt) ?? 0;
    if (c_yyx_n === 0 || c_yx === 0 || c_yy === 0 || c_y === 0) continue;
    const num = (c_yyx_n / N) * (c_y / N);
    const den = (c_yx / N) * (c_yy / N);
    if (den <= 0) continue;
    te += (c_yyx_n / N) * Math.log2(num / den);
  }
  return Math.max(0, te); // numerical floor
}

export function transferEntropy(
  prices: number[],
  leaderPrices?: number[] | null,
): TransferEntropyResult {
  const n = prices.length;
  if (n < 40) return { selfTE: 0, crossTE: null, selfDirection: 0, significance: "low" };

  // Compute log returns
  const r: number[] = [];
  for (let i = 1; i < n; i++) r.push(Math.log(prices[i] / prices[i - 1]));
  const std = Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length) || 1e-9;
  const eps = std * 0.4; // bin half-width

  // Short-scale = 1-step returns; long-scale = 5-step returns
  const short = r.map((x) => binReturn(x, eps));
  const long: (0 | 1 | 2)[] = [];
  for (let i = 5; i < r.length; i++) {
    const sum = r[i] + r[i - 1] + r[i - 2] + r[i - 3] + r[i - 4];
    long.push(binReturn(sum, eps * 2));
  }
  const aligned = short.slice(short.length - long.length);
  const selfTE = teFromSequences(aligned, long);

  // Self-direction: does the latest short return predict UP or DOWN?
  const recentShort = aligned.slice(-10);
  const upCount = recentShort.filter((b) => b === 2).length;
  const downCount = recentShort.filter((b) => b === 0).length;
  const selfDirection = (upCount - downCount) / Math.max(1, recentShort.length);

  let crossTE: number | null = null;
  if (leaderPrices && leaderPrices.length >= 40) {
    const lr: number[] = [];
    for (let i = 1; i < leaderPrices.length; i++) lr.push(Math.log(leaderPrices[i] / leaderPrices[i - 1]));
    const lstd = Math.sqrt(lr.reduce((a, b) => a + b * b, 0) / lr.length) || 1e-9;
    const leps = lstd * 0.4;
    const leaderBin = lr.map((x) => binReturn(x, leps));
    const minLen = Math.min(leaderBin.length, short.length);
    crossTE = teFromSequences(
      leaderBin.slice(-minLen) as (0 | 1 | 2)[],
      short.slice(-minLen),
    );
  }

  const significance: TransferEntropyResult["significance"] =
    selfTE > 0.05 ? "high" : selfTE > 0.015 ? "medium" : "low";

  return { selfTE, crossTE, selfDirection, significance };
}
