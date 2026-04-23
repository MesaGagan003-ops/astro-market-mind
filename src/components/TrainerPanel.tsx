import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { MarketKind } from "@/lib/markets";

interface Props {
  market: MarketKind;
  symbol: string;
  timeframe: string;
}

interface TrainerPoint {
  t: number;
  arima: number;
  hmm: number;
  entropy: number;
}

export function TrainerPanel({ market, symbol, timeframe }: Props) {
  const [pts, setPts] = useState<TrainerPoint[]>([]);
  const [acc, setAcc] = useState<number>(0);
  const [brier, setBrier] = useState<number>(0);

  useEffect(() => {
    let stop = false;

    const load = async () => {
      const { data: mw } = await supabase
        .from("model_weights")
        .select("recent_accuracy,recent_brier")
        .eq("market", market)
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .maybeSingle();
      if (!stop && mw) {
        setAcc(Number(mw.recent_accuracy ?? 0));
        setBrier(Number(mw.recent_brier ?? 0));
      }

      const { data: p } = await supabase
        .from("predictions")
        .select("created_at,weights")
        .eq("market", market)
        .eq("symbol", symbol)
        .eq("timeframe", timeframe)
        .order("created_at", { ascending: true })
        .limit(60);
      if (!stop && p) {
        const arr = p.map((x) => {
          const w = (x.weights ?? {}) as Record<string, unknown>;
          return {
            t: new Date(x.created_at).getTime(),
            arima: Number(w.arima ?? 0),
            hmm: Number(w.hmm ?? 0),
            entropy: Number(w.entropy ?? 0),
          };
        });
        setPts(arr);
      }
    };

    void load();
    const id = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [market, symbol, timeframe]);

  const drift = useMemo(() => {
    if (pts.length < 2) return 0;
    const first = pts[Math.max(0, pts.length - 10)];
    const last = pts[pts.length - 1];
    return (last.arima + last.hmm + last.entropy) - (first.arima + first.hmm + first.entropy);
  }, [pts]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-semibold text-sm">Adaptive Trainer Panel</h3>
        <span className="text-[10px] text-muted-foreground uppercase">{market} · {symbol} · {timeframe}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
        <Stat label="Recent accuracy" value={`${(acc * 100).toFixed(1)}%`} />
        <Stat label="Recent Brier" value={brier.toFixed(3)} />
        <Stat label="Learning drift" value={drift.toFixed(3)} />
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={pts} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="oklch(0.28 0.04 265)" strokeOpacity={0.3} />
            <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })} tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} />
            <YAxis tick={{ fill: "oklch(0.65 0.03 255)", fontSize: 10 }} width={36} />
            <Tooltip labelFormatter={(v) => new Date(Number(v)).toLocaleString()} />
            <Line type="monotone" dataKey="arima" stroke="var(--arima)" dot={false} strokeWidth={1.6} />
            <Line type="monotone" dataKey="hmm" stroke="var(--hmm)" dot={false} strokeWidth={1.6} />
            <Line type="monotone" dataKey="entropy" stroke="var(--entropy)" dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">
        Tracks evolving ARIMA/HMM/entropy weights and learning drift in the physics hybrid model.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-muted-foreground text-[10px] uppercase">{label}</div>
      <div className="text-foreground font-semibold">{value}</div>
    </div>
  );
}
