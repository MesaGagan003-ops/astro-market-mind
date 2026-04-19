import type { HybridResult } from "@/lib/physics/hybrid";
import { HMM_STATE_LABELS } from "@/lib/physics/hmm";

interface Props {
  result: HybridResult;
  currentPrice: number;
  minutes: number;
}

export function ModelPanels({ result, currentPrice, minutes }: Props) {
  const { arima, garch, hmm, entropy, qsl, ssl, quantum } = result;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel
        title="ARIMA(2,1,2)"
        accent="var(--arima)"
        subtitle="Autoregressive drift baseline"
      >
        <Row label="Drift / candle" value={signedPrice(arima.drift)} />
        <Row label="AR(1) / AR(2)" value={`${arima.ar1.toFixed(3)} / ${arima.ar2.toFixed(3)}`} />
        <Row label="MA(1) / MA(2)" value={`${arima.ma1.toFixed(3)} / ${arima.ma2.toFixed(3)}`} />
        <Row label="Residual σ" value={signedPrice(arima.residualStd)} />
      </Panel>

      <Panel
        title="GARCH(1,1)"
        accent="var(--garch)"
        subtitle="Volatility clustering"
      >
        <Row label="α + β (persistence)" value={(garch.alpha + garch.beta).toFixed(3)} />
        <Row label="α" value={garch.alpha.toFixed(3)} />
        <Row label="β" value={garch.beta.toFixed(3)} />
        <Row label="1σ band" value={`±${formatPrice(garch.sigma)}`} />
      </Panel>

      <Panel
        title="Hidden Markov Model"
        accent="var(--hmm)"
        subtitle="3 latent regimes via Forward algorithm"
      >
        {hmm.stateProbs.map((p, i) => (
          <div key={i} className="mb-1.5">
            <div className="flex justify-between text-xs mb-0.5">
              <span className={i === hmm.dominantState ? "text-foreground font-semibold" : "text-muted-foreground"}>
                {HMM_STATE_LABELS[i]}
              </span>
              <span className="text-foreground font-mono">{(p * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div
                className="h-full"
                style={{
                  width: `${p * 100}%`,
                  background: i === 0 ? "var(--bear)" : i === 2 ? "var(--bull)" : "var(--entropy)",
                }}
              />
            </div>
          </div>
        ))}
      </Panel>

      <Panel
        title="Shannon Entropy"
        accent="var(--entropy)"
        subtitle="Information edge over coin-flip"
      >
        <div className="text-3xl font-display font-bold text-foreground">
          H = {entropy.H.toFixed(3)}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Edge ≈ {(entropy.edge * 100).toFixed(1)}% &nbsp;·&nbsp; Up-ratio {(entropy.upRatio * 100).toFixed(0)}%
        </div>
        <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden">
          <div className="h-full bg-entropy" style={{ width: `${entropy.H * 100}%` }} />
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">
          {entropy.H > 0.85 ? "Near-random — don't overtrade." : entropy.H > 0.6 ? "Moderate structure." : "Strong directional structure."}
        </div>
      </Panel>

      <Panel
        title="Quantum Speed Limit"
        accent="var(--qsl)"
        subtitle="Mandelstam–Tamm hard bound"
      >
        <Row label="Upper bound" value={formatPrice(qsl.upper)} />
        <Row label="Lower bound" value={formatPrice(qsl.lower)} />
        <Row label="Reachable range" value={`±${formatPrice(qsl.reachableRange / 2)}`} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          Given σ = {formatPrice(garch.sigma)}, the market state cannot move more than ~2.4σ·√{minutes / 1} in {minutes} min.
        </p>
      </Panel>

      <Panel
        title="Stochastic Speed Limit"
        accent="var(--ssl)"
        subtitle="Itô diffusion 95% bound"
      >
        <Row label="Upper bound" value={formatPrice(ssl.upper)} />
        <Row label="Lower bound" value={formatPrice(ssl.lower)} />
        <Row label="Reachable range" value={`±${formatPrice(ssl.reachableRange / 2)}`} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          μT ± 1.96σ√T. Tighter than QSL when drift dominates noise.
        </p>
      </Panel>

      <Panel
        title="Quantum Probability Density"
        accent="var(--quantum)"
        subtitle="|ψ(x,T)|² over future prices"
        full
      >
        <QuantumDensityViz density={quantum.density} grid={quantum.grid} current={currentPrice} />
        <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
          <Stat label="Most probable" value={formatPrice(quantum.mostProbable)} />
          <Stat label="E[price]" value={formatPrice(quantum.expectedPrice)} />
          <Stat label="P(up)" value={`${(quantum.pUp * 100).toFixed(0)}%`} />
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, subtitle, accent, children, full }: { title: string; subtitle?: string; accent: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`panel p-4 ${full ? "lg:col-span-2" : ""}`} style={{ borderTop: `2px solid ${accent}` }}>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display font-semibold text-sm text-foreground">{title}</h3>
        {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function QuantumDensityViz({ density, grid, current }: { density: number[]; grid: number[]; current: number }) {
  const max = Math.max(...density);
  const w = 100 / density.length;
  // find current position
  return (
    <svg viewBox="0 0 100 50" className="w-full h-24" preserveAspectRatio="none">
      <defs>
        <linearGradient id="qd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.22 305)" stopOpacity={0.9} />
          <stop offset="100%" stopColor="oklch(0.65 0.22 305)" stopOpacity={0.1} />
        </linearGradient>
      </defs>
      {density.map((p, i) => {
        const h = (p / max) * 48;
        return <rect key={i} x={i * w} y={50 - h} width={w * 0.95} height={h} fill="url(#qd)" />;
      })}
      {(() => {
        // Find x for current
        let idx = 0;
        let best = Infinity;
        for (let i = 0; i < grid.length; i++) {
          const d = Math.abs(grid[i] - current);
          if (d < best) { best = d; idx = i; }
        }
        return <line x1={idx * w} x2={idx * w} y1={0} y2={50} stroke="oklch(0.95 0.01 250)" strokeWidth={0.5} strokeDasharray="1 1" />;
      })()}
    </svg>
  );
}

function formatPrice(v: number): string {
  if (Math.abs(v) >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (Math.abs(v) >= 1) return `$${v.toFixed(2)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

function signedPrice(v: number): string {
  const s = v >= 0 ? "+" : "−";
  return `${s}${formatPrice(Math.abs(v))}`;
}
