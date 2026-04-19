// Coin universe via CoinGecko + Binance symbol map.
// We fetch the full ~10k coin list once, then map each coin (when possible)
// to a Binance USDT spot symbol for tick-by-tick WebSocket streams.
// Coins without Binance pairs fall back to CoinGecko REST polling.

export interface Coin {
  id: string; // coingecko id
  symbol: string; // ticker, e.g. "btc"
  name: string;
  binanceSymbol?: string; // e.g. "btcusdt"
}

let coinCache: Coin[] | null = null;
let binanceSymbols: Set<string> | null = null;

async function loadBinanceSymbols(): Promise<Set<string>> {
  if (binanceSymbols) return binanceSymbols;
  try {
    const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
    const data = await res.json();
    const set = new Set<string>();
    for (const s of data.symbols ?? []) {
      if (s.status === "TRADING" && s.quoteAsset === "USDT") {
        set.add(String(s.baseAsset).toLowerCase());
      }
    }
    binanceSymbols = set;
    return set;
  } catch {
    binanceSymbols = new Set();
    return binanceSymbols;
  }
}

export async function loadAllCoins(): Promise<Coin[]> {
  if (coinCache) return coinCache;
  const [list, binSet] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/coins/list").then((r) => r.json()),
    loadBinanceSymbols(),
  ]);
  const coins: Coin[] = (list as Array<{ id: string; symbol: string; name: string }>).map((c) => {
    const sym = c.symbol.toLowerCase();
    return {
      id: c.id,
      symbol: sym,
      name: c.name,
      binanceSymbol: binSet.has(sym) ? `${sym}usdt` : undefined,
    };
  });
  // Sort: Binance-supported first, then alphabetical
  coins.sort((a, b) => {
    if (!!a.binanceSymbol !== !!b.binanceSymbol) return a.binanceSymbol ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  coinCache = coins;
  return coins;
}

// Top defaults to render quickly while full list loads
export const FEATURED_COINS: Coin[] = [
  { id: "bitcoin", symbol: "btc", name: "Bitcoin", binanceSymbol: "btcusdt" },
  { id: "ethereum", symbol: "eth", name: "Ethereum", binanceSymbol: "ethusdt" },
  { id: "solana", symbol: "sol", name: "Solana", binanceSymbol: "solusdt" },
  { id: "binancecoin", symbol: "bnb", name: "BNB", binanceSymbol: "bnbusdt" },
  { id: "ripple", symbol: "xrp", name: "XRP", binanceSymbol: "xrpusdt" },
  { id: "dogecoin", symbol: "doge", name: "Dogecoin", binanceSymbol: "dogeusdt" },
  { id: "shiba-inu", symbol: "shib", name: "Shiba Inu", binanceSymbol: "shibusdt" },
  { id: "pepe", symbol: "pepe", name: "Pepe", binanceSymbol: "pepeusdt" },
  { id: "dogwifcoin", symbol: "wif", name: "dogwifhat", binanceSymbol: "wifusdt" },
  { id: "bonk", symbol: "bonk", name: "Bonk", binanceSymbol: "bonkusdt" },
  { id: "floki", symbol: "floki", name: "Floki", binanceSymbol: "flokiusdt" },
  { id: "cardano", symbol: "ada", name: "Cardano", binanceSymbol: "adausdt" },
];
