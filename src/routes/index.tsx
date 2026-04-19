import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoinPicker } from "@/components/CoinPicker";
import { TimeframePicker } from "@/components/TimeframePicker";
import { PredictionChart } from "@/components/PredictionChart";
import { ModelPanels } from "@/components/ModelPanels";
import { AccuracyTracker } from "@/components/AccuracyTracker";
import { DemoTrading } from "@/components/DemoTrading";
import { FEATURED_COINS, type Coin } from "@/lib/coins";
import { TIMEFRAMES, type Timeframe } from "@/lib/timeframes";
import {
  subscribeBinance,
  subscribeCoinGecko,
  fetchBinanceHistory,
  fetchCoinGeckoHistory,
  type Tick,
} from "@/lib/stream";
import { hybridPredict } from "@/lib/physics/hybrid";
import {
  computeAccuracy,
  recordPrediction,
  resolvePredictions,
  type AccuracyStats,
} from "@/lib/accuracy";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "QuantumEdge — Physics-based Crypto Prediction Engine" },
      {
        name: "description",
        content:
          "Live crypto forecasting using ARIMA(1,1,1), GARCH(1,1), HMM, Shannon entropy, and Quantum + Stochastic Speed Limits.",
      },
      { property: "og:title", content: "QuantumEdge — Physics Prediction Engine" },
      {
        property: "og:description",
        content: "Hybrid physics + statistics model for live crypto prediction.",
      },
    ],
  }),
  component: PredictionEngine,
});

function PredictionEngine() {
  const [coin, setCoin] = useState<Coin>(FEATURED_COINS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[2]); // 10m default
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [stats, setStats] = useState<AccuracyStats>(() => computeAccuracy(coin.id, timeframe.id));
  const lastRecordRef = useRef<number>(0);

  // Load history + subscribe live
  useEffect(() => {
    let cancelled = false;
    setTicks([]);
    setCurrentPrice(0);

    const init = async () => {
      let hist: Tick[] = [];
      if (coin.binanceSymbol) {
        hist = await fetchBinanceHistory(coin.binanceSymbol, "1m", 240);
      } else {
        hist = await fetchCoinGeckoHistory(coin.id, 1);
      }
      if (cancelled) return;
      // downsample if too many
      if (hist.length > 240) {
        const step = Math.ceil(hist.length / 240);
        hist = hist.filter((_, i) => i % step === 0);
      }
      setTicks(hist);
      if (hist.length) setCurrentPrice(hist[hist.length - 1].price);
    };

    init();

    let unsub: (() => void) | null = null;
    if (coin.binanceSymbol) {
      unsub = subscribeBinance(coin.binanceSymbol, (t) => {
        setCurrentPrice(t.price);
        setTicks((prev) => {
          const next = [...prev, t];
          // cap memory
          if (next.length > 800) next.splice(0, next.length - 800);
          return next;
        });
      });
    } else {
      unsub = subscribeCoinGecko(coin.id, (t) => {
        setCurrentPrice(t.price);
        setTicks((prev) => [...prev.slice(-799), t]);
      });
    }

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [coin]);

  // Build a 1-minute resampled price series for models
  const resampled = useMemo(() => {
    if (ticks.length === 0) return [] as number[];
    // Bucket ticks by minute, take last price per bucket
    const buckets = new Map<number, number>();
    for (const t of ticks) {
      const bucket = Math.floor(t.ts / 60000);
      buckets.set(bucket, t.price);
    }
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  }, [ticks]);

  // Run hybrid prediction
  const prediction = useMemo(() => {
    if (resampled.length < 12 || currentPrice === 0) return null;
    // steps = horizon in minutes, capped to keep math stable
    const steps = Math.min(timeframe.minutes, 200);
    return hybridPredict(resampled, steps);
  }, [resampled, timeframe, currentPrice]);

  // Record predictions periodically + resolve old ones
  useEffect(() => {
    if (!prediction || currentPrice === 0) return;
    const now = Date.now();
    // Re-resolve past predictions every tick
    resolvePredictions(currentPrice, now);
    // Record a fresh prediction at most once per (timeframe length / 4), min 30s
    const interval = Math.max(30_000, (timeframe.minutes * 60 * 1000) / 4);
    if (now - lastRecordRef.current > interval) {
      lastRecordRef.current = now;
      recordPrediction({
        coinId: coin.id,
        timeframeId: timeframe.id,
        startTs: now,
        resolveTs: now + timeframe.minutes * 60 * 1000,
        startPrice: currentPrice,
        predictedPrice: prediction.finalPrice,
        predictedDirection: prediction.direction,
        hybridConfidence: prediction.hybridConfidence,
      });
    }
    setStats(computeAccuracy(coin.id, timeframe.id));
  }, [prediction, currentPrice, coin.id, timeframe]);

  const minutesPerStep = Math.max(1, timeframe.minutes / Math.min(timeframe.minutes, 200));

  return (
    <div className="min-h-screen relative z-10">
      {/* Header */}
      <header className="border-b border-border backdrop-blur-md bg-background/70 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-primary to-accent glow-primary flex items-center justify-center font-display font-bold text-primary-foreground">
              Q
            </div>
            <div>
              <h1 className="font-display font-bold text-lg leading-none text-gradient-primary">
                QuantumEdge
              </h1>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">
                physics-based prediction engine
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <CoinPicker value={coin} onChange={setCoin} />
            <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-md">
              <span className="live-dot" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {coin.binanceSymbol ? "Binance tick" : "5s poll"}
              </span>
              <span className="font-mono font-bold text-foreground">
                {currentPrice > 0 ? `$${formatLive(currentPrice)}` : "—"}
              </span>
            </div>
          </div>
        </div>
        <div className="max-w-[1600px] mx-auto px-4 pb-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Predict horizon →
          </span>
          <TimeframePicker value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        {/* Top: chart + accuracy */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
          <div className="panel p-4 scan-line">
            <div className="flex items-baseline justify-between mb-3">
              <div>
                <h2 className="font-display font-semibold text-foreground">
                  {coin.name} <span className="text-muted-foreground">·</span>{" "}
                  <span className="text-primary">{timeframe.label} forecast</span>
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Hybrid path = ARIMA(1,1,1) recursion + HMM regime drift, entropy-damped & QSL-clipped
                </p>
              </div>
              {prediction && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Final {timeframe.label}
                  </div>
                  <div
                    className="text-xl font-display font-bold"
                    style={{
                      color:
                        prediction.direction === "up"
                          ? "var(--bull)"
                          : prediction.direction === "down"
                            ? "var(--bear)"
                            : "var(--foreground)",
                    }}
                  >
                    ${formatLive(prediction.finalPrice)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Δ {((prediction.finalPrice - currentPrice) / currentPrice * 100).toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
            {prediction && currentPrice > 0 ? (
              <PredictionChart
                history={ticks.slice(-200).map((t) => ({ ts: t.ts, price: t.price }))}
                prediction={prediction}
                currentPrice={currentPrice}
                minutesPerStep={minutesPerStep}
              />
            ) : (
              <div className="h-[420px] flex items-center justify-center text-muted-foreground text-sm">
                <div className="text-center">
                  <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                  <div>Streaming ticks & fitting models…</div>
                </div>
              </div>
            )}
            <ChartLegend />
          </div>

          {prediction ? (
            <AccuracyTracker
              stats={stats}
              currentDirection={prediction.direction}
              confidence={prediction.hybridConfidence}
            />
          ) : (
            <div className="panel p-4 text-sm text-muted-foreground">Awaiting first prediction…</div>
          )}
        </div>

        {/* Demo trading */}
        <DemoTrading coin={coin} currentPrice={currentPrice} prediction={prediction} />

        {/* Model panels */}
        {prediction && (
          <ModelPanels result={prediction} currentPrice={currentPrice} minutes={timeframe.minutes} />
        )}

        {/* Footer note */}
        <div className="panel p-4 text-[11px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">How the models cooperate:</strong> ARIMA(1,1,1) is
          fit by SSE-minimising (φ, θ) on differenced prices and produces a recursive,
          shock-driven forecast — the wiggles you see come from sampled εₜ ~ N(0, σ_resid).
          The <span style={{ color: "var(--hmm)" }}>HMM</span> Forward+Viterbi pass adds a regime
          drift bias proportional to (P(bull) − P(bear))·σ. <span style={{ color: "var(--entropy)" }}>Shannon
          entropy</span> dampens the deviation from spot — high H means noise dominates so the
          path is pulled back. <span style={{ color: "var(--garch)" }}>GARCH(1,1)</span> sets the
          σ-band width per step. Finally the <span style={{ color: "var(--qsl)" }}>Quantum Speed
          Limit</span> hard-clips the path to ±2.4σ·√N (Mandelstam–Tamm) and the
          <span style={{ color: "var(--ssl)" }}> Stochastic Speed Limit</span> draws the Itô 95%
          envelope (μT ± 1.96σ√T). Directional accuracy is tracked locally.
        </div>
      </main>
    </div>
  );
}

function ChartLegend() {
  const items = [
    { c: "var(--foreground)", l: "Actual" },
    { c: "var(--bear)", l: "Hybrid forecast" },
    { c: "var(--garch)", l: "GARCH 1σ" },
    { c: "var(--qsl)", l: "QSL bound" },
    { c: "var(--ssl)", l: "SSL 95% bound" },
  ];
  return (
    <div className="flex flex-wrap gap-3 mt-2 text-[10px] text-muted-foreground">
      {items.map((i) => (
        <div key={i.l} className="flex items-center gap-1.5">
          <span className="w-3 h-0.5" style={{ background: i.c }} />
          {i.l}
        </div>
      ))}
    </div>
  );
}

function formatLive(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(3);
  if (v >= 0.01) return v.toFixed(5);
  return v.toExponential(3);
}
