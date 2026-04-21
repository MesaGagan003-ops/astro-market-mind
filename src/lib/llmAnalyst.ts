// LLM analyst — calls a server function that asks Lovable AI to read recent
// news + price context and produce a directional bias in [-1, 1] for the
// hybrid engine to fold into its drift.

import { createServerFn } from "@tanstack/react-start";

interface AnalystInput {
  market: string;
  symbol: string;
  spotPrice: number;
  recentReturnPct: number;
  newsTitles: string[];
}

export interface AnalystOutput {
  bias: number;       // -1..1
  confidence: number; // 0..1
  rationale: string;
}

export const llmAnalyst = createServerFn({ method: "POST" })
  .inputValidator((d: AnalystInput) => d)
  .handler(async ({ data }): Promise<AnalystOutput> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { bias: 0, confidence: 0, rationale: "LLM key missing" };

    const news = data.newsTitles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n");
    const prompt = `Market: ${data.market.toUpperCase()} ${data.symbol}
Spot: ${data.spotPrice}
Recent return: ${data.recentReturnPct.toFixed(2)}%

Recent headlines:
${news || "(no recent news)"}

Based on the news + price action, output a JSON directional bias for the next short horizon.`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are a quantitative market analyst. Be neutral and concise. Output via the tool." },
            { role: "user", content: prompt },
          ],
          tools: [{
            type: "function",
            function: {
              name: "directional_bias",
              description: "Return directional bias for the symbol",
              parameters: {
                type: "object",
                properties: {
                  bias: { type: "number", description: "-1 strong bearish .. 1 strong bullish" },
                  confidence: { type: "number", description: "0..1 confidence in bias" },
                  rationale: { type: "string", description: "1-sentence reason" },
                },
                required: ["bias", "confidence", "rationale"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "directional_bias" } },
        }),
      });
      if (!res.ok) {
        if (res.status === 429) return { bias: 0, confidence: 0, rationale: "Rate limit" };
        if (res.status === 402) return { bias: 0, confidence: 0, rationale: "AI credits exhausted" };
        return { bias: 0, confidence: 0, rationale: `AI error ${res.status}` };
      }
      const j = await res.json() as {
        choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
      };
      const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) return { bias: 0, confidence: 0, rationale: "no tool call" };
      const parsed = JSON.parse(args) as AnalystOutput;
      return {
        bias: Math.max(-1, Math.min(1, Number(parsed.bias) || 0)),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        rationale: String(parsed.rationale || ""),
      };
    } catch (e) {
      console.error("[llmAnalyst] failed", e);
      return { bias: 0, confidence: 0, rationale: "LLM call failed" };
    }
  });
