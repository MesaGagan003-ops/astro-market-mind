// Server-side proxy for Binance public REST endpoints.
// The browser cannot call api.binance.com directly:
//  - CORS is not allowed by Binance
//  - Binance geo-blocks many cloud / CDN IP ranges with HTTP 451
// Running the fetch on the edge worker avoids both issues.

import { createServerFn } from "@tanstack/react-start";

export const fetchBinanceKlines = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { symbol?: string; interval?: string; limit?: number };
    return {
      symbol: String(i.symbol ?? "BTCUSDT").toUpperCase(),
      interval: String(i.interval ?? "1m"),
      limit: Math.max(10, Math.min(1000, Number(i.limit ?? 240))),
    };
  })
  .handler(async ({ data }) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${data.symbol}&interval=${data.interval}&limit=${data.limit}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const arr = (await res.json()) as Array<unknown[]>;
    return arr.map((k) => ({ ts: k[0] as number, price: parseFloat(k[4] as string) }));
  });

export const fetchBinancePrice = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { symbol?: string };
    return { symbol: String(i.symbol ?? "BTCUSDT").toUpperCase() };
  })
  .handler(async ({ data }) => {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${data.symbol}`;
    const res = await fetch(url, { headers: { "User-Agent": "QuantumEdge/1.0" } });
    if (!res.ok) throw new Error(`Binance ticker ${res.status}`);
    const j = (await res.json()) as { price: string };
    return { price: parseFloat(j.price), ts: Date.now() };
  });
