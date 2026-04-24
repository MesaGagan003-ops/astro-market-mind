import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoinPicker } from "@/components/CoinPicker";
import { TimeframePicker } from "@/components/TimeframePicker";
import { PredictionChart } from "@/components/PredictionChart";
import { ModelPanels } from "@/components/ModelPanels";
import { AccuracyTracker } from "@/components/AccuracyTracker";
import { DemoTrading } from "@/components/DemoTrading";
import { NewsPanel } from "@/components/NewsPanel";
import { DataSourceInfo } from "@/components/DataSourceInfo";
import { ProviderHealthPanel, type ProviderHealthItem } from "@/components/ProviderHealthPanel";
import { TrainerPanel } from "@/components/TrainerPanel";
import { ComparisonPanel } from "@/components/ComparisonPanel";
import { FEATURED_ASSETS, type MarketAsset } from "@/lib/markets";
import { TIMEFRAMES, type Timeframe } from "@/lib/timeframes";
import {
  subscribeAsset,
  fetchAssetHistory,
  type ProviderStatusHandler,
  type Tick,
} from "@/lib/stream";
import { hybridPredict } from "@/lib/physics/hybrid";
import {
  computeAccuracy,
  recordPrediction,
  resolvePredictions,
  type AccuracyStats,
} from "@/lib/accuracy";
import { recordPredictionCloud, resolvePendingPredictions, loadWeights } from "@/lib/learning";
import type { AdaptiveWeights } from "@/lib/learning";
import { assessDataQuality, isReadyForTrading, type DataQualityScore } from "@/lib/dataQuality";
import { fetchYahooHistory } from "@/lib/yahooProxy";
import { CalibrationPanel } from "@/components/CalibrationPanel";
import { WalkForwardPanel } from "@/components/WalkForwardPanel";
import { PerformanceTable } from "@/components/PerformanceTable";
import { DisclaimerModal, DisclaimerBanner, DisclaimerFooter } from "@/components/Disclaimer";
import { TradingReadinessAlert } from "@/components/TradingReadinessAlert";
import { IndicatorOverlayPanel } from "@/components/IndicatorOverlayPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MIRO — Physics-based Market Prediction Engine" },
      {
        name: "description",
        content:
          "Live market forecasting across crypto, NSE/BSE using ARIMA, GARCH, HMM, entropy, Hurst & Hamiltonian energy with adaptive learning.",
      },
      { property: "og:title", content: "MIRO — Physics Prediction Engine" },
      {
        property: "og:description",
        content: "Hybrid physics + statistics model for live crypto prediction.",
      },
    ],
  }),
  component: PredictionEngine,
});

function PredictionEngine() {
  const [coin, setCoin] = useState<MarketAsset>(FEATURED_ASSETS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>(TIMEFRAMES[2]); // 10m default
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [stats, setStats] = useState<AccuracyStats>(() => computeAccuracy(`${coin.market}:${coin.id}`, timeframe.id));
  const [providerHealth, setProviderHealth] = useState<Record<string, ProviderHealthItem>>({});
  const [yahooTrain, setYahooTrain] = useState<number[]>([]);
  const [adaptive, setAdaptive] = useState<AdaptiveWeights | null>(null);
  const [dataQuality, setDataQuality] = useState<DataQualityScore>({ score: 0, isGappy: true, isSparse: true, isFresh: false, detail: "Initializing" });
  const [isReadyToTrade, setIsReadyToTrade] = useState(false);
  const lastRecordRef = useRef<number>(0);

  const onStatus = useMemo<ProviderStatusHandler>(() => {
    return (s) => {
      setProviderHealth((prev) => ({
        ...prev,
        [s.provider]: {
          key: s.provider,
          provider: s.provider,
          state: s.state,
          detail: s.detail,
          updatedAt: Date.now(),
        },
      }));
    };
  }, []);

  // Load history + subscribe live.
  // Long-session hardening: throttle tick → state writes to at most ~1/s, and
  // cap the in-memory tick buffer so a 5-hour session does not grow unbounded
  // re-render work or memory pressure.
  useEffect(() => {
    let cancelled = false;
    setTicks([]);
    setCurrentPrice(0);

    const init = async () => {
      let hist: Tick[] = await fetchAssetHistory(coin, 240, { onStatus });
      if (cancelled) return;
      if (hist.length > 240) {
        const step = Math.ceil(hist.length / 240);
        hist = hist.filter((_, i) => i % step === 0);
      }
      setTicks(hist);
      if (hist.length) setCurrentPrice(hist[hist.length - 1].price);
    };

    init();

    let lastFlush = 0;
    let pending: Tick | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (cancelled || !pending) return;
      const t = pending;
      pending = null;
      lastFlush = Date.now();
      setCurrentPrice(t.price);
      setTicks((prev) => {
        // Hard cap at 800; also dedupe identical consecutive timestamps.
        const last = prev[prev.length - 1];
        if (last && last.ts === t.ts && last.price === t.price) return prev;
        const next = prev.length >= 800 ? prev.slice(-799) : prev.slice();
        next.push(t);
        return next;
      });
    };

    const unsub = subscribeAsset(coin, (t) => {
      pending = t;
      const now = Date.now();
      const since = now - lastFlush;
      if (since >= 1000) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 1000 - since);
      }
    }, { onStatus });

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      unsub?.();
    };
  }, [coin, onStatus]);

  useEffect(() => {
    let cancelled = false;
    const loadYahoo = async () => {
      if (!coin.yahooSymbol) {
        setYahooTrain([]);
        return;
      }
      const rows = await fetchYahooHistory({
        data: {
          symbol: coin.yahooSymbol,
          interval: "1m",
          range: "7d",
        },
      });
      if (cancelled) return;
      setYahooTrain(rows.map((r) => r.price).slice(-300));
      onStatus({ provider: "yfinance", state: rows.length > 0 ? "live" : "failing", detail: rows.length > 0 ? "history" : "empty" });
    };
    void loadYahoo();
    const id = setInterval(loadYahoo, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [coin.yahooSymbol, onStatus]);

  useEffect(() => {
    let cancelled = false;
    setAdaptive(null);
    void loadWeights(coin.market, coin.id, timeframe.id).then((w) => {
      if (!cancelled) setAdaptive(w);
    });
    return () => {
      cancelled = true;
    };
  }, [coin.market, coin.id, timeframe.id]);

  // Build a 1-minute resampled price series for models. If the live feed is
  // sparse (e.g. CoinGecko 5s polling on a low-volume coin returns the same
  // price for many seconds), the minute-bucket series collapses to too few
  // unique points and ARIMA fits a flat line. In that case we fall back to
  // the raw tick history so the model has enough variation to work with.
  const resampled = useMemo(() => {
    if (ticks.length === 0) return [] as number[];
    const buckets = new Map<number, number>();
    for (const t of ticks) {
      const bucket = Math.floor(t.ts / 60000);
      buckets.set(bucket, t.price);
    }
    const minuteSeries = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    if (minuteSeries.length >= 30) return minuteSeries;
    // Sparse feed → use raw ticks (they still capture every observed price)
    return ticks.map((t) => t.price);
  }, [ticks]);

  const modelSeries = useMemo(() => {
    if (yahooTrain.length < 30) return resampled;
    const merged = [...yahooTrain.slice(-300), ...resampled.slice(-300)];
    return merged.slice(-500);
  }, [resampled, yahooTrain]);

  // Assess data quality from live ticks (pure compute — no setState here)
  const dataQualityMemo = useMemo(() => assessDataQuality(ticks), [ticks]);

  // Mirror it into state in an effect so children that read `dataQuality`
  // still get updates, without violating React's "no side effects in useMemo"
  // rule (which was triggering hydration mismatches on long sessions).
  useEffect(() => {
    setDataQuality(dataQualityMemo);
  }, [dataQualityMemo]);

  // Run hybrid prediction — gate on the NUMBER of distinct 1-minute buckets
  // (a stable integer) rather than on the modelSeries array reference, which
  // would change every throttled tick and re-fit GARCH/HMM/ARIMA needlessly.
  // Over a 5-hour session this prevents thousands of redundant heavy fits.
  const minuteBuckets = useMemo(() => {
    if (ticks.length === 0) return 0;
    const set = new Set<number>();
    for (const t of ticks) set.add(Math.floor(t.ts / 60000));
    return set.size;
  }, [ticks]);

  const prediction = useMemo(() => {
    if (modelSeries.length < 12) return null;
    const steps = Math.min(timeframe.minutes, 200);
    const pred = hybridPredict(modelSeries, steps, {
      adaptiveWeights: adaptive
        ? {
            arima: adaptive.arima,
            hmm: adaptive.hmm,
            entropy: adaptive.entropy,
            hurst: adaptive.hurst,
          }
        : undefined,
      dataQualityScore: dataQualityMemo.score,
    });
    return pred;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteBuckets, timeframe.id, adaptive, dataQualityMemo.score]);

  // Trading-readiness derived state — moved out of useMemo to fix SSR
  // hydration mismatch ("Model accuracy too low: X% vs 0.0%") and avoid
  // double-renders during long sessions.
  useEffect(() => {
    setIsReadyToTrade(isReadyForTrading(dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples ?? 0));
  }, [dataQualityMemo, stats.accuracy, stats.brier, adaptive?.samples]);

  // Record predictions periodically + resolve old ones (local + cloud learning)
  useEffect(() => {
    if (!prediction || currentPrice === 0) return;
    const now = Date.now();
    resolvePredictions(currentPrice, now);
    // Cloud-side resolution + adaptive weight update (fire and forget)
    void resolvePendingPredictions(coin.market, coin.id, timeframe.id, currentPrice);
    const interval = Math.max(30_000, (timeframe.minutes * 60 * 1000) / 4);
    if (now - lastRecordRef.current > interval) {
      lastRecordRef.current = now;
      // Only record predictions if data quality is acceptable (>0.4) and confidence is >0.36
      // This prevents training on noisy/sparse data that would hurt model learning
      if (dataQuality.score > 0.4 && prediction.hybridConfidence > 0.36) {
        recordPrediction({
          coinId: `${coin.market}:${coin.id}`,
          timeframeId: timeframe.id,
          startTs: now,
          resolveTs: now + timeframe.minutes * 60 * 1000,
          startPrice: currentPrice,
          predictedPrice: prediction.finalPrice,
          predictedDirection: prediction.direction,
          hybridConfidence: prediction.hybridConfidence,
        });
        // Persist to Lovable Cloud for the adaptive learning loop
        void recordPredictionCloud({
          market: coin.market,
          symbol: coin.id,
          timeframe: timeframe.id,
          spotPrice: currentPrice,
          predictedPrice: prediction.finalPrice,
          direction: prediction.direction,
          horizonSeconds: timeframe.minutes * 60,
          hybridConfidence: prediction.hybridConfidence,
          weights: prediction.weights,
          features: {
            market: coin.market,
          },
        });
        // Warm cache for adaptive weights (used by future hybrid runs)
        void loadWeights(coin.market, coin.id, timeframe.id).then(setAdaptive);
      }
    }
    setStats(computeAccuracy(`${coin.market}:${coin.id}`, timeframe.id));
  }, [prediction, currentPrice, coin.id, coin.market, timeframe, dataQuality.score]);

  const minutesPerStep = Math.max(1, timeframe.minutes / Math.min(timeframe.minutes, 200));
  const healthItems = useMemo(() => Object.values(providerHealth).sort((a, b) => a.provider.localeCompare(b.provider)), [providerHealth]);

  return (
    <div className="min-h-screen relative z-10">
      <DisclaimerModal />
      {/* Header */}
      <header className="border-b border-border backdrop-blur-md bg-background/70 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="MIRO" className="w-9 h-9 rounded-full glow-primary object-cover border border-primary/40" />
            <div>
              <h1 className="font-display font-bold text-lg leading-none text-gradient-primary">
                MIRO
              </h1>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            <CoinPicker value={coin} onChange={setCoin} />
            <div className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-md">
              <span className="live-dot" />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {coin.market === "crypto"
                  ? coin.binanceSymbol
                    ? "Binance tick"
                    : "5s poll"
                  : "Yahoo (NSE/BSE)"}
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
        <DisclaimerBanner />

        <TradingReadinessAlert
          isReady={isReadyToTrade}
          dataQualityScore={dataQuality.score}
          recentAccuracy={stats.accuracy}
          recentBrier={stats.brier}
          sampleCount={adaptive?.samples ?? 0}
        />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2">
            <DataSourceInfo />
          </div>
          <ProviderHealthPanel items={healthItems} />
        </div>

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

        {/* News + sentiment-adjusted forecast */}
        <NewsPanel
          coin={coin}
          prediction={prediction}
          currentPrice={currentPrice}
          history={ticks.map((t) => ({ ts: t.ts, price: t.price }))}
          minutesPerStep={minutesPerStep}
        />

        {/* Demo trading */}
        <DemoTrading coin={coin} currentPrice={currentPrice} prediction={prediction} />

        {/* Model panels */}
        {prediction && (
          <ModelPanels result={prediction} currentPrice={currentPrice} minutes={timeframe.minutes} />
        )}

        {/* Technical indicator overlay (visual context on actual line + features that feed the model) */}
        <IndicatorOverlayPanel history={ticks.map((t) => ({ ts: t.ts, price: t.price }))} />

        <TrainerPanel market={coin.market} symbol={coin.id} timeframe={timeframe.id} />

        {/* P0: walk-forward backtest with costs */}
        <WalkForwardPanel coin={coin} />

        {/* P0: calibration of probabilistic confidence */}
        <CalibrationPanel coin={coin} timeframe={timeframe} />

        {/* P0: cost-adjusted performance across ALL assets */}
        <PerformanceTable />

        <ComparisonPanel coin={coin} />

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

        <DisclaimerFooter />
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
