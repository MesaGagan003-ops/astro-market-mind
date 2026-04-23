export interface RuntimeConfig {
  smartApiKey: string;
  smartClientCode: string;
  smartPassword: string;
  smartTotp: string;
}

const KEY = "miro.runtime.config.v1";

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  smartApiKey: "",
  smartClientCode: "",
  smartPassword: "",
  smartTotp: "",
};

export function loadRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") return DEFAULT_RUNTIME_CONFIG;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_RUNTIME_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    return { ...DEFAULT_RUNTIME_CONFIG, ...parsed };
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  }
}

export function saveRuntimeConfig(cfg: RuntimeConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
