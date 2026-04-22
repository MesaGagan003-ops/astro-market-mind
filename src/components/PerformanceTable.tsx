// Per (market, symbol, timeframe) cost-adjusted performance table.
// Reads recently-resolved predictions from cloud and recomputes net PnL after
// applying the round-trip cost from the user's cost model.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_COSTS, bpsToFrac, totalCostBps } from "@/lib/costs";
import type { MarketKind } from "@/lib/markets";

interface Row {
  market: string;
  symbol: string;
  timeframe: string;
  n: number;
  hitRate: number;
  avgGross: number;
  avgNet: number;
  netReturn: number;
}

interface DbRow {
  predictions: { market: string; symbol: string; timeframe: string; spot_price: number } | { market: string; symbol: string; timeframe: string; spot_price: number }[] | null;
  actual_price: number;
  direction_correct: boolean;
}

export function PerformanceTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("prediction_outcomes")
          .select(`actual_price, direction_correct,
            predictions!inner ( market, symbol, timeframe, spot_price )`)
          .order("resolved_at", { ascending: false })
          .limit(2000);
        if (cancelled) return;
        if (error || !data) { setRows([]); setLoading(false); return; }

        const grouped = new Map<string, { market: string; symbol: string; timeframe: string; rets: number[]; hits: number }>();
        for (const r of data as unknown as DbRow[]) {
          const p = Array.isArray(r.predictions) ? r.predictions[0] : r.predictions;
          if (!p) continue;
          const key = `${p.market}::${p.symbol}::${p.timeframe}`;
          const ret = (Number(r.actual_price) - Number(p.spot_price)) / Math.max(1e-9, Number(p.spot_price));
          // realized return aligned with predicted direction (signed PnL of a unit trade)
          const signed = r.direction_correct ? Math.abs(ret) : -Math.abs(ret);
          const g = grouped.get(key) ?? { market: p.market, symbol: p.symbol, timeframe: p.timeframe, rets: [], hits: 0 };
          g.rets.push(signed);
          if (r.direction_correct) g.hits++;
          grouped.set(key, g);
        }

        const out: Row[] = [];
        for (const g of grouped.values()) {
          const cost = bpsToFrac(totalCostBps(DEFAULT_COSTS[g.market as MarketKind] ?? DEFAULT_COSTS.crypto));
          const grossAvg = g.rets.reduce((a, b) => a + b, 0) / g.rets.length;
          const netAvg = grossAvg - cost;
          const netReturn = g.rets.reduce((a, b) => a + (b - cost), 0);
          out.push({
            market: g.market, symbol: g.symbol, timeframe: g.timeframe,
            n: g.rets.length, hitRate: g.hits / g.rets.length,
            avgGross: grossAvg, avgNet: netAvg, netReturn,
          });
        }
        out.sort((a, b) => b.netReturn - a.netReturn);
        setRows(out); setLoading(false);
      } catch {
        if (!cancelled) { setRows([]); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="panel p-4">
      <div className="mb-3">
        <h3 className="font-display font-semibold text-sm">Cost-Adjusted Performance · all assets</h3>
        <p className="text-[10px] text-muted-foreground">Live results from resolved predictions, with conservative round-trip costs subtracted per market.</p>
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">No resolved predictions yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-muted-foreground uppercase text-[9px]">
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-2">Market</th>
                <th className="text-left py-1.5 px-2">Symbol</th>
                <th className="text-left py-1.5 px-2">TF</th>
                <th className="text-right py-1.5 px-2">N</th>
                <th className="text-right py-1.5 px-2">Hit %</th>
                <th className="text-right py-1.5 px-2">Avg gross</th>
                <th className="text-right py-1.5 px-2">Avg net</th>
                <th className="text-right py-1.5 px-2">Σ Net</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r) => (
                <tr key={`${r.market}-${r.symbol}-${r.timeframe}`} className="border-b border-border/40">
                  <td className="py-1.5 px-2 uppercase text-muted-foreground">{r.market}</td>
                  <td className="py-1.5 px-2">{r.symbol}</td>
                  <td className="py-1.5 px-2 text-muted-foreground">{r.timeframe}</td>
                  <td className="py-1.5 px-2 text-right">{r.n}</td>
                  <td className={`py-1.5 px-2 text-right ${r.hitRate > 0.5 ? "text-bull" : "text-bear"}`}>{(r.hitRate * 100).toFixed(1)}</td>
                  <td className="py-1.5 px-2 text-right">{(r.avgGross * 100).toFixed(3)}%</td>
                  <td className={`py-1.5 px-2 text-right ${r.avgNet > 0 ? "text-bull" : "text-bear"}`}>{(r.avgNet * 100).toFixed(3)}%</td>
                  <td className={`py-1.5 px-2 text-right font-semibold ${r.netReturn > 0 ? "text-bull" : "text-bear"}`}>{(r.netReturn * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
