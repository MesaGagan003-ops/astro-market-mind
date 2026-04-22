import { createServerFn } from "@tanstack/react-start";

function parseInput(input: unknown): { symbol: string; interval: string; range: string } {
  const i = (input ?? {}) as { symbol?: string; interval?: string; range?: string };
  return {
    symbol: String(i.symbol ?? "BTC-USD").toUpperCase(),
    interval: String(i.interval ?? "1m"),
    range: String(i.range ?? "7d"),
  };
}

interface YahooChartResult {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
      meta?: { regularMarketPrice?: number };
    }>;
  };
}

export const fetchYahooHistory = createServerFn({ method: "GET" })
  .inputValidator(parseInput)
  .handler(async ({ data }) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(data.symbol)}?interval=${encodeURIComponent(data.interval)}&range=${encodeURIComponent(data.range)}`;
    const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
    if (!res.ok) return [] as Array<{ ts: number; price: number }>;

    const j = (await res.json()) as YahooChartResult;
    const r = j.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const close = r?.indicators?.quote?.[0]?.close ?? [];

    const out: Array<{ ts: number; price: number }> = [];
    for (let i = 0; i < ts.length; i++) {
      const p = Number(close[i]);
      if (Number.isFinite(p) && p > 0) out.push({ ts: ts[i] * 1000, price: p });
    }
    return out;
  });
