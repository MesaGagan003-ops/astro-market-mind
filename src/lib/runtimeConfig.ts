// Runtime config is empty now - using only free data sources (Binance, CoinGecko, Yahoo Finance)
export interface RuntimeConfig {}

const KEY = "miro.runtime.config.v1";

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {};

export function loadRuntimeConfig(): RuntimeConfig {
  return DEFAULT_RUNTIME_CONFIG;
}

export function saveRuntimeConfig(_cfg: RuntimeConfig): void {
  // No-op: no credentials to save
}
