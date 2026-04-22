const KEY = "miro.disclaimer.acknowledged.v1";

export function hasAcknowledgedDisclaimer(): boolean {
  if (typeof window === "undefined") return true;
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

export function acknowledgeDisclaimer(): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEY, "true"); } catch { /* ignore */ }
}

export const DISCLAIMER_SHORT =
  "MIRO is a research and educational tool. Forecasts and indicators are not investment advice. Past performance does not guarantee future results.";

export const DISCLAIMER_FULL = [
  "MIRO is a research and educational tool. It produces probabilistic forecasts using statistical and machine-learning models.",
  "Nothing on this site constitutes investment advice, a solicitation, or a recommendation to buy or sell any security, currency, commodity or crypto-asset.",
  "MIRO is not registered with SEBI as an Investment Adviser or Research Analyst and does not provide personalised advice.",
  "Trading and investing carry substantial risk of loss. You are solely responsible for your own decisions. Past performance does not guarantee future results.",
  "Backtested results are hypothetical, may suffer from look-ahead/survivorship bias, and do not reflect real-world execution costs.",
];
