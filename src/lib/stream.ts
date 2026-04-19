// Live tick stream.  Two paths:
//   1) Binance WebSocket trade stream — true tick-by-tick.
//   2) CoinGecko REST polling fallback (~5s cadence) for coins without a
//      Binance USDT pair.
// Returns a teardown function.

export interface Tick {
  price: number;
  ts: number;
  size?: number;
}

export type TickHandler = (tick: Tick) => void;

export function subscribeBinance(symbol: string, onTick: TickHandler): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const connect = () => {
    if (closed) return;
    const url = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg && msg.p) {
          onTick({ price: parseFloat(msg.p), ts: msg.T ?? Date.now(), size: parseFloat(msg.q) });
        }
      } catch {}
    };
    ws.onclose = () => {
      if (closed) return;
      retry++;
      setTimeout(connect, Math.min(8000, 500 * retry));
    };
    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}

export function subscribeCoinGecko(coinId: string, onTick: TickHandler): () => void {
  let stopped = false;
  const poll = async () => {
    while (!stopped) {
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_last_updated_at=true`,
        );
        const data = await res.json();
        const entry = data[coinId];
        if (entry?.usd) {
          onTick({ price: entry.usd, ts: (entry.last_updated_at ?? Date.now() / 1000) * 1000 });
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 5000));
    }
  };
  poll();
  return () => {
    stopped = true;
  };
}

// Seed with historical Binance klines for instant chart context
export async function fetchBinanceHistory(
  symbol: string,
  interval = "1m",
  limit = 200,
): Promise<Tick[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`,
    );
    const data = (await res.json()) as Array<unknown[]>;
    return data.map((k) => ({ ts: k[0] as number, price: parseFloat(k[4] as string) }));
  } catch {
    return [];
  }
}

export async function fetchCoinGeckoHistory(coinId: string, days = 1): Promise<Tick[]> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
    );
    const data = await res.json();
    const prices = (data.prices ?? []) as Array<[number, number]>;
    return prices.map(([ts, price]) => ({ ts, price }));
  } catch {
    return [];
  }
}
