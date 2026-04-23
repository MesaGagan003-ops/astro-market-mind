// Visual indicator overlay on the ACTUAL price line only.
// Predicted line stays clean (it carries its own GARCH band + QSL cone).
// MA, MACD histogram, SuperTrend and VWAP are decorative trader context;
// VWAP-z and EMA-slope are ALSO fed into the model as features (see
// src/lib/physics/indicators.ts → extractFeatures()).

import { useMemo } from "react";
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, ResponsiveContainer,
  Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { sma, ema, macd, vwapProxy, superTrend, extractFeatures } from "@/lib/physics/indicators";

interface Props {
  history: { ts: number; price: number }[];
}

export function IndicatorOverlayPanel({ history }: Props) {
  const data = useMemo(() => {
    if (history.length < 30) return null;
    const prices = history.map((h) => h.price);
    const ma20 = sma(prices, 20);
    const ma50 = sma(prices, 50);
    const ema12 = ema(prices, 12);
    const ema26 = ema(prices, 26);
    const m = macd(prices);
    const vw = vwapProxy(prices, Math.min(60, prices.length));
    const st = superTrend(prices, 10, 3);
    const features = extractFeatures(prices);
    const rows = history.map((h, i) => ({
      t: h.ts,
      price: h.price,
      ma20: ma20[i],
      ma50: ma50[i],
      ema12: ema12[i],
      ema26: ema26[i],
      macd: m.macd[i],
      macdSignal: m.signal[i],
      macdHist: m.hist[i],
      vwap: vw.vwap[i],
      vwapU: vw.upper[i],
      vwapL: vw.lower[i],
      st: st.line[i],
      stDir: st.dir[i],
    }));
    return { rows, features };
  }, [history]);

  if (!data) {
    return (
      <div className="panel p-4">
        <h3 className="font-display font-semibold text-foreground mb-1">
          Technical indicator overlay
        </h3>
        <p className="text-xs text-muted-foreground">
          Streaming more data… (need ≥ 30 bars)
        </p>
      </div>
    );
  }

  const { rows, features } = data;
  const allPrices = rows.flatMap((r) =>
    [r.price, r.ma20, r.ma50, r.vwapU, r.vwapL, r.st].filter(
      (v): v is number => typeof v === "number",
    ),
  );
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const pad = (max - min) * 0.05 || max * 0.001;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-display font-semibold text-foreground">
            Technical indicator overlay
            <span className="text-muted-foreground font-normal text-xs ml-2">
              · actual line only
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            MA / MACD / SuperTrend / VWAP for context. VWAP-z & EMA-slope feed the hybrid model.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] flex-wrap">
          <FeatureChip label="VWAP-z" value={features.vwapZ.toFixed(2)} good={Math.abs(features.vwapZ) < 1.5} />
          <FeatureChip label="EMA-slope (fast)" value={(features.emaSlopeFast * 1e4).toFixed(2) + "‱"} good={features.emaSlopeFast >= 0} />
          <FeatureChip label="MACD hist" value={features.macdHist.toFixed(4)} good={features.macdHist >= 0} />
          <FeatureChip label="Bias → model" value={(features.bias * 100).toFixed(0) + "%"} good={features.bias >= 0} />
        </div>
      </div>

      {/* Price + MA + VWAP + SuperTrend */}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="oklch(0.28 0.04 80)" strokeOpacity={0.18} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fill: "oklch(0.65 0.03 85)", fontSize: 10 }}
            stroke="oklch(0.28 0.04 80)"
            width={66}
            orientation="right"
            tickFormatter={(v) => formatPrice(v)}
          />
          <Tooltip
            contentStyle={{ background: "oklch(0.14 0.02 80)", border: "1px solid oklch(0.28 0.04 80)", borderRadius: 8, fontSize: 11 }}
            labelFormatter={(v: number) => new Date(v).toLocaleString()}
            formatter={(value: number, name: string) => [typeof value === "number" ? formatPrice(value) : String(value), name]}
          />
          {/* VWAP band */}
          <Area dataKey="vwapU" stroke="oklch(0.72 0.18 280)" strokeWidth={0.6} strokeDasharray="2 4" fill="oklch(0.72 0.18 280)" fillOpacity={0.06} connectNulls isAnimationActive={false} />
          <Area dataKey="vwapL" stroke="oklch(0.72 0.18 280)" strokeWidth={0.6} strokeDasharray="2 4" fill="transparent" connectNulls isAnimationActive={false} />
          {/* MAs */}
          <Line dataKey="ma20" stroke="oklch(0.78 0.18 130)" strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="ma50" stroke="oklch(0.75 0.18 60)" strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          {/* VWAP */}
          <Line dataKey="vwap" stroke="oklch(0.78 0.20 305)" strokeWidth={1.2} strokeDasharray="3 3" dot={false} connectNulls isAnimationActive={false} />
          {/* SuperTrend */}
          <Line dataKey="st" stroke="oklch(0.80 0.22 25)" strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          {/* Actual price on top */}
          <Line dataKey="price" stroke="oklch(0.85 0.16 85)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* MACD subchart */}
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={rows} margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="oklch(0.28 0.04 80)" strokeOpacity={0.18} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} hide />
          <YAxis tick={{ fill: "oklch(0.65 0.03 85)", fontSize: 10 }} stroke="oklch(0.28 0.04 80)" width={66} orientation="right" />
          <ReferenceLine y={0} stroke="oklch(0.45 0.03 80)" strokeOpacity={0.6} />
          <Tooltip
            contentStyle={{ background: "oklch(0.14 0.02 80)", border: "1px solid oklch(0.28 0.04 80)", borderRadius: 8, fontSize: 11 }}
            labelFormatter={(v: number) => new Date(v).toLocaleString()}
          />
          <Bar dataKey="macdHist" fill="oklch(0.78 0.20 305)" fillOpacity={0.55} isAnimationActive={false} />
          <Line dataKey="macd" stroke="oklch(0.85 0.16 85)" strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
          <Line dataKey="macdSignal" stroke="oklch(0.65 0.24 25)" strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <Legend c="oklch(0.85 0.16 85)" l="Price (actual)" />
        <Legend c="oklch(0.78 0.18 130)" l="MA(20)" />
        <Legend c="oklch(0.75 0.18 60)" l="MA(50)" />
        <Legend c="oklch(0.78 0.20 305)" l="VWAP + ±2σ band" />
        <Legend c="oklch(0.80 0.22 25)" l="SuperTrend(10, 3)" />
        <Legend c="oklch(0.65 0.24 25)" l="MACD signal" />
      </div>
    </div>
  );
}

function FeatureChip({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border bg-card">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold" style={{ color: good ? "var(--bull)" : "var(--bear)" }}>{value}</span>
    </div>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-0.5" style={{ background: c }} />
      {l}
    </div>
  );
}

function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}
