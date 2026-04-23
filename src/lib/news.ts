// News fetching + lightweight lexicon sentiment scoring.
// Source: CryptoPanic public API (no key required for the free posts feed).
// We proxy through a TanStack Start server function to bypass CORS.

import { createServerFn } from "@tanstack/react-start";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number; // ms
  sentiment: number;   // [-1, 1]
  votes?: { positive: number; negative: number; important: number };
}

export interface NewsSentiment {
  items: NewsItem[];
  meanSentiment: number;        // [-1, 1] time-decayed average
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  confidence: number;           // [0,1] based on volume + agreement
}

// --- Lexicon (small but effective for crypto headlines) ---
const POS = [
  "surge","soar","rally","bull","bullish","gain","gains","rise","rises","rising","up","jump","jumps","high","record","ath","breakout","breaks","break","approve","approved","approval","adopt","adoption","partnership","partner","launch","launches","integration","upgrade","positive","strong","strength","beat","beats","outperform","accumulate","whale","support","supports","milestone","etf","inflow","inflows","buy","buying","buyer","green","moon","skyrocket","explode","pump","pumping","upgrade","mainnet","listing","listed","institutional","invest","investment","raise","raises","raising","funded","funding",
];
const NEG = [
  "crash","plunge","plunges","plummet","dump","dumping","sell","selloff","sell-off","bear","bearish","bearmarket","decline","declines","declining","drop","drops","fall","falls","falling","down","low","loss","losses","red","fear","fud","hack","hacked","exploit","exploited","stolen","theft","scam","fraud","sec","lawsuit","sue","sued","ban","banned","banning","crackdown","regulation","investigation","investigate","probe","fine","fined","penalty","liquidate","liquidation","liquidated","outflow","outflows","weak","weakness","reject","rejection","rejected","delay","delays","delayed","postpone","collapse","bankrupt","insolvent","downgrade","warning","crisis","crash","correction",
];
const POS_SET = new Set(POS);
const NEG_SET = new Set(NEG);

function scoreText(text: string): number {
  if (!text) return 0;
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  let pos = 0, neg = 0;
  for (const tok of tokens) {
    if (POS_SET.has(tok)) pos++;
    else if (NEG_SET.has(tok)) neg++;
  }
  const total = pos + neg;
  if (total === 0) return 0;
  return (pos - neg) / total; // [-1, 1]
}

export const fetchCoinNews = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    const i = (input ?? {}) as { symbol?: string };
    return { symbol: String(i.symbol ?? "BTC").toUpperCase() };
  })
  .handler(async ({ data }) => {
    // Primary: CryptoCompare News (free, no API key, generous CORS, stable schema).
    // Filter by category (their token for the asset). Falls back to general feed.
    const headers = { "User-Agent": "MIRO/1.0", Accept: "application/json" } as const;
    const ccUrl = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${encodeURIComponent(data.symbol)}`;
    try {
      const res = await fetch(ccUrl, { headers });
      if (res.ok) {
        const j = (await res.json()) as { Data?: CCNewsItem[] };
        const mapped = (j.Data ?? []).slice(0, 30).map(ccToRaw);
        if (mapped.length > 0) return { items: mapped };
      }
    } catch { /* fall through */ }

    // Fallback 1: CryptoCompare general feed.
    try {
      const res = await fetch(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN`, { headers });
      if (res.ok) {
        const j = (await res.json()) as { Data?: CCNewsItem[] };
        const mapped = (j.Data ?? []).slice(0, 30).map(ccToRaw);
        if (mapped.length > 0) return { items: mapped };
      }
    } catch { /* fall through */ }

    // Fallback 2: CryptoPanic public feed (legacy).
    try {
      const r2 = await fetch(`https://cryptopanic.com/api/v1/posts/?public=true&kind=news`, { headers });
      if (r2.ok) {
        const j = (await r2.json()) as { results?: RawPost[] };
        return { items: j.results ?? [] };
      }
    } catch { /* ignore */ }

    return { items: [] as RawPost[] };
  });

interface CCNewsItem {
  id: string | number;
  title: string;
  url: string;
  published_on: number; // unix seconds
  source?: string;
  source_info?: { name?: string };
  body?: string;
  upvotes?: string | number;
  downvotes?: string | number;
}

function ccToRaw(it: CCNewsItem): RawPost {
  return {
    id: Number(it.id) || Math.floor(Math.random() * 1e9),
    title: it.title,
    url: it.url,
    published_at: new Date(it.published_on * 1000).toISOString(),
    source: { title: it.source_info?.name || it.source || "cryptocompare" },
    votes: {
      positive: Number(it.upvotes ?? 0),
      negative: Number(it.downvotes ?? 0),
    },
  };
}

interface RawPost {
  id: number;
  title: string;
  url: string;
  published_at: string;
  source?: { title?: string; domain?: string };
  votes?: { positive?: number; negative?: number; important?: number; liked?: number; disliked?: number };
}

export function buildSentiment(rawItems: RawPost[]): NewsSentiment {
  const now = Date.now();
  const items: NewsItem[] = rawItems.slice(0, 30).map((p) => {
    const ts = new Date(p.published_at).getTime();
    const lex = scoreText(p.title);
    // Vote-based correction
    const v = p.votes ?? {};
    const vPos = (v.positive ?? 0) + (v.liked ?? 0);
    const vNeg = (v.negative ?? 0) + (v.disliked ?? 0);
    const vTotal = vPos + vNeg;
    const voteScore = vTotal > 0 ? (vPos - vNeg) / vTotal : 0;
    const sentiment = Math.max(-1, Math.min(1, lex * 0.7 + voteScore * 0.3));
    return {
      id: String(p.id),
      title: p.title,
      url: p.url,
      source: p.source?.title || p.source?.domain || "news",
      publishedAt: ts,
      sentiment,
      votes: { positive: vPos, negative: vNeg, important: v.important ?? 0 },
    };
  });

  // Time-decayed mean (half-life 6h)
  const HL = 6 * 3600 * 1000;
  let num = 0, den = 0;
  let bull = 0, bear = 0, neu = 0;
  for (const it of items) {
    const age = Math.max(0, now - it.publishedAt);
    const w = Math.pow(0.5, age / HL);
    num += it.sentiment * w;
    den += w;
    if (it.sentiment > 0.15) bull++;
    else if (it.sentiment < -0.15) bear++;
    else neu++;
  }
  const meanSentiment = den > 0 ? num / den : 0;
  const total = items.length;
  const agreement = total > 0 ? Math.abs(bull - bear) / total : 0;
  const volume = Math.min(1, total / 15);
  const confidence = Math.max(0, Math.min(1, 0.5 * volume + 0.5 * agreement));

  return {
    items,
    meanSentiment,
    bullishCount: bull,
    bearishCount: bear,
    neutralCount: neu,
    confidence,
  };
}
