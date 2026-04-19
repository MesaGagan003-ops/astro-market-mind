// Available prediction horizons (in number of "candles" = 1 minute each)
export interface Timeframe {
  id: string;
  label: string;
  minutes: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1 min", minutes: 1 },
  { id: "5m", label: "5 min", minutes: 5 },
  { id: "10m", label: "10 min", minutes: 10 },
  { id: "15m", label: "15 min", minutes: 15 },
  { id: "30m", label: "30 min", minutes: 30 },
  { id: "1h", label: "1 hour", minutes: 60 },
  { id: "2h", label: "2 hours", minutes: 120 },
  { id: "4h", label: "4 hours", minutes: 240 },
  { id: "1w", label: "1 week", minutes: 60 * 24 * 7 },
];
