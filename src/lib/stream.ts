// Live tick stream.  Browser cannot call api.binance.com directly (CORS + geo-block 451)
// nor open the public WebSocket from many cloud regions, so we proxy Binance through
// a TanStack Start server function and poll at ~1s for near-tick cadence.

import { fetchBinancePrice, fetchBinanceKlines } from "./binanceProxy";

export interface Tick {
  price: number;
  ts: number;
  size?: number;
}

export type TickHandler = (tick: Tick) => void;

export function subscribeBinance(symbol: string, onTick: TickHandler): () => void {
  let stopped = false;
  let lastPrice = 0;
  const poll = async () => {
    while (!stopped) {
      try {
        const t = await fetchBinancePrice({ data: { symbol } });
        if (t.price && t.price !== lastPrice) {
          lastPrice = t.price;
          onTick(t);
        } else if (t.price) {
          // still emit periodic ticks so model recomputes
          onTick(t);
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  poll();
  return () => {
    stopped = true;
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

// Seed with historical Binance klines via the server proxy
export async function fetchBinanceHistory(
  symbol: string,
  interval = "1m",
  limit = 200,
): Promise<Tick[]> {
  try {
    return await fetchBinanceKlines({ data: { symbol, interval, limit } });
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
