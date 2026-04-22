import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { fetchYahooHistory } from "@/lib/yahooProxy";
import { hybridPredict } from "@/lib/physics/hybrid";
import type { MarketAsset } from "@/lib/markets";

interface Props {
  coin: MarketAsset;
}

type RangeKey = "1h" | "1w" | "1mo" | "1y";

const RANGES: Array<{ key: RangeKey; label: string; interval: string; range: string; predictFraction: number }> = [
  { key: "1h", label: "1 hour", interval: "1m", range: "1d", predictFraction: 0.25 },
  { key: "1w", label: "1 week", interval: "15m", range: "1mo", predictFraction: 0.2 },
  { key: "1mo", label: "1 month", interval: "1h", range: "3mo", predictFraction: 0.2 },
  { key: "1y", label: "1 year", interval: "1d", range: "5y", predictFraction: 0.2 },
];

interface Row {
  ts: number;
  actual: number | null;
  predicted: number | null;
}

export function ComparisonPanel({ coin }: Props) {
  const [range, setRange] = useState<RangeKey>("1w");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!coin.yahooSymbol) {
      setRows([]);
      setError("No historical symbol available for this asset.");
      return;
    }
    setLoading(true);
    setError(null);
    const cfg = RANGES.find((r) => r.key === range)!;
    const truncate = range === "1h" ? 60 : undefined; // for 1h take last 60 points only
    void (async () => {
      try {
        const hist = await fetchYahooHistory({
          data: { symbol: coin.yahooSymbol!, interval: cfg.interval, range: cfg.range },
        });
        if (cancelled) return;
        if (!hist.length) {
          setRows([]);
          setError("No historical data returned.");
          setLoading(false);
          return;
        }
        const sliced = truncate ? hist.slice(-truncate) : hist;
        // Split into train + holdout. Train on first part, predict the holdout
        // window and compare to the actual values from the same window.
        const holdoutLen = Math.max(5, Math.floor(sliced.length * cfg.predictFraction));
        const train = sliced.slice(0, sliced.length - holdoutLen).map((r) => r.price);
        const holdout = sliced.slice(sliced.length - holdoutLen);
        if (train.length < 20) {
          setRows([]);
          setError("Not enough training data for this range.");
          setLoading(false);
          return;
        }
        const pred = hybridPredict(train, holdoutLen);
        const out: Row[] = [];
        // Plot full actual line
        for (let i = 0; i < sliced.length; i++) {
          out.push({ ts: sliced[i].ts, actual: sliced[i].price, predicted: null });
        }
        // Overlay predicted line on the holdout window
        for (let i = 0; i < holdoutLen; i++) {
          const idx = sliced.length - holdoutLen + i;
          out[idx].predicted = pred.forecast[i].price;
        }
        // Anchor predicted line to last train point so the line is continuous
        const anchorIdx = sliced.length - holdoutLen - 1;
        if (anchorIdx >= 0) out[anchorIdx].predicted = sliced[anchorIdx].price;
        setRows(out);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(String((e as Error)?.message ?? e));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coin.yahooSymbol, range]);

  const stats = useMemo(() => {
    const valid = rows.filter((r) => r.actual != null && r.predicted != null);
    if (!valid.length) return null;
    let sumAbs = 0;
    let sumPct = 0;
    let directionHits = 0;
    let directionTotal = 0;
    for (let i = 1; i < valid.length; i++) {
      const dA = (valid[i].actual ?? 0) - (valid[i - 1].actual ?? 0);
      const dP = (valid[i].predicted ?? 0) - (valid[i - 1].predicted ?? 0);
      if (Math.sign(dA) === Math.sign(dP)) directionHits++;
      directionTotal++;
      sumAbs += Math.abs((valid[i].actual ?? 0) - (valid[i].predicted ?? 0));
      sumPct += Math.abs(((valid[i].actual ?? 0) - (valid[i].predicted ?? 0)) / Math.max(1e-9, valid[i].actual ?? 1));
    }
    return {
      mae: sumAbs / valid.length,
      mape: (sumPct / valid.length) * 100,
      dirAcc: directionTotal ? (directionHits / directionTotal) * 100 : 0,
    };
  }, [rows]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-display font-semibold text-sm">Actual vs Predicted</h3>
          <p className="text-[10px] text-muted-foreground">
            Backtest: train on the first portion, forecast the last {RANGES.find((r) => r.key === range)?.predictFraction! * 100}% and compare.
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                range === r.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
          <Stat label="Direction acc." value={`${stats.dirAcc.toFixed(1)}%`} />
          <Stat label="MAPE" value={`${stats.mape.toFixed(2)}%`} />
          <Stat label="MAE" value={stats.mae < 1 ? stats.mae.toExponential(2) : stats.mae.toFixed(2)} />
        </div>
      )}

      <div className="h-[280px]">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            <div className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
            Loading historical data…
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-xs text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No data.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.3} />
              <XAxis
                dataKey="ts"
                tickFormatter={(v) => {
                  const d = new Date(v);
                  if (range === "1h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                  if (range === "1w") return d.toLocaleDateString([], { month: "short", day: "numeric" });
                  if (range === "1mo") return d.toLocaleDateString([], { month: "short", day: "numeric" });
                  return d.toLocaleDateString([], { month: "short", year: "2-digit" });
                }}
                tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }}
                width={56}
                tickFormatter={(v) => (v < 1 ? Number(v).toExponential(1) : Number(v).toFixed(2))}
              />
              <Tooltip
                labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                formatter={(value) => {
                  const n = Number(value);
                  if (!Number.isFinite(n)) return "—";
                  return n < 1 ? n.toExponential(3) : n.toFixed(4);
                }}
                contentStyle={{ background: "oklch(0.18 0.04 265)", border: "1px solid oklch(0.28 0.04 265)", fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--bull)" dot={false} strokeWidth={1.6} />
              <Line type="monotone" dataKey="predicted" name="Predicted" stroke="var(--quantum)" dot={false} strokeWidth={1.6} strokeDasharray="4 3" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-muted-foreground text-[10px] uppercase">{label}</div>
      <div className="text-foreground font-semibold font-mono">{value}</div>
    </div>
  );
}
