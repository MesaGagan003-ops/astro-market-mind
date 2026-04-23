import { ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip, CartesianGrid } from "recharts";
import type { HybridResult } from "@/lib/physics/hybrid";

interface Props {
  history: { ts: number; price: number }[];
  prediction: HybridResult;
  currentPrice: number;
  minutesPerStep: number;
}

export function PredictionChart({ history, prediction, currentPrice, minutesPerStep }: Props) {
  const histPoints = history.map((h) => ({ t: h.ts, actual: h.price }));

  // Anchor the prediction at the LAST ACTUAL data point, not at the current
  // wall-clock. This guarantees the predicted line continues seamlessly from
  // where the actual tick data ends — no time gap, no price jump — across
  // crypto, forex, NSE and BSE (whose feeds may lag the wall clock).
  const lastTs = history.length > 0 ? history[history.length - 1].ts : Date.now();
  const lastActual = history.length > 0 ? history[history.length - 1].price : currentPrice;
  const stepMs = minutesPerStep * 60 * 1000;
  const futurePoints = prediction.forecast.map((f) => ({
    t: lastTs + f.step * stepMs,
    predicted: f.price,
    upper: f.upper,
    lower: f.lower,
    qslU: f.qslUpper,
    qslL: f.qslLower,
    sslU: f.sslUpper,
    sslL: f.sslLower,
  }));

  // Bridge: predicted line begins exactly where actual line ends (same ts,
  // same price). This removes the visible "jump" the chart used to show
  // when currentPrice diverged from the last bar's close.
  const bridge = { t: lastTs, actual: lastActual, predicted: lastActual };
  const data = [...histPoints, bridge, ...futurePoints];

  const allVals = data.flatMap((d: any) =>
    [d.actual, d.predicted, d.upper, d.lower, d.qslU, d.qslL, d.sslU, d.sslL].filter((v) => typeof v === "number"),
  );
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const pad = (max - min) * 0.06 || max * 0.001;

  const tStart = data[0]?.t ?? lastTs;
  const tEnd = data[data.length - 1]?.t ?? lastTs;

  return (
    <ResponsiveContainer width="100%" height={420}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="qslFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.22 305)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="oklch(0.72 0.22 305)" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.25} vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={[tStart, tEnd]}
          tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
          stroke="oklch(0.28 0.04 265)"
          tickFormatter={(v) => formatTime(v, tEnd - tStart)}
          minTickGap={48}
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
          stroke="oklch(0.28 0.04 265)"
          tickFormatter={(v) => formatPrice(v)}
          width={70}
          orientation="right"
        />
        <Tooltip
          contentStyle={{
            background: "oklch(0.17 0.03 265)",
            border: "1px solid oklch(0.28 0.04 265)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(v: any) => new Date(v).toLocaleString()}
          formatter={(value: any, name: any) => [typeof value === "number" ? formatPrice(value) : String(value), String(name)]}
        />
        <ReferenceLine x={lastTs} stroke="oklch(0.65 0.03 255)" strokeDasharray="2 4" strokeOpacity={0.5} label={{ value: "now", position: "top", fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
        <ReferenceLine y={currentPrice} stroke="oklch(0.72 0.18 230)" strokeDasharray="3 3" strokeOpacity={0.4} />
        {/* QSL band */}
        <Area dataKey="qslU" stroke="oklch(0.72 0.22 305)" strokeWidth={0.5} strokeDasharray="3 3" fill="url(#qslFill)" connectNulls isAnimationActive={false} />
        <Area dataKey="qslL" stroke="oklch(0.72 0.22 305)" strokeWidth={0.5} strokeDasharray="3 3" fill="transparent" connectNulls isAnimationActive={false} />
        {/* SSL */}
        <Line dataKey="sslU" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="sslL" stroke="oklch(0.78 0.18 130)" strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls isAnimationActive={false} />
        {/* GARCH 1σ */}
        <Line dataKey="upper" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="lower" stroke="oklch(0.75 0.18 60)" strokeWidth={0.8} strokeOpacity={0.6} dot={false} connectNulls isAnimationActive={false} />
        {/* Actual price (CoinGecko-style filled area) */}
        <Area dataKey="actual" stroke="oklch(0.72 0.18 230)" strokeWidth={1.6} fill="url(#actualFill)" dot={false} connectNulls isAnimationActive={false} />
        {/* Prediction */}
        <Line dataKey="predicted" stroke="oklch(0.65 0.24 25)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
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

// CoinGecko-style adaptive time labels.
function formatTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const spanH = spanMs / 3_600_000;
  if (spanH < 6) {
    // intraday: HH:MM
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (spanH < 48) {
    // ~1-2 days: "DD HH:MM"
    return `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  }
  if (spanH < 24 * 14) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}
