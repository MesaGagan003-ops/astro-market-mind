import { FEATURED_COINS, loadAllCoins } from "./coins";
import { fetchSmartInstrumentMaster } from "./angleOneSmartApi";

export type MarketKind = "crypto" | "nse" | "bse" | "forex";

export interface MarketAsset {
  id: string;
  symbol: string;
  name: string;
  market: MarketKind;
  binanceSymbol?: string;
  smartExchange?: "NSE" | "BSE";
  smartToken?: string;
  smartTradingSymbol?: string;
  forexBase?: string;
  forexQuote?: string;
  yahooSymbol?: string;
}

const INDIAN_MARKET_ASSETS: MarketAsset[] = [
  // Indices
  { id: "nifty-50", symbol: "NIFTY50", name: "Nifty 50", market: "nse", smartExchange: "NSE", smartTradingSymbol: "NIFTY", yahooSymbol: "^NSEI" },
  { id: "sensex", symbol: "SENSEX", name: "SENSEX", market: "bse", smartExchange: "BSE", smartTradingSymbol: "SENSEX", yahooSymbol: "^BSESN" },
  { id: "banknifty", symbol: "BANKNIFTY", name: "Nifty Bank", market: "nse", smartExchange: "NSE", smartTradingSymbol: "BANKNIFTY", yahooSymbol: "^NSEBANK" },
  // NSE companies
  { id: "reliance-nse", symbol: "RELIANCE", name: "Reliance Industries (NSE)", market: "nse", smartExchange: "NSE", smartTradingSymbol: "RELIANCE", yahooSymbol: "RELIANCE.NS" },
  { id: "tcs-nse", symbol: "TCS", name: "TCS (NSE)", market: "nse", smartExchange: "NSE", smartTradingSymbol: "TCS", yahooSymbol: "TCS.NS" },
  { id: "hdfcbank-nse", symbol: "HDFCBANK", name: "HDFC Bank (NSE)", market: "nse", smartExchange: "NSE", smartTradingSymbol: "HDFCBANK", yahooSymbol: "HDFCBANK.NS" },
  // BSE companies
  { id: "reliance-bse", symbol: "RELIANCE", name: "Reliance Industries (BSE)", market: "bse", smartExchange: "BSE", smartTradingSymbol: "RELIANCE", yahooSymbol: "RELIANCE.BO" },
  { id: "tcs-bse", symbol: "TCS", name: "TCS (BSE)", market: "bse", smartExchange: "BSE", smartTradingSymbol: "TCS", yahooSymbol: "TCS.BO" },
  { id: "icicibank-bse", symbol: "ICICIBANK", name: "ICICI Bank (BSE)", market: "bse", smartExchange: "BSE", smartTradingSymbol: "ICICIBANK", yahooSymbol: "ICICIBANK.BO" },
];

export const FEATURED_ASSETS: MarketAsset[] = [
  ...FEATURED_COINS.map((c) => ({ ...c, market: "crypto" as const })),
  ...INDIAN_MARKET_ASSETS,
];

let cache: MarketAsset[] | null = null;

export async function loadAllAssets(): Promise<MarketAsset[]> {
  if (cache) return cache;

  const [allCoins, smartMaster] = await Promise.all([
    loadAllCoins(),
    fetchSmartInstrumentMaster().catch(() => []),
  ]);

  const cryptoAssets = allCoins.map((c) => ({
    ...c,
    market: "crypto" as const,
    yahooSymbol: `${c.symbol.toUpperCase()}-USD`,
  }));

  const merged = [...cryptoAssets, ...INDIAN_MARKET_ASSETS, ...smartMaster];

  merged.sort((a, b) => {
    if (a.market !== b.market) return a.market.localeCompare(b.market);
    return a.name.localeCompare(b.name);
  });

  cache = merged;
  return merged;
}

export function marketLabel(market: MarketKind): string {
  if (market === "crypto") return "Crypto";
  if (market === "nse") return "NSE";
  if (market === "bse") return "BSE";
  return "Other";
}
