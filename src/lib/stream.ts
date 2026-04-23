// Live tick stream.  Browser cannot call api.binance.com directly (CORS + geo-block 451)
// nor open the public WebSocket from many cloud regions, so we proxy Binance through
// a TanStack Start server function and poll at ~1s for near-tick cadence.

import { fetchBinancePrice, fetchBinanceKlines } from "./binanceProxy";
import { fetchForexHistory, fetchForexPrice } from "./forexProxy";
import { fetchYahooHistory } from "./yahooProxy";
import type { MarketAsset } from "./markets";
import type { RuntimeConfig } from "./runtimeConfig";

export interface Tick {
  price: number;
  ts: number;
  size?: number;
}

export type TickHandler = (tick: Tick) => void;
export type ProviderState = "live" | "fallback" | "failing";
export type ProviderStatusHandler = (status: { provider: string; state: ProviderState; detail?: string }) => void;

interface StreamOptions {
  runtimeConfig?: RuntimeConfig;
  onStatus?: ProviderStatusHandler;
}

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

// Yahoo Finance polling for assets (free, delayed data).
// Primary data source for NSE/BSE indices and stocks.
function subscribeYahoo(symbol: string, onTick: TickHandler): () => void {
  let stopped = false;
  let lastTs = 0;
  const poll = async () => {
    while (!stopped) {
      try {
        const rows = await fetchYahooHistory({
          data: { symbol, interval: "1m", range: "1d" },
        });
        const last = rows[rows.length - 1];
        if (last && last.ts !== lastTs) {
          lastTs = last.ts;
          onTick({ ts: Date.now(), price: last.price });
        } else if (last) {
          onTick({ ts: Date.now(), price: last.price });
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

export function subscribeAsset(asset: MarketAsset, onTick: TickHandler, opts?: StreamOptions): () => void {
  if (asset.market === "crypto") {
    opts?.onStatus?.({ provider: asset.binanceSymbol ? "binance" : "coingecko", state: "live" });
    if (asset.binanceSymbol) return subscribeBinance(asset.binanceSymbol, onTick);
    return subscribeCoinGecko(asset.id, onTick);
  }

  if (asset.market === "forex") {
    const base = asset.forexBase ?? "EUR";
    const quote = asset.forexQuote ?? "USD";
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const t = await fetchForexPrice({ data: { base, quote, mode: "free", premiumApiKey: "" } });
          if (t.price > 0) {
            onTick(t);
            opts?.onStatus?.({ provider: `forex:${(t as { provider?: string }).provider ?? "frankfurter"}`, state: "live" });
          }
        } catch (e) {
          opts?.onStatus?.({ provider: "forex", state: "failing", detail: String((e as Error)?.message ?? e) });
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }

  // NSE/BSE: Use Yahoo Finance (free, delayed ticks)
  if (asset.market === "nse" || asset.market === "bse") {
    if (!asset.yahooSymbol) {
      opts?.onStatus?.({
        provider: asset.market === "bse" ? "BSE" : "NSE",
        state: "failing",
        detail: "No Yahoo symbol configured",
      });
      return () => {};
    }
    opts?.onStatus?.({
      provider: asset.market === "bse" ? "BSE:yahoo" : "NSE:yahoo",
      state: "live",
      detail: "Free delayed data",
    });
    return subscribeYahoo(asset.yahooSymbol, onTick);
  }

  return () => {};
}

export async function fetchAssetHistory(asset: MarketAsset, limit = 240, opts?: StreamOptions): Promise<Tick[]> {
  if (asset.market === "crypto") {
    opts?.onStatus?.({ provider: asset.binanceSymbol ? "binance" : "coingecko", state: "live", detail: "history" });
    if (asset.binanceSymbol) return fetchBinanceHistory(asset.binanceSymbol, "1m", limit);
    return fetchCoinGeckoHistory(asset.id, 1);
  }

  if (asset.market === "forex") {
    const base = asset.forexBase ?? "EUR";
    const quote = asset.forexQuote ?? "USD";
    try {
      const rows = await fetchForexHistory({ data: { base, quote, limit, mode: "free", premiumApiKey: "" } });
      opts?.onStatus?.({ provider: "forex-history", state: "live" });
      return rows;
    } catch (e) {
      opts?.onStatus?.({ provider: "forex-history", state: "failing", detail: String((e as Error)?.message ?? e) });
      return [];
    }
  }

  // NSE/BSE: Use Yahoo Finance (free, delayed data)
  const exchange = asset.market === "bse" ? "BSE" : "NSE";
  if (!asset.yahooSymbol) {
    opts?.onStatus?.({
      provider: exchange,
      state: "failing",
      detail: "No Yahoo symbol configured",
    });
    return [];
  }
  opts?.onStatus?.({
    provider: `${exchange}:yahoo`,
    state: "live",
    detail: "history (free delayed)",
  });
  try {
    return await fetchYahooHistory({ data: { symbol: asset.yahooSymbol, interval: "1m", range: "1d" } });
  } catch (e) {
    opts?.onStatus?.({
      provider: `${exchange}:yahoo`,
      state: "failing",
      detail: String((e as Error)?.message ?? e),
    });
    return [];
  }
}
