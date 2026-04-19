import { TIMEFRAMES, type Timeframe } from "@/lib/timeframes";

interface Props {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export function TimeframePicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-1 flex-wrap">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.id}
          onClick={() => onChange(tf)}
          className={`px-3 py-1.5 text-xs font-mono rounded-md border transition-all ${
            value.id === tf.id
              ? "bg-primary text-primary-foreground border-primary glow-primary"
              : "bg-card border-border text-muted-foreground hover:border-primary hover:text-foreground"
          }`}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
