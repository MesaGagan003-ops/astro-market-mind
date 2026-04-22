import { useEffect, useState } from "react";
import { Scatter, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ComposedChart } from "recharts";
import { fetchCalibration, type CalibrationResult } from "@/lib/calibration";
import type { MarketAsset } from "@/lib/markets";
import type { Timeframe } from "@/lib/timeframes";

interface Props {
  coin: MarketAsset;
  timeframe: Timeframe;
  refreshKey?: number;
}

export function CalibrationPanel({ coin, timeframe, refreshKey }: Props) {
  const [data, setData] = useState<CalibrationResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchCalibration(coin.market, coin.symbol, timeframe.id)
      .then((res) => { if (!cancelled) setData(res); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [coin.market, coin.symbol, timeframe.id, refreshKey]);

  const chartData = (data?.bins ?? []).map((b) => ({
    predicted: b.predicted,
    observed: b.observed,
    count: b.count,
  }));
  const diagonal: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-display font-semibold text-sm">Calibration · Reliability Diagram</h3>
          <p className="text-[10px] text-muted-foreground">
            Diagonal = perfect calibration. Below = over-confident, above = under-confident.
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground">N = {data?.sampleSize ?? 0}</span>
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          Loading…
        </div>
      ) : !data || data.sampleSize === 0 ? (
        <div className="h-[220px] flex flex-col items-center justify-center text-xs text-muted-foreground gap-1">
          <span>No resolved predictions yet for this asset+timeframe.</span>
          <span className="text-[10px]">Calibration appears after the engine accumulates outcomes.</span>
        </div>
      ) : (
        <>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.3} />
                <XAxis
                  type="number" dataKey="predicted" domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
                  label={{ value: "Predicted confidence", position: "insideBottom", offset: -2, fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
                />
                <YAxis
                  type="number" dataKey="observed" domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const v = Number(value);
                    if (!Number.isFinite(v)) return ["—", String(name)];
                    return name === "count" ? [String(v), String(name)] : [`${(v * 100).toFixed(1)}%`, String(name)];
                  }}
                  contentStyle={{ background: "oklch(0.18 0.04 265)", border: "1px solid oklch(0.28 0.04 265)", fontSize: 11 }}
                />
                <ReferenceLine segment={diagonal} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="observed" stroke="var(--quantum)" strokeWidth={1.5} dot={false} />
                <Scatter data={chartData} fill="var(--bull)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2 text-[10px]">
            <Stat label="Brier" value={data.brierMean.toFixed(4)} hint="lower is better" />
            <Stat label="Reliability" value={data.reliability.toFixed(4)} hint="lower is better" />
            <Stat label="Resolution" value={data.resolution.toFixed(4)} hint="higher is better" />
            <Stat label="Base rate" value={`${(data.baseRate * 100).toFixed(1)}%`} hint="actual hit %" />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-muted-foreground uppercase">{label}</div>
      <div className="text-foreground font-mono font-semibold">{value}</div>
      {hint && <div className="text-muted-foreground text-[9px]">{hint}</div>}
    </div>
  );
}
