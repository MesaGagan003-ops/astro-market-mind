import type { HybridResult } from "@/lib/physics/hybrid";
import { HMM_STATE_LABELS } from "@/lib/physics/hmm";

interface Props {
  result: HybridResult;
  currentPrice: number;
  minutes: number;
}

export function ModelPanels({ result, minutes }: Props) {
  const { arima, garch, hmm, entropy, hurst, hamiltonian, qsl, ssl } = result;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Panel
        title="ARIMA(1,1,1)"
        accent="var(--arima)"
        subtitle="y'ₜ = c + φ·y'ₜ₋₁ + θ·εₜ₋₁ + εₜ"
      >
        <Row label="Drift c" value={signedPrice(arima.c)} />
        <Row label="φ (AR memory)" value={arima.phi.toFixed(3)} />
        <Row label="θ (MA shock)" value={arima.theta.toFixed(3)} />
        <Row label="Long-run drift / step" value={signedPrice(arima.driftPerStep)} />
        <Row label="Residual σ" value={formatPrice(arima.residualStd)} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          Forecast path is recursive with sampled shocks ε ~ N(0, σ_resid) — that's why the
          predicted line wiggles instead of going straight.
        </p>
      </Panel>

      <Panel
        title="GARCH(1,1)"
        accent="var(--garch)"
        subtitle="σ²ₜ = ω + α·ε²ₜ₋₁ + β·σ²ₜ₋₁"
      >
        <Row label="ω (baseline)" value={garch.omega.toExponential(2)} />
        <Row label="α (shock reactivity)" value={garch.alpha.toFixed(3)} />
        <Row label="β (volatility memory)" value={garch.beta.toFixed(3)} />
        <Row label="α + β (persistence)" value={(garch.alpha + garch.beta).toFixed(3)} />
        <Row label="1σ band" value={`±${formatPrice(garch.sigma)}`} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          {garch.alpha + garch.beta > 0.95
            ? "Persistent — once volatility spikes it lingers."
            : garch.alpha > garch.beta
              ? "Spiky — reacts fast to shocks then calms."
              : "Sluggish — slow to react but trends long."}
        </p>
      </Panel>

      <Panel
        title="Hidden Markov Model"
        accent="var(--hmm)"
        subtitle="Forward + Viterbi over 3 latent regimes"
        full
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Current state probabilities
            </div>
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
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Transition matrix P(sₜ | sₜ₋₁) — learned from Viterbi path
            </div>
            <TransitionMatrix matrix={hmm.transitionMatrix} />
          </div>
        </div>
      </Panel>

      <Panel
        title="Shannon Entropy"
        accent="var(--entropy)"
        subtitle="H(X) = −Σ p(xᵢ) log₂ p(xᵢ)"
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
          {entropy.H > 0.85
            ? "High — chaotic, near-random walk. Don't overtrade."
            : entropy.H > 0.6
              ? "Medium — transitional, regime shifting."
              : "Low — trending, organized. Strong signal."}
        </div>
      </Panel>

      <Panel
        title="Hurst Exponent"
        accent="var(--entropy)"
        subtitle="Trend persistence (R/S analysis)"
      >
        <div className="text-3xl font-display font-bold text-foreground">
          H = {hurst.H.toFixed(3)}
        </div>
        <div className="text-xs text-muted-foreground mt-1 capitalize">
          Regime: <span className="text-foreground font-semibold">{hurst.regime.replace("_", " ")}</span>
        </div>
        <div className="mt-2 h-1.5 bg-muted rounded overflow-hidden relative">
          <div className="h-full" style={{ width: `${hurst.H * 100}%`, background: "var(--entropy)" }} />
          <div className="absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: "50%" }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
          {hurst.H > 0.55
            ? "Trending — ARIMA drift trusted, deviation kept."
            : hurst.H < 0.45
              ? "Mean-reverting — path pulled harder back to spot."
              : "Random walk — limited predictability."}
        </p>
      </Panel>

      <Panel
        title="Hamiltonian Energy"
        accent="var(--garch)"
        subtitle="H = ½v² + ½(ΔP/P)²"
      >
        <Row label="Total energy H" value={hamiltonian.H.toExponential(2)} />
        <Row label="Kinetic (velocity²)" value={hamiltonian.KE.toExponential(2)} />
        <Row label="Potential (Δ from MA)" value={hamiltonian.PE.toExponential(2)} />
        <Row label="Velocity (log-ret/step)" value={`${hamiltonian.velocity >= 0 ? "+" : ""}${(hamiltonian.velocity * 100).toFixed(3)}%`} />
        <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
          {hamiltonian.KE > hamiltonian.PE
            ? "High kinetic — strong momentum, room to run."
            : "High potential — stretched from mean, reversion risk."}
        </p>
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
          With σ = {formatPrice(garch.sigma)}, price cannot move more than
          ~2.4σ·√{minutes} in {minutes} min. Hard-clips the hybrid path.
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
    </div>
  );
}

function TransitionMatrix({ matrix }: { matrix: number[][] }) {
  const labels = ["Bear", "Neutral", "Bull"];
  return (
    <div className="overflow-hidden rounded border border-border">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="bg-muted/40">
            <th className="px-2 py-1 text-left text-muted-foreground font-normal">from \ to</th>
            {labels.map((l) => (
              <th key={l} className="px-2 py-1 text-right text-muted-foreground font-normal">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-2 py-1 text-muted-foreground">{labels[i]}</td>
              {row.map((v, j) => {
                const intensity = Math.min(1, v * 1.2);
                return (
                  <td
                    key={j}
                    className="px-2 py-1 text-right text-foreground"
                    style={{ background: `color-mix(in oklab, var(--hmm) ${intensity * 35}%, transparent)` }}
                  >
                    {(v * 100).toFixed(0)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, subtitle, accent, children, full }: { title: string; subtitle?: string; accent: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`panel p-4 ${full ? "lg:col-span-2" : ""}`} style={{ borderTop: `2px solid ${accent}` }}>
      <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
        <h3 className="font-display font-semibold text-sm text-foreground">{title}</h3>
        {subtitle && <span className="text-[10px] text-muted-foreground font-mono">{subtitle}</span>}
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
