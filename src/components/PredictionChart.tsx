import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from "recharts";
import type { HybridResult } from "@/lib/physics/hybrid";

interface Props {
  history: { ts: number; price: number }[];
  prediction: HybridResult;
  currentPrice: number;
  minutesPerStep: number;
}

export function PredictionChart({ history, prediction, currentPrice, minutesPerStep }: Props) {
  // Build unified series
  const histStart = history.length > 0 ? history[0].ts : Date.now();
  const histPoints = history.map((h) => ({
    t: h.ts,
    label: relTime(h.ts, histStart),
    actual: h.price,
  }));

  const lastTs = history.length > 0 ? history[history.length - 1].ts : Date.now();
  const stepMs = minutesPerStep * 60 * 1000;
  const futurePoints = prediction.forecast.map((f) => ({
    t: lastTs + f.step * stepMs,
    label: `+${formatMins(f.step * minutesPerStep)}`,
    predicted: f.price,
    upper: f.upper,
    lower: f.lower,
    qslU: f.qslUpper,
    qslL: f.qslLower,
    sslU: f.sslUpper,
    sslL: f.sslLower,
  }));

  // Bridge point so the predicted line starts at current price
  const bridge = { t: lastTs, label: "now", actual: currentPrice, predicted: currentPrice };
  const data = [...histPoints, bridge, ...futurePoints];

  const allVals = data.flatMap((d: any) =>
    [d.actual, d.predicted, d.upper, d.lower, d.qslU, d.qslL, d.sslU, d.sslL].filter((v) => typeof v === "number"),
  );
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const pad = (max - min) * 0.05;

  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="qslFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.22 305)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="oklch(0.72 0.22 305)" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="sslFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.78 0.18 130)" stopOpacity={0.15} />
            <stop offset="100%" stopColor="oklch(0.78 0.18 130)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} stroke="oklch(0.28 0.04 265)" interval="preserveStartEnd" />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
          stroke="oklch(0.28 0.04 265)"
          tickFormatter={(v) => formatPrice(v)}
          width={70}
        />
        <Tooltip
          contentStyle={{
            background: "oklch(0.17 0.03 265)",
            border: "1px solid oklch(0.28 0.04 265)",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value: any, name: any) => [typeof value === "number" ? formatPrice(value) : String(value), String(name)]}
        />
        <ReferenceLine y={currentPrice} stroke="oklch(0.72 0.18 230)" strokeDasharray="3 3" strokeOpacity={0.5} />
        {/* QSL band */}
        <Area dataKey="qslU" stroke="oklch(0.72 0.22 305)" strokeWidth={0.5} strokeDasharray="3 3" fill="url(#qslFill)" connectNulls />
        <Area dataKey="qslL" stroke="oklch(0.72 0.22 305)" strokeWidth={0.5} strokeDasharray="3 3" fill="transparent" connectNulls />
        {/* SSL band */}
        <Line dataKey="sslU" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls />
        <Line dataKey="sslL" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls />
        {/* GARCH 1σ band */}
        <Line dataKey="upper" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls />
        <Line dataKey="lower" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls />
        {/* Actual */}
        <Line dataKey="actual" stroke="oklch(0.95 0.01 250)" strokeWidth={1.5} dot={false} connectNulls />
        {/* Prediction */}
        <Line dataKey="predicted" stroke="oklch(0.65 0.24 25)" strokeWidth={2} dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

function formatMins(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  if (m < 60 * 24 * 7) return `${Math.round(m / (60 * 24))}d`;
  return `${(m / (60 * 24 * 7)).toFixed(1)}w`;
}

function relTime(ts: number, start: number): string {
  const d = Math.round((ts - start) / 60000);
  return `${d}m`;
}
