import { useState } from "react";
import type { RuntimeConfig } from "@/lib/runtimeConfig";

interface Props {
  value: RuntimeConfig;
  onConnect: (cfg: RuntimeConfig) => Promise<void> | void;
}

export function ApiConnectPanel({ value, onConnect }: Props) {
  const [draft, setDraft] = useState<RuntimeConfig>(value);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);

  const set = <K extends keyof RuntimeConfig>(k: K, v: RuntimeConfig[K]) => {
    setDraft((p) => ({ ...p, [k]: v }));
  };

  const connect = async () => {
    setBusy(true);
    setMsg("");
    try {
      await onConnect(draft);
      setMsg("Connected configuration saved");
    } catch (e) {
      setMsg(`Connect failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`panel p-4 ${maximized ? "fixed inset-4 z-50 overflow-auto" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-sm text-foreground">Provider Credentials</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
            aria-label={collapsed ? "Maximize" : "Minimize"}
          >
            ^
          </button>
          <button
            onClick={() => setMaximized((v) => !v)}
            className="px-2 py-1 rounded border border-border text-xs text-muted-foreground hover:text-foreground"
            aria-label={maximized ? "Exit fullscreen" : "Fullscreen"}
          >
            ^
          </button>
          <button
            onClick={connect}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-60"
          >
            {busy ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <Field label="Smart API Key" value={draft.smartApiKey} onChange={(v) => set("smartApiKey", v)} />
          <Field label="Smart Client Code" value={draft.smartClientCode} onChange={(v) => set("smartClientCode", v)} />
          <Field label="Smart Password" value={draft.smartPassword} onChange={(v) => set("smartPassword", v)} type="password" />
          <Field label="Smart TOTP" value={draft.smartTotp} onChange={(v) => set("smartTotp", v)} />
        </div>
      )}
      <div className="text-[11px] text-muted-foreground mt-2">
        Credentials are stored locally in your browser for this device.
      </div>
      {msg && <div className="text-[11px] mt-2 text-primary">{msg}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 rounded bg-input border border-border outline-none focus:border-primary"
      />
    </label>
  );
}
