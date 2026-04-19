import { useEffect, useMemo, useRef, useState } from "react";
import { loadAllCoins, FEATURED_COINS, type Coin } from "@/lib/coins";

interface Props {
  value: Coin;
  onChange: (coin: Coin) => void;
}

export function CoinPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coins, setCoins] = useState<Coin[]>(FEATURED_COINS);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAllCoins().then((all) => {
      setCoins(all);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return coins.slice(0, 80);
    const q = query.toLowerCase();
    return coins
      .filter((c) => c.symbol.includes(q) || c.name.toLowerCase().includes(q) || c.id.includes(q))
      .slice(0, 80);
  }, [coins, query]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-md hover:border-primary transition-colors min-w-[180px]"
      >
        <span className="font-display font-semibold text-foreground">
          {value.symbol.toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground truncate">{value.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 panel z-50 max-h-[420px] overflow-hidden flex flex-col w-[320px]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={loaded ? `Search ${coins.length.toLocaleString()} coins…` : "Loading coin list…"}
            className="w-full px-3 py-2 bg-input border-b border-border text-sm outline-none focus:border-primary"
          />
          <div className="overflow-y-auto flex-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => { onChange(c); setOpen(false); setQuery(""); }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary text-left text-sm border-b border-border/40"
              >
                <span className="font-mono font-semibold w-16 text-foreground">{c.symbol.toUpperCase()}</span>
                <span className="text-muted-foreground truncate flex-1">{c.name}</span>
                {c.binanceSymbol ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bull/15 text-bull">TICK</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">5s</span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">No coins match "{query}"</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
