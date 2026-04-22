import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { acknowledgeDisclaimer, hasAcknowledgedDisclaimer, DISCLAIMER_FULL } from "@/lib/disclaimer";

export function DisclaimerModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(!hasAcknowledgedDisclaimer()); }, []);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { acknowledgeDisclaimer(); setOpen(false); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Important — Please read before using MIRO</DialogTitle>
          <DialogDescription>This is a research and educational tool, not investment advice.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5 max-h-[50vh] overflow-y-auto">
          {DISCLAIMER_FULL.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
        <DialogFooter>
          <Button onClick={() => { acknowledgeDisclaimer(); setOpen(false); }}>I understand &amp; agree</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DisclaimerBanner() {
  return (
    <div className="rounded border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-foreground flex items-center gap-2">
      <span className="font-semibold uppercase tracking-wide text-warning">⚠ Research only</span>
      <span>Forecasts &amp; signals are model output, not investment advice. Trade at your own risk.</span>
    </div>
  );
}

export function DisclaimerFooter() {
  return (
    <footer className="mt-8 border-t border-border pt-4 text-[10px] text-muted-foreground leading-relaxed">
      <p>
        <span className="font-semibold text-foreground/80">Disclaimer:</span> MIRO is an educational research tool and does not provide investment advice.
        It is not a SEBI-registered Investment Adviser or Research Analyst. All forecasts are probabilistic model output and may be wrong.
        Backtests are hypothetical and do not include all real-world trading frictions. Past performance does not guarantee future results.
        You alone are responsible for your trading decisions and any resulting losses.
      </p>
    </footer>
  );
}
