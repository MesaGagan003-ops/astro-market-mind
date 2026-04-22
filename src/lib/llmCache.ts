// LLM bias cache + exponential time decay.
//
// Why: the LLM call is slow (~2–5s) and stale news shouldn't dominate a
// 1-min forecast. We cache per (market,symbol) for TTL minutes and apply
// exp(-age / halfLife) decay so the bias fades smoothly between refreshes.

import { llmAnalyst, type AnalystOutput } from "./llmAnalyst";

interface CacheEntry {
  fetchedAt: number;       // ms
  bias: number;            // raw (un-decayed) bias from LLM
  confidence: number;
  rationale: string;
}

const TTL_MS = 10 * 60 * 1000;  // 10 minutes hard refresh
const HALF_LIFE_MS = 8 * 60 * 1000; // bias halves every 8 minutes
const cache = new Map<string, CacheEntry>();

const keyOf = (market: string, symbol: string) => `${market}::${symbol}`;

export interface DecayedSignal {
  bias: number;        // post-decay
  confidence: number;  // post-decay
  rationale: string;
  ageSeconds: number;
  cached: boolean;
}

export async function getDecayedLlmSignal(input: {
  market: string;
  symbol: string;
  spotPrice: number;
  recentReturnPct: number;
  newsTitles: string[];
  apiKey?: string;
}): Promise<DecayedSignal> {
  const k = keyOf(input.market, input.symbol);
  const now = Date.now();
  let entry = cache.get(k);
  let cached = false;

  if (!entry || now - entry.fetchedAt > TTL_MS) {
    try {
      const fresh: AnalystOutput = await llmAnalyst({ data: input });
      entry = { fetchedAt: now, bias: fresh.bias, confidence: fresh.confidence, rationale: fresh.rationale };
      cache.set(k, entry);
    } catch {
      if (!entry) {
        entry = { fetchedAt: now, bias: 0, confidence: 0, rationale: "LLM unavailable" };
        cache.set(k, entry);
      }
    }
  } else {
    cached = true;
  }

  const ageMs = Math.max(0, now - entry.fetchedAt);
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return {
    bias: entry.bias * decay,
    confidence: entry.confidence * decay,
    rationale: entry.rationale,
    ageSeconds: Math.round(ageMs / 1000),
    cached,
  };
}

export function peekDecayedSignal(market: string, symbol: string): DecayedSignal | null {
  const entry = cache.get(keyOf(market, symbol));
  if (!entry) return null;
  const ageMs = Date.now() - entry.fetchedAt;
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);
  return {
    bias: entry.bias * decay,
    confidence: entry.confidence * decay,
    rationale: entry.rationale,
    ageSeconds: Math.round(ageMs / 1000),
    cached: true,
  };
}
