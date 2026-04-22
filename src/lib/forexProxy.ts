import { createServerFn } from "@tanstack/react-start";

function parsePair(input: unknown): {
  base: string;
  quote: string;
  limit: number;
  mode: "auto" | "free" | "premium";
  premiumApiKey: string;
} {
  const i = (input ?? {}) as { base?: string; quote?: string; limit?: number; mode?: "auto" | "free" | "premium"; premiumApiKey?: string };
  return {
    base: String(i.base ?? "EUR").toUpperCase(),
    quote: String(i.quote ?? "USD").toUpperCase(),
    limit: Math.max(20, Math.min(600, Number(i.limit ?? 240))),
    mode: i.mode === "free" || i.mode === "premium" ? i.mode : "auto",
    premiumApiKey: String(i.premiumApiKey ?? ""),
  };
}

async function fetchPremiumLatest(base: string, quote: string, apiKey: string) {
  if (!apiKey) throw new Error("premium key missing");
  const symbol = `${base}/${quote}`;
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
  if (!res.ok) throw new Error(`Premium latest ${res.status}`);
  const j = (await res.json()) as { price?: string; status?: string; message?: string };
  if (j.status === "error") throw new Error(String(j.message || "premium error"));
  const price = Number(j.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("premium invalid");
  return { price, ts: Date.now(), provider: "twelvedata" as const };
}

async function fetchPremiumHistory(base: string, quote: string, limit: number, apiKey: string) {
  if (!apiKey) throw new Error("premium key missing");
  const symbol = `${base}/${quote}`;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1min&outputsize=${Math.min(5000, Math.max(20, limit))}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
  if (!res.ok) throw new Error(`Premium history ${res.status}`);
  const j = (await res.json()) as { values?: Array<{ datetime?: string; close?: string }>; status?: string; message?: string };
  if (j.status === "error") throw new Error(String(j.message || "premium error"));
  const rows = (j.values ?? [])
    .map((v) => ({ ts: new Date(String(v.datetime ?? "")).getTime(), price: Number(v.close) }))
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => a.ts - b.ts)
    .slice(-limit);
  return { rows, provider: "twelvedata" as const };
}

export const fetchForexPrice = createServerFn({ method: "GET" })
  .inputValidator(parsePair)
  .handler(async ({ data }) => {
    if (data.mode !== "free") {
      try {
        return await fetchPremiumLatest(data.base, data.quote, data.premiumApiKey || process.env.TWELVEDATA_API_KEY || "");
      } catch (e) {
        if (data.mode === "premium") throw e;
      }
    }

    const url = `https://api.frankfurter.app/latest?from=${data.base}&to=${data.quote}`;
    const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
    if (!res.ok) throw new Error(`Forex latest ${res.status}`);
    const j = (await res.json()) as { rates?: Record<string, number>; date?: string };
    const price = Number(j.rates?.[data.quote]);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Forex latest invalid");
    return {
      price,
      ts: j.date ? new Date(`${j.date}T00:00:00Z`).getTime() : Date.now(),
      provider: "frankfurter" as const,
    };
  });

export const fetchForexHistory = createServerFn({ method: "GET" })
  .inputValidator(parsePair)
  .handler(async ({ data }) => {
    if (data.mode !== "free") {
      try {
        const p = await fetchPremiumHistory(data.base, data.quote, data.limit, data.premiumApiKey || process.env.TWELVEDATA_API_KEY || "");
        if (p.rows.length > 0) return p.rows;
      } catch (e) {
        if (data.mode === "premium") throw e;
      }
    }

    const end = new Date();
    const start = new Date(end.getTime() - Math.max(1, Math.ceil(data.limit / 24)) * 24 * 3600 * 1000);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);

    const url = `https://api.frankfurter.app/${s}..${e}?from=${data.base}&to=${data.quote}`;
    const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
    if (!res.ok) throw new Error(`Forex history ${res.status}`);

    const j = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    const rows = Object.entries(j.rates ?? {})
      .map(([date, rates]) => ({
        ts: new Date(`${date}T00:00:00Z`).getTime(),
        price: Number(rates[data.quote]),
      }))
      .filter((x) => Number.isFinite(x.price) && x.price > 0)
      .sort((a, b) => a.ts - b.ts);

    if (rows.length === 0) return [] as Array<{ ts: number; price: number }>;

    const out: Array<{ ts: number; price: number }> = [];
    for (let i = 0; i < data.limit; i++) {
      const idx = Math.floor((i * (rows.length - 1)) / Math.max(1, data.limit - 1));
      out.push(rows[idx]);
    }
    return out;
  });
