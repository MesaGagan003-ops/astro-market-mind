export interface ProviderHealthItem {
  key: string;
  provider: string;
  state: "live" | "fallback" | "failing" | "idle";
  detail?: string;
  updatedAt?: number;
}

interface Props {
  items: ProviderHealthItem[];
}

export function ProviderHealthPanel({ items }: Props) {
  const rows = items.length > 0 ? items : [{ key: "none", provider: "No providers yet", state: "idle" as const }];
  return (
    <div className="panel p-4">
      <h3 className="font-display font-semibold text-sm mb-2">Provider Health</h3>
      <div className="space-y-2 text-xs">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 border border-border rounded px-2 py-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: tone(r.state) }} />
            <span className="text-foreground font-medium">{r.provider}</span>
            <span className="ml-auto text-muted-foreground uppercase">{r.state}</span>
            {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function tone(s: ProviderHealthItem["state"]) {
  if (s === "live") return "var(--bull)";
  if (s === "fallback") return "var(--entropy)";
  if (s === "failing") return "var(--bear)";
  return "var(--muted-foreground)";
}
