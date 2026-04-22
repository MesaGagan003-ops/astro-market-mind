// News panel + sentiment-adjusted forecast chart.
// - Fetches CryptoPanic headlines for the selected coin
// - Scores them with a small crypto lexicon + community votes
// - Renders the list below the main forecast
// - Renders a SECOND chart that shifts the hybrid forecast by a sentiment
//   tilt:  adjusted = baseline + sentiment · σ · k · stepFraction
//   so news only nudges the trend, never overwrites the wiggles.

import { useEffect, useState } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, ResponsiveContainer,
  ReferenceLine, Tooltip, CartesianGrid,
} from "recharts";
import type { MarketAsset } from "@/lib/markets";
import type { HybridResult } from "@/lib/physics/hybrid";
import { fetchCoinNews, buildSentiment, type NewsSentiment } from "@/lib/news";

interface Props {
  coin: MarketAsset;
  prediction: HybridResult | null;
  currentPrice: number;
  history: { ts: number; price: number }[];
  minutesPerStep: number;
}

export function NewsPanel({ coin, prediction, currentPrice, history, minutesPerStep }: Props) {
  const [sentiment, setSentiment] = useState<NewsSentiment | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setSentiment(null);
    const sym = (coin.symbol || "btc").toUpperCase();
    fetchCoinNews({ data: { symbol: sym } })
      .then((r) => {
        if (cancelled) return;
        setSentiment(buildSentiment(r.items));
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e?.message || e));
      })
      .finally(() => !cancelled && setLoading(false));
    // refresh every 5 minutes
    const id = setInterval(() => {
      fetchCoinNews({ data: { symbol: sym } })
        .then((r) => !cancelled && setSentiment(buildSentiment(r.items)))
        .catch(() => {});
    }, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coin.id, coin.symbol]);

  const tone =
    !sentiment ? "neutral" :
    sentiment.meanSentiment > 0.1 ? "bullish" :
    sentiment.meanSentiment < -0.1 ? "bearish" : "neutral";

  const toneColor =
    tone === "bullish" ? "var(--bull)" : tone === "bearish" ? "var(--bear)" : "var(--foreground)";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      {/* Sentiment-adjusted forecast chart */}
      <div className="panel p-4">
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-display font-semibold text-foreground">
              News-Adjusted Forecast{" "}
              <span className="text-muted-foreground">·</span>{" "}
              <span style={{ color: toneColor }}>{tone}</span>
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Hybrid baseline tilted by time-decayed news sentiment (half-life 6h)
            </p>
          </div>
          {sentiment && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Sentiment score
              </div>
              <div className="text-xl font-display font-bold" style={{ color: toneColor }}>
                {(sentiment.meanSentiment * 100).toFixed(1)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                conf {(sentiment.confidence * 100).toFixed(0)}% · {sentiment.items.length} items
              </div>
            </div>
          )}
        </div>
        {prediction && currentPrice > 0 && sentiment ? (
          <SentimentChart
            history={history.slice(-200)}
            prediction={prediction}
            currentPrice={currentPrice}
            minutesPerStep={minutesPerStep}
            sentiment={sentiment}
          />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">
            {loading ? "Fetching news…" : "Waiting for forecast + news…"}
          </div>
        )}
        <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-muted-foreground">
          <Legend c="var(--foreground)" l="Actual" />
          <Legend c="oklch(0.65 0.24 25)" l="Baseline forecast" />
          <Legend c="var(--bull)" l="News-adjusted forecast" />
        </div>
      </div>

      {/* News list */}
      <div className="panel p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-foreground">
            {coin.name} News
          </h3>
          {sentiment && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="px-1.5 py-0.5 rounded" style={{ background: "color-mix(in oklab, var(--bull) 20%, transparent)", color: "var(--bull)" }}>
                ▲ {sentiment.bullishCount}
              </span>
              <span className="px-1.5 py-0.5 rounded text-muted-foreground bg-muted/30">
                ● {sentiment.neutralCount}
              </span>
              <span className="px-1.5 py-0.5 rounded" style={{ background: "color-mix(in oklab, var(--bear) 20%, transparent)", color: "var(--bear)" }}>
                ▼ {sentiment.bearishCount}
              </span>
            </div>
          )}
        </div>
        <div className="space-y-2 overflow-y-auto max-h-[360px] pr-1">
          {loading && <div className="text-xs text-muted-foreground">Loading news…</div>}
          {err && <div className="text-xs text-destructive">News fetch failed: {err}</div>}
          {sentiment && sentiment.items.length === 0 && !loading && (
            <div className="text-xs text-muted-foreground">No recent headlines for {coin.symbol.toUpperCase()}.</div>
          )}
          {sentiment?.items.map((it) => (
            <a
              key={it.id}
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="block p-2 rounded border border-border hover:border-primary/60 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      it.sentiment > 0.15 ? "var(--bull)" :
                      it.sentiment < -0.15 ? "var(--bear)" : "var(--muted-foreground)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] leading-snug text-foreground group-hover:text-primary line-clamp-2">
                    {it.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{it.source}</span>
                    <span>·</span>
                    <span>{relTime(it.publishedAt)}</span>
                    <span className="ml-auto font-mono" style={{
                      color: it.sentiment > 0.15 ? "var(--bull)" :
                             it.sentiment < -0.15 ? "var(--bear)" : "var(--muted-foreground)",
                    }}>
                      {it.sentiment >= 0 ? "+" : ""}{(it.sentiment * 100).toFixed(0)}
                    </span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
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

function relTime(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// --- Sentiment-adjusted forecast chart ---

interface ChartProps {
  history: { ts: number; price: number }[];
  prediction: HybridResult;
  currentPrice: number;
  minutesPerStep: number;
  sentiment: NewsSentiment;
}

function SentimentChart({ history, prediction, currentPrice, minutesPerStep, sentiment }: ChartProps) {
  const histPoints = history.map((h) => ({ t: h.ts, actual: h.price }));
  const lastTs = history.length > 0 ? history[history.length - 1].ts : Date.now();
  const stepMs = minutesPerStep * 60 * 1000;
  const N = prediction.forecast.length;
  const sigma = prediction.garch.sigma || (currentPrice * 0.001);

  // Sentiment tilt magnitude — scaled by confidence so weak/contradictory news
  // doesn't move the line much. Max tilt at the horizon = ±1.2σ·√N.
  const tilt = sentiment.meanSentiment * sentiment.confidence * 1.2;

  const futurePoints = prediction.forecast.map((f, i) => {
    const frac = (i + 1) / N;
    const adjusted = f.price + tilt * sigma * Math.sqrt(i + 1);
    return {
      t: lastTs + (i + 1) * stepMs,
      predicted: f.price,
      adjusted,
    };
  });

  const bridge = { t: lastTs, actual: currentPrice, predicted: currentPrice, adjusted: currentPrice };
  const data = [...histPoints, bridge, ...futurePoints];

  const allVals = data.flatMap((d: any) => [d.actual, d.predicted, d.adjusted].filter((v) => typeof v === "number"));
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const pad = (max - min) * 0.06 || max * 0.001;
  const tStart = data[0]?.t ?? lastTs;
  const tEnd = data[data.length - 1]?.t ?? lastTs;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: 8 }}>
        <defs>
          <linearGradient id="actualFill2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="oklch(0.72 0.18 230)" stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.25} vertical={false} />
        <XAxis
          dataKey="t" type="number" scale="time"
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
          width={70} orientation="right"
        />
        <Tooltip
          contentStyle={{
            background: "oklch(0.17 0.03 265)",
            border: "1px solid oklch(0.28 0.04 265)",
            borderRadius: 8, fontSize: 12,
          }}
          labelFormatter={(v: any) => new Date(v).toLocaleString()}
          formatter={(value: any, name: any) => [typeof value === "number" ? formatPrice(value) : String(value), String(name)]}
        />
        <ReferenceLine x={lastTs} stroke="oklch(0.65 0.03 255)" strokeDasharray="2 4" strokeOpacity={0.5} label={{ value: "now", position: "top", fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
        <ReferenceLine y={currentPrice} stroke="oklch(0.72 0.18 230)" strokeDasharray="3 3" strokeOpacity={0.4} />
        <Area dataKey="actual" stroke="oklch(0.72 0.18 230)" strokeWidth={1.6} fill="url(#actualFill2)" dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="predicted" stroke="oklch(0.65 0.24 25)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="adjusted" stroke={sentiment.meanSentiment >= 0 ? "oklch(0.78 0.18 145)" : "oklch(0.65 0.24 25)"} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
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

function formatTime(ts: number, spanMs: number): string {
  const d = new Date(ts);
  const spanH = spanMs / 3_600_000;
  if (spanH < 6) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (spanH < 48) return `${d.getDate().toString().padStart(2, "0")} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  if (spanH < 24 * 14) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
}
