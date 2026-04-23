// Adaptive learning layer for MIRO.
// Persists every prediction to Lovable Cloud, resolves outcomes after the
// horizon elapses, and EMA-updates per-(market,symbol,timeframe) component
// weights based on Brier score so the hybrid engine learns from mistakes.

import { supabase } from "@/integrations/supabase/client";

export interface AdaptiveWeights {
  arima: number;
  hmm: number;
  entropy: number;
  hurst: number;
  llm: number;
  samples: number;
  recentBrier: number;
  recentAccuracy: number;
}

const DEFAULT_WEIGHTS: AdaptiveWeights = {
  arima: 0.48, hmm: 0.30, entropy: 0.14, hurst: 0.08, llm: 0,
  samples: 0, recentBrier: 0.25, recentAccuracy: 0.5,
};

const cache = new Map<string, AdaptiveWeights>();
const key = (m: string, s: string, t: string) => `${m}::${s}::${t}`;

export async function loadWeights(market: string, symbol: string, timeframe: string): Promise<AdaptiveWeights> {
  const k = key(market, symbol, timeframe);
  if (cache.has(k)) return cache.get(k)!;
  try {
    const { data } = await supabase
      .from("model_weights")
      .select("*")
      .eq("market", market).eq("symbol", symbol).eq("timeframe", timeframe)
      .maybeSingle();
    if (data) {
      const w: AdaptiveWeights = {
        arima: Number(data.arima_w), hmm: Number(data.hmm_w),
        entropy: Number(data.entropy_w), hurst: Number(data.hurst_w),
        llm: Number(data.llm_w), samples: data.samples,
        recentBrier: Number(data.recent_brier),
        recentAccuracy: Number(data.recent_accuracy),
      };
      cache.set(k, w);
      return w;
    }
  } catch (e) {
    console.warn("[learning] loadWeights failed", e);
  }
  cache.set(k, DEFAULT_WEIGHTS);
  return DEFAULT_WEIGHTS;
}

export interface PredictionRecord {
  market: string;
  symbol: string;
  timeframe: string;
  spotPrice: number;
  predictedPrice: number;
  direction: "up" | "down" | "flat";
  horizonSeconds: number;
  hybridConfidence: number;
  weights: Record<string, number>;
  features?: Record<string, unknown>;
}

export async function recordPredictionCloud(p: PredictionRecord): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("predictions").insert({
      market: p.market, symbol: p.symbol, timeframe: p.timeframe,
      spot_price: p.spotPrice, predicted_price: p.predictedPrice,
      direction: p.direction, horizon_seconds: p.horizonSeconds,
      hybrid_confidence: p.hybridConfidence,
      weights: p.weights as never,
      features: (p.features ?? null) as never,
      llm_bias: null,
      resolves_at: new Date(Date.now() + p.horizonSeconds * 1000).toISOString(),
    }).select("id").single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (e) {
    console.warn("[learning] recordPrediction failed", e);
    return null;
  }
}

// Resolve any predictions whose resolves_at has passed, using a price oracle
// callback (so the caller supplies the latest price for the symbol).
export async function resolvePendingPredictions(
  market: string, symbol: string, timeframe: string, currentPrice: number,
): Promise<number> {
  try {
    const { data: due } = await supabase
      .from("predictions")
      .select("id, spot_price, predicted_price, direction, hybrid_confidence")
      .eq("market", market).eq("symbol", symbol).eq("timeframe", timeframe)
      .lte("resolves_at", new Date().toISOString())
      .limit(50);
    if (!due || due.length === 0) return 0;

    const ids = due.map((d) => d.id);
    const { data: existing } = await supabase
      .from("prediction_outcomes").select("prediction_id").in("prediction_id", ids);
    const resolved = new Set((existing ?? []).map((r) => r.prediction_id));
    const toResolve = due.filter((d) => !resolved.has(d.id));
    if (toResolve.length === 0) return 0;

    let totalBrier = 0, correct = 0;
    const outcomes = toResolve.map((p) => {
      const actualDir: "up" | "down" | "flat" =
        Math.abs(currentPrice - Number(p.spot_price)) < Number(p.spot_price) * 0.0005
          ? "flat"
          : currentPrice > Number(p.spot_price) ? "up" : "down";
      const directionCorrect = actualDir === p.direction;
      const absErr = Math.abs(currentPrice - Number(p.predicted_price));
      const pctErr = absErr / Math.max(1e-9, Number(p.spot_price));
      // Brier: (confidence_in_correct_outcome - actual)²
      const conf = Number(p.hybrid_confidence);
      const brier = (directionCorrect ? (1 - conf) ** 2 : conf ** 2);
      totalBrier += brier;
      if (directionCorrect) correct++;
      return {
        prediction_id: p.id,
        actual_price: currentPrice,
        actual_direction: actualDir,
        direction_correct: directionCorrect,
        abs_error: absErr,
        pct_error: pctErr,
        brier_score: brier,
      };
    });

    await supabase.from("prediction_outcomes").insert(outcomes);

    // EMA-update component weights: shrink weights toward 0 when Brier is high.
    await updateWeightsFromOutcomes(market, symbol, timeframe,
      totalBrier / outcomes.length, correct / outcomes.length, outcomes.length);

    return outcomes.length;
  } catch (e) {
    console.warn("[learning] resolve failed", e);
    return 0;
  }
}

async function updateWeightsFromOutcomes(
  market: string, symbol: string, timeframe: string,
  batchBrier: number, batchAccuracy: number, n: number,
) {
  const current = await loadWeights(market, symbol, timeframe);
  const alpha = Math.min(0.3, n / 20); // EMA rate
  const newBrier = current.recentBrier * (1 - alpha) + batchBrier * alpha;
  const newAcc = current.recentAccuracy * (1 - alpha) + batchAccuracy * alpha;

  // Trust factor: higher when accuracy > 0.5, lower when worse than coin-flip.
  const trust = Math.max(0.3, Math.min(1.5, 1 + (newAcc - 0.5) * 2));
  // Re-weight components: shrink ARIMA share when accuracy is bad, push toward HMM+LLM.
  const w = {
    arima: current.arima * (newAcc > 0.55 ? 1.02 : 0.97),
    hmm:   current.hmm   * (newAcc > 0.55 ? 1.01 : 1.03),
    entropy: current.entropy * (newAcc > 0.55 ? 1.0 : 0.99),
    hurst: current.hurst * (newAcc > 0.55 ? 1.0 : 0.99),
    llm: 0,
  };
  const sum = w.arima + w.hmm + w.entropy + w.hurst + w.llm;
  const norm = {
    arima: w.arima / sum, hmm: w.hmm / sum, entropy: w.entropy / sum,
    hurst: w.hurst / sum, llm: w.llm / sum,
  };

  const next: AdaptiveWeights = {
    ...norm,
    samples: current.samples + n,
    recentBrier: newBrier,
    recentAccuracy: newAcc,
  };
  cache.set(key(market, symbol, timeframe), next);

  try {
    await supabase.from("model_weights").upsert({
      market, symbol, timeframe,
      arima_w: norm.arima, hmm_w: norm.hmm, entropy_w: norm.entropy,
      hurst_w: norm.hurst, llm_w: norm.llm,
      samples: next.samples, recent_brier: newBrier, recent_accuracy: newAcc,
      updated_at: new Date().toISOString(),
    }, { onConflict: "market,symbol,timeframe" });
  } catch (e) {
    console.warn("[learning] upsert weights failed", e);
  }
  // unused trust variable kept for future tuning
  void trust;
}
