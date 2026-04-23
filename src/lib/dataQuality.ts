// Data quality scoring for reliable predictions.
// Detects sparse feeds, gaps, and stale ticks that would hurt model accuracy.

export interface DataQualityScore {
  score: number; // 0..1, where 1 = perfect data
  isGappy: boolean; // >30% missing expected ticks
  isSparse: boolean; // <12 unique prices in last hour
  isFresh: boolean; // last tick within 5 mins
  detail: string;
}

export function assessDataQuality(ticks: Array<{ price: number; ts: number }>): DataQualityScore {
  if (ticks.length === 0) {
    return { score: 0, isGappy: true, isSparse: true, isFresh: false, detail: "No ticks received" };
  }

  const now = Date.now();
  const lastTick = ticks[ticks.length - 1];
  const ageMs = now - lastTick.ts;
  const isFresh = ageMs < 5 * 60 * 1000; // 5 min

  // Gap detection: expected ~1 tick per second for crypto, but allow 5s for low-volume
  const timeSpanMs = lastTick.ts - ticks[0].ts;
  const expectedTicks = Math.max(1, Math.floor(timeSpanMs / 5000)); // 1 tick per 5s
  const gapRatio = 1 - ticks.length / Math.max(1, expectedTicks);
  const isGappy = gapRatio > 0.3;

  // Unique price count
  const uniquePrices = new Set(ticks.map((t) => t.price));
  const isSparse = uniquePrices.size < 12;

  // Composite score
  let score = 1.0;
  if (isGappy) score *= 0.6;
  if (isSparse) score *= 0.5;
  if (!isFresh) score *= 0.7;

  let detail = "";
  if (isGappy) detail += "Gappy feed. ";
  if (isSparse) detail += "Sparse prices. ";
  if (!isFresh) detail += "Stale data. ";
  if (!detail) detail = "Good data quality";

  return {
    score: Math.max(0, Math.min(1, score)),
    isGappy,
    isSparse,
    isFresh,
    detail: detail.trim(),
  };
}

export function isReadyForTrading(
  dataQuality: DataQualityScore,
  recentAccuracy: number,
  recentBrier: number,
  sampleCount: number,
): boolean {
  // Trading readiness requires:
  // 1. Good data quality (>0.6)
  // 2. Decent accuracy (>54%)
  // 3. Low Brier (<0.24)
  // 4. Enough trained samples (>80)
  return (
    dataQuality.score > 0.6 &&
    recentAccuracy > 0.54 &&
    recentBrier < 0.24 &&
    sampleCount > 80
  );
}
