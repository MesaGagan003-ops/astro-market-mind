import type { AccuracyStats } from "@/lib/accuracy";

interface Props {
  stats: AccuracyStats;
  currentDirection: "up" | "down" | "flat";
  confidence: number;
}

export function AccuracyTracker({ stats, currentDirection, confidence }: Props) {
  const pct = stats.rate * 100;
  const tone = stats.rate >= 0.6 ? "var(--bull)" : stats.rate >= 0.45 ? "var(--entropy)" : "var(--bear)";
  return (
    <div className="panel p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display font-semibold text-sm">Directional Accuracy</h3>
        <span className="text-[10px] text-muted-foreground">past predictions on this coin / timeframe</span>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Hit rate</div>
          <div className="text-2xl font-display font-bold" style={{ color: tone }}>
            {stats.resolved > 0 ? `${pct.toFixed(0)}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">{stats.correct}/{stats.resolved} resolved</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Current call</div>
          <div className="text-2xl font-display font-bold flex items-center gap-1" style={{
            color: currentDirection === "up" ? "var(--bull)" : currentDirection === "down" ? "var(--bear)" : "var(--muted-foreground)",
          }}>
            {currentDirection === "up" ? "▲ UP" : currentDirection === "down" ? "▼ DOWN" : "→ FLAT"}
          </div>
          <div className="text-[10px] text-muted-foreground">live signal</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Confidence</div>
          <div className="text-2xl font-display font-bold text-foreground">{(confidence * 100).toFixed(0)}%</div>
          <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${confidence * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="flex gap-1 flex-wrap">
        {stats.lastN.length === 0 ? (
          <div className="text-xs text-muted-foreground">No resolved predictions yet — make a call and wait the full timeframe.</div>
        ) : (
          stats.lastN.map((p) => (
            <span
              key={p.id}
              title={p.correct ? "Correct" : "Wrong"}
              className="w-3 h-3 rounded-sm"
              style={{ background: p.correct ? "var(--bull)" : "var(--bear)" }}
            />
          ))
        )}
      </div>
    </div>
  );
}
