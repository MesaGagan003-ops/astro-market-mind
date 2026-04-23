// Tracks past predictions and grades them once their horizon elapses.
// Stored in localStorage per coin+timeframe.

export interface PastPrediction {
  id: string;
  coinId: string;
  timeframeId: string;
  startTs: number;
  resolveTs: number;
  startPrice: number;
  predictedPrice: number;
  predictedDirection: "up" | "down" | "flat";
  hybridConfidence: number;
  resolvedPrice?: number;
  actualDirection?: "up" | "down" | "flat";
  correct?: boolean;
}

const KEY = "pe.predictions.v1";

export function loadPredictions(): PastPrediction[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function savePredictions(list: PastPrediction[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list.slice(-200)));
}

export function recordPrediction(p: Omit<PastPrediction, "id">): PastPrediction[] {
  const list = loadPredictions();
  const item: PastPrediction = { ...p, id: `${p.coinId}-${p.startTs}` };
  // Dedupe within same minute
  if (!list.find((x) => x.id === item.id)) list.push(item);
  savePredictions(list);
  return list;
}

export function resolvePredictions(currentPrice: number, ts: number): PastPrediction[] {
  const list = loadPredictions();
  let changed = false;
  for (const p of list) {
    if (p.correct === undefined && ts >= p.resolveTs) {
      p.resolvedPrice = currentPrice;
      const delta = currentPrice - p.startPrice;
      p.actualDirection = Math.abs(delta) < 1e-12 ? "flat" : delta > 0 ? "up" : "down";
      // Directional accuracy: flat predictions are correct only if actual is also flat-ish
      if (p.predictedDirection === "flat") {
        const tol = Math.abs(p.predictedPrice - p.startPrice) || p.startPrice * 0.001;
        p.correct = Math.abs(delta) <= tol * 1.5;
      } else {
        p.correct = p.predictedDirection === p.actualDirection;
      }
      changed = true;
    }
  }
  if (changed) savePredictions(list);
  return list;
}

export interface AccuracyStats {
  total: number;
  resolved: number;
  correct: number;
  rate: number;
  /** alias of rate (0..1) for downstream consumers */
  accuracy: number;
  /** mean Brier score across resolved predictions */
  brier: number;
  lastN: { id: string; correct: boolean }[];
}

export function computeAccuracy(coinId: string, timeframeId: string): AccuracyStats {
  const all = loadPredictions().filter((p) => p.coinId === coinId && p.timeframeId === timeframeId);
  const resolved = all.filter((p) => p.correct !== undefined);
  const correct = resolved.filter((p) => p.correct).length;
  const rate = resolved.length > 0 ? correct / resolved.length : 0;
  let brierSum = 0;
  for (const p of resolved) {
    const c = Math.max(0, Math.min(1, p.hybridConfidence ?? 0.5));
    brierSum += p.correct ? (1 - c) ** 2 : c ** 2;
  }
  const brier = resolved.length > 0 ? brierSum / resolved.length : 0.25;
  return {
    total: all.length,
    resolved: resolved.length,
    correct,
    rate,
    accuracy: rate,
    brier,
    lastN: resolved.slice(-20).map((p) => ({ id: p.id, correct: !!p.correct })),
  };
}
