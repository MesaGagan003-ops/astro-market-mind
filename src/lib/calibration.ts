// Calibration (reliability diagram) + Brier decomposition.
// Reads resolved predictions from Lovable Cloud and bins by hybrid_confidence.
// A perfectly-calibrated model has predicted=actual on the diagonal.

import { supabase } from "@/integrations/supabase/client";

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  predicted: number;     // mean confidence in bin
  observed: number;      // actual hit-rate in bin
  count: number;
}

export interface CalibrationResult {
  bins: CalibrationBin[];
  brierMean: number;
  reliability: number;   // weighted Σ count · (predicted - observed)²  / N — lower is better
  resolution: number;    // weighted Σ count · (observed - baseRate)²    / N — higher is better
  uncertainty: number;   // baseRate · (1 - baseRate)
  baseRate: number;
  sampleSize: number;
}

interface OutcomeRow {
  brier_score: number;
  direction_correct: boolean;
  predictions: { hybrid_confidence: number } | { hybrid_confidence: number }[] | null;
}

export async function fetchCalibration(
  market: string, symbol: string, timeframe: string,
  bins = 10,
): Promise<CalibrationResult> {
  const empty: CalibrationResult = {
    bins: [], brierMean: 0, reliability: 0, resolution: 0,
    uncertainty: 0, baseRate: 0, sampleSize: 0,
  };
  try {
    const { data, error } = await supabase
      .from("prediction_outcomes")
      .select(`
        brier_score, direction_correct,
        predictions!inner ( hybrid_confidence, market, symbol, timeframe )
      `)
      .eq("predictions.market", market)
      .eq("predictions.symbol", symbol)
      .eq("predictions.timeframe", timeframe)
      .order("resolved_at", { ascending: false })
      .limit(2000);
    if (error || !data || data.length === 0) return empty;

    const rows = (data as unknown as OutcomeRow[]).map((r) => {
      const p = Array.isArray(r.predictions) ? r.predictions[0] : r.predictions;
      return { conf: Number(p?.hybrid_confidence ?? 0), hit: !!r.direction_correct, brier: Number(r.brier_score) };
    });

    const baseRate = rows.reduce((a, b) => a + (b.hit ? 1 : 0), 0) / rows.length;
    const brierMean = rows.reduce((a, b) => a + b.brier, 0) / rows.length;

    const out: CalibrationBin[] = [];
    for (let i = 0; i < bins; i++) {
      const lo = i / bins, hi = (i + 1) / bins;
      const inBin = rows.filter((r) => r.conf >= lo && (i === bins - 1 ? r.conf <= hi : r.conf < hi));
      if (inBin.length === 0) continue;
      const predicted = inBin.reduce((a, b) => a + b.conf, 0) / inBin.length;
      const observed  = inBin.reduce((a, b) => a + (b.hit ? 1 : 0), 0) / inBin.length;
      out.push({ binStart: lo, binEnd: hi, predicted, observed, count: inBin.length });
    }

    const N = rows.length;
    const reliability = out.reduce((a, b) => a + b.count * (b.predicted - b.observed) ** 2, 0) / N;
    const resolution  = out.reduce((a, b) => a + b.count * (b.observed - baseRate) ** 2, 0) / N;
    const uncertainty = baseRate * (1 - baseRate);

    return { bins: out, brierMean, reliability, resolution, uncertainty, baseRate, sampleSize: N };
  } catch {
    return empty;
  }
}
