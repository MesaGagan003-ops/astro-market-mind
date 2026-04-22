import { createServerFn } from "@tanstack/react-start";

interface SmartLoginResponse {
  data?: {
    jwtToken?: string;
    refreshToken?: string;
    feedToken?: string;
  };
}

const DEFAULT_BASE = "https://apiconnect.angelone.in";

let cachedToken = "";
let tokenUntil = 0;
let cachedCredKey = "";

interface SmartRuntimeCreds {
  smartApiKey?: string;
  smartClientCode?: string;
  smartPassword?: string;
  smartTotp?: string;
}

interface SmartInstrumentMasterRow {
  token?: string;
  symbol?: string;
  name?: string;
  exch_seg?: string;
  instrumenttype?: string;
}

function mkHeaders(apiKey: string, jwt?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
    "X-PrivateKey": apiKey,
    ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
  };
}

async function loginSmartApi(creds?: SmartRuntimeCreds): Promise<string> {
  const now = Date.now();
  const apiKey = creds?.smartApiKey || process.env.ANGLEONE_API_KEY || "";
  const clientCode = creds?.smartClientCode || process.env.ANGLEONE_CLIENT_CODE;
  const password = creds?.smartPassword || process.env.ANGLEONE_PASSWORD;
  const totp = creds?.smartTotp || process.env.ANGLEONE_TOTP;
  const credKey = `${apiKey}:${clientCode}`;
  if (cachedToken && now < tokenUntil && cachedCredKey === credKey) return cachedToken;

  const base = process.env.ANGLEONE_BASE_URL ?? DEFAULT_BASE;

  if (!clientCode || !password || !totp || !apiKey) {
    throw new Error("Missing AngleOne credentials in environment");
  }

  const res = await fetch(`${base}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    method: "POST",
    headers: mkHeaders(apiKey),
    body: JSON.stringify({
      clientcode: clientCode,
      password,
      totp,
    }),
  });

  if (!res.ok) throw new Error(`SmartAPI login ${res.status}`);
  const j = (await res.json()) as SmartLoginResponse;
  const token = j.data?.jwtToken;
  if (!token) throw new Error("SmartAPI jwt missing");

  cachedToken = token;
  cachedCredKey = credKey;
  tokenUntil = now + 10 * 60 * 1000;
  return token;
}

function validateQuoteInput(input: unknown) {
  const i = (input ?? {}) as {
    exchange?: "NSE" | "BSE";
    tradingSymbol?: string;
    token?: string;
    smartApiKey?: string;
    smartClientCode?: string;
    smartPassword?: string;
    smartTotp?: string;
  };
  return {
    exchange: i.exchange === "BSE" ? "BSE" : "NSE",
    tradingSymbol: String(i.tradingSymbol ?? "NIFTY"),
    token: i.token ? String(i.token) : "",
    smartApiKey: i.smartApiKey ? String(i.smartApiKey) : "",
    smartClientCode: i.smartClientCode ? String(i.smartClientCode) : "",
    smartPassword: i.smartPassword ? String(i.smartPassword) : "",
    smartTotp: i.smartTotp ? String(i.smartTotp) : "",
  };
}

export const fetchSmartApiLtp = createServerFn({ method: "GET" })
  .inputValidator(validateQuoteInput)
  .handler(async ({ data }) => {
    const base = process.env.ANGLEONE_BASE_URL ?? DEFAULT_BASE;

    try {
      const apiKey = data.smartApiKey || process.env.ANGLEONE_API_KEY || "";
      const jwt = await loginSmartApi(data);
      const res = await fetch(`${base}/rest/secure/angelbroking/order/v1/getLtpData`, {
        method: "POST",
        headers: mkHeaders(apiKey, jwt),
        body: JSON.stringify({
          exchange: data.exchange,
          tradingsymbol: data.tradingSymbol,
          symboltoken: data.token,
        }),
      });
      if (!res.ok) throw new Error(`SmartAPI LTP ${res.status}`);

      const j = (await res.json()) as {
        data?: { ltp?: number; close?: number; exchFeedTime?: string };
      };
      const ltp = Number(j.data?.ltp ?? j.data?.close);
      if (!Number.isFinite(ltp) || ltp <= 0) throw new Error("SmartAPI invalid LTP");
      return {
        price: ltp,
        ts: j.data?.exchFeedTime ? new Date(j.data.exchFeedTime).getTime() : Date.now(),
      };
    } catch {
      // Resilient fallback keeps UI live when credentials are not configured yet.
      return {
        price: 0,
        ts: Date.now(),
      };
    }
  });

function validateHistoryInput(input: unknown) {
  const i = (input ?? {}) as {
    exchange?: "NSE" | "BSE";
    tradingSymbol?: string;
    token?: string;
    interval?: string;
    limit?: number;
    smartApiKey?: string;
    smartClientCode?: string;
    smartPassword?: string;
    smartTotp?: string;
  };
  return {
    exchange: i.exchange === "BSE" ? "BSE" : "NSE",
    tradingSymbol: String(i.tradingSymbol ?? "NIFTY"),
    token: i.token ? String(i.token) : "",
    interval: String(i.interval ?? "ONE_MINUTE"),
    limit: Math.max(20, Math.min(1000, Number(i.limit ?? 240))),
    smartApiKey: i.smartApiKey ? String(i.smartApiKey) : "",
    smartClientCode: i.smartClientCode ? String(i.smartClientCode) : "",
    smartPassword: i.smartPassword ? String(i.smartPassword) : "",
    smartTotp: i.smartTotp ? String(i.smartTotp) : "",
  };
}

export const fetchSmartApiHistory = createServerFn({ method: "GET" })
  .inputValidator(validateHistoryInput)
  .handler(async ({ data }) => {
    const base = process.env.ANGLEONE_BASE_URL ?? DEFAULT_BASE;
    const end = new Date();
    const start = new Date(end.getTime() - data.limit * 60 * 1000);

    try {
      const apiKey = data.smartApiKey || process.env.ANGLEONE_API_KEY || "";
      const jwt = await loginSmartApi(data);
      const res = await fetch(`${base}/rest/secure/angelbroking/historical/v1/getCandleData`, {
        method: "POST",
        headers: mkHeaders(apiKey, jwt),
        body: JSON.stringify({
          exchange: data.exchange,
          symboltoken: data.token,
          interval: data.interval,
          fromdate: start.toISOString().slice(0, 19).replace("T", " "),
          todate: end.toISOString().slice(0, 19).replace("T", " "),
        }),
      });
      if (!res.ok) throw new Error(`SmartAPI history ${res.status}`);

      const j = (await res.json()) as { data?: Array<[string, string, string, string, string, string]> };
      const rows = (j.data ?? []).map((c) => ({
        ts: new Date(c[0]).getTime(),
        price: Number(c[4]),
      })).filter((x) => Number.isFinite(x.price) && x.price > 0);

      if (rows.length === 0) return [] as Array<{ ts: number; price: number }>;
      return rows.slice(-data.limit);
    } catch {
      return [] as Array<{ ts: number; price: number }>;
    }
  });

export const fetchSmartInstrumentMaster = createServerFn({ method: "GET" })
  .handler(async () => {
    const url = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
    try {
      const res = await fetch(url, { headers: { "User-Agent": "MIRO/1.0" } });
      if (!res.ok) return [] as Array<{ id: string; symbol: string; name: string; market: "nse" | "bse"; smartExchange: "NSE" | "BSE"; smartToken: string; smartTradingSymbol: string; yahooSymbol: string }>;
      const arr = (await res.json()) as SmartInstrumentMasterRow[];
      const out: Array<{ id: string; symbol: string; name: string; market: "nse" | "bse"; smartExchange: "NSE" | "BSE"; smartToken: string; smartTradingSymbol: string; yahooSymbol: string }> = [];
      for (const row of arr) {
        const exch = row.exch_seg === "BSE" ? "BSE" : row.exch_seg === "NSE" ? "NSE" : "";
        if (!exch) continue;
        const tradingSymbol = String(row.symbol ?? "").trim();
        const token = String(row.token ?? "").trim();
        const name = String(row.name ?? tradingSymbol).trim();
        if (!tradingSymbol || !token) continue;
        const isEq = tradingSymbol.endsWith("-EQ") || String(row.instrumenttype ?? "").toUpperCase().includes("EQ");
        if (!isEq) continue;
        const clean = tradingSymbol.replace(/-EQ$/i, "");
        const market = exch === "NSE" ? "nse" : "bse";
        out.push({
          id: `${market}-${clean.toLowerCase()}`,
          symbol: clean,
          name: `${name} (${exch})`,
          market,
          smartExchange: exch,
          smartToken: token,
          smartTradingSymbol: clean,
          yahooSymbol: `${clean}.${exch === "NSE" ? "NS" : "BO"}`,
        });
      }
      // dedupe by exchange+symbol
      const map = new Map<string, (typeof out)[number]>();
      for (const x of out) map.set(`${x.smartExchange}:${x.symbol}`, x);
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [] as Array<{ id: string; symbol: string; name: string; market: "nse" | "bse"; smartExchange: "NSE" | "BSE"; smartToken: string; smartTradingSymbol: string; yahooSymbol: string }>;
    }
  });
