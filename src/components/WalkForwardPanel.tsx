import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { fetchYahooHistory } from "@/lib/yahooProxy";
import { walkForwardBacktest, type BacktestResult } from "@/lib/backtest";
import { DEFAULT_COSTS, type CostModel } from "@/lib/costs";
import type { MarketAsset } from "@/lib/markets";

interface Props {
  coin: MarketAsset;
}

type RangeKey = "1w" | "1mo" | "3mo" | "1y";
const RANGES: Array<{ key: RangeKey; label: string; interval: string; range: string; horizon: number }> = [
  { key: "1w",  label: "1 week",   interval: "15m", range: "1mo", horizon: 4 },
  { key: "1mo", label: "1 month",  interval: "1h",  range: "3mo", horizon: 6 },
  { key: "3mo", label: "3 months", interval: "1d",  range: "1y",  horizon: 5 },
  { key: "1y",  label: "1 year",   interval: "1d",  range: "5y",  horizon: 10 },
];

export function WalkForwardPanel({ coin }: Props) {
  const [range, setRange] = useState<RangeKey>("1mo");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostModel>(() => DEFAULT_COSTS[coin.market]);

  useEffect(() => { setCost(DEFAULT_COSTS[coin.market]); }, [coin.market]);

  useEffect(() => {
    let cancelled = false;
    if (!coin.yahooSymbol) { setError("No historical symbol for this asset."); setResult(null); return; }
    const cfg = RANGES.find((r) => r.key === range)!;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const hist = await fetchYahooHistory({ data: { symbol: coin.yahooSymbol!, interval: cfg.interval, range: cfg.range } });
        if (cancelled) return;
        if (hist.length < 100) { setError("Not enough history for a walk-forward backtest."); setResult(null); setLoading(false); return; }
        const r = walkForwardBacktest(hist, { horizon: cfg.horizon, cost, threshold: 0.0008, step: cfg.horizon, minTrain: 80 });
        if (cancelled) return;
        setResult(r); setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e)); setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [coin.yahooSymbol, range, cost.feesBps, cost.slippageBps, coin.market]); // eslint-disable-line react-hooks/exhaustive-deps

  const chartData = useMemo(() => result?.equityCurve ?? [], [result]);
  const m = result?.metrics;

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm">Walk-Forward Backtest (cost-adjusted)</h3>
          <p className="text-[10px] text-muted-foreground">
            Expanding-window, no look-ahead. Trades sized to ±100% notional per signal · costs applied per round-trip.
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${range === r.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <NumField label="Fees (bps round-trip)" value={cost.feesBps} onChange={(v) => setCost((c) => ({ ...c, feesBps: v }))} />
        <NumField label="Slippage (bps round-trip)" value={cost.slippageBps} onChange={(v) => setCost((c) => ({ ...c, slippageBps: v }))} />
      </div>

      {loading ? (
        <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
          <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
          Running walk-forward…
        </div>
      ) : error ? (
        <div className="h-[100px] flex items-center justify-center text-xs text-destructive">{error}</div>
      ) : !result ? null : (
        <>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.3} />
                <XAxis dataKey="ts" tickFormatter={(v) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" })} tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} tickFormatter={(v) => `${((v - 1) * 100).toFixed(1)}%`} width={56} />
                <Tooltip labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  formatter={(v: number) => `${((v - 1) * 100).toFixed(2)}%`}
                  contentStyle={{ background: "oklch(0.18 0.04 265)", border: "1px solid oklch(0.28 0.04 265)", fontSize: 11 }} />
                <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="equity" stroke="var(--quantum)" strokeWidth={1.6} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {m && (
            <div className="grid grid-cols-4 gap-2 mt-3 text-[10px]">
              <Stat label="Net return" value={`${(m.netReturn * 100).toFixed(2)}%`} good={m.netReturn > 0} />
              <Stat label="Trades" value={String(m.nTrades)} />
              <Stat label="Hit rate" value={`${(m.hitRate * 100).toFixed(1)}%`} good={m.hitRate > 0.5} />
              <Stat label="Sharpe" value={m.sharpe.toFixed(2)} good={m.sharpe > 1} />
              <Stat label="Sortino" value={m.sortino.toFixed(2)} good={m.sortino > 1} />
              <Stat label="Max DD" value={`${(m.maxDrawdown * 100).toFixed(2)}%`} good={m.maxDrawdown < 0.1} />
              <Stat label="Calmar" value={m.calmar.toFixed(2)} good={m.calmar > 0.5} />
              <Stat label="Direction acc." value={`${(m.directionalAccuracy * 100).toFixed(1)}%`} good={m.directionalAccuracy > 0.52} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-[10px] text-muted-foreground uppercase mb-0.5">{label}</div>
      <input type="number" min={0} step={0.5} value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="w-full bg-card border border-border rounded px-2 py-1 text-xs font-mono" />
    </label>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const color = good === undefined ? "text-foreground" : good ? "text-bull" : "text-bear";
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-muted-foreground uppercase">{label}</div>
      <div className={`font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}
