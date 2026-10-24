import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { geminiModel, mode } from "@/lib/integrations";

/**
 * Gemini explains; it never decides. It receives the numbers the rules engine already computed and returns
 * (a) a plain-English reason of at most 2 lines and (b) whether the case looks unusual enough for Raghav's
 * exceptions queue. The response schema has no quantity field, and anything malformed falls back to the
 * template reason.
 */

export interface ExplainInput {
  skuId: string;
  name: string;
  category: string | null;
  flags: string[];
  exceptions: string[];
  metrics: Record<string, unknown>;
  template: string; // the rule-based reason: the facts Gemini must stay within
  context: string[]; // festival / competitor scheme notes for the period
}

export interface Explanation {
  skuId: string;
  reason: string;
  unusual: boolean;
  note: string;
  source: "gemini" | "template";
}

const SYSTEM = `You help Raghav, the senior demand planner at Freshroots (an FMCG distributor in Maharashtra and Goa).
A rules engine has already flagged each SKU and computed every number. For each item:
- "reason": at most 2 short sentences in plain English explaining why it was flagged, using ONLY the numbers given.
  Never invent numbers. Never suggest, change or mention an order quantity.
- "unusual": true only if the facts suggest the rules may be wrong for this SKU (for example the flag contradicts the
  recent trend, demand is erratic, the festival uplift alone creates the flag, or a competitor scheme may explain the change).
- "note": one sentence saying why it looks unusual, or "" when it doesn't.
Return one entry per input item, with the same skuId.`;

const replySchema = z.object({
  items: z.array(z.object({
    skuId: z.string(),
    reason: z.string().min(5).max(500),
    unusual: z.boolean(),
    note: z.string().max(400).default(""),
  })),
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skuId: { type: "string" },
          reason: { type: "string" },
          unusual: { type: "boolean" },
          note: { type: "string" },
        },
        required: ["skuId", "reason", "unusual", "note"],
      },
    },
  },
  required: ["items"],
};

/** Parses Gemini's reply; null if it isn't valid. Exported for tests. */
export function parseReply(text: string | undefined): z.infer<typeof replySchema>["items"] | null {
  if (!text) return null;
  try {
    const parsed = replySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}

/** Drops anything that looks like Gemini sneaking in a quantity recommendation. */
const mentionsOrderQty = (s: string) => /\b(order|reorder|buy|purchase)\s+(of\s+)?\d/i.test(s);

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

const BATCH = 12;
const PARALLEL = 3;

/** Explains a list of flagged SKUs. Mock mode (no key) or any failure → template reasons, nothing routed. */
export async function explainFlags(items: ExplainInput[]): Promise<{ results: Explanation[]; source: "gemini" | "template"; errors: string[] }> {
  const fallback = (i: ExplainInput): Explanation => ({ skuId: i.skuId, reason: i.template, unusual: false, note: "", source: "template" });
  if (mode("gemini") !== "live" || !items.length) return { results: items.map(fallback), source: "template", errors: [] };

  const batches: ExplainInput[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const errors: string[] = [];
  const results = new Map<string, Explanation>();

  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        for (const r of await callGemini(batch)) results.set(r.skuId, r);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));

  const out = items.map((i) => results.get(i.skuId) ?? fallback(i));
  return { results: out, source: out.some((r) => r.source === "gemini") ? "gemini" : "template", errors };
}

async function callGemini(batch: ExplainInput[]): Promise<Explanation[]> {
  const payload = batch.map((i) => ({
    skuId: i.skuId, name: i.name, category: i.category, flags: i.flags, exceptions: i.exceptions,
    numbers: i.metrics, ruleSummary: i.template, marketContext: i.context,
  }));
  const config = {
    systemInstruction: SYSTEM,
    temperature: 0.2,
    // Gemini 3 "thinking" counts against the output budget; keep it low and leave plenty of room.
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    responseJsonSchema: RESPONSE_SCHEMA,
  };
  const contents = `Explain these flagged SKUs.\n${JSON.stringify(payload)}`;
  let res;
  try {
    res = await ai().models.generateContent({ model: geminiModel(), contents, config: { ...config, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } });
  } catch (err) {
    // Older models reject thinkingLevel; retry once without it.
    if (!/thinking/i.test(String(err))) throw err;
    res = await ai().models.generateContent({ model: geminiModel(), contents, config });
  }
  const items = parseReply(res.text);
  if (!items) throw new Error(`Gemini returned an unreadable reply (finish reason: ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
  const wanted = new Set(batch.map((b) => b.skuId));
  return items
    .filter((i) => wanted.has(i.skuId) && !mentionsOrderQty(i.reason))
    .map((i) => ({ skuId: i.skuId, reason: i.reason.trim(), unusual: i.unusual, note: i.unusual ? i.note.trim() : "", source: "gemini" as const }));
}

/** One tiny call to prove the key and model work (Integrations page / check script). */
export async function pingGemini() {
  const res = await ai().models.generateContent({ model: geminiModel(), contents: "Reply with the single word OK.", config: { maxOutputTokens: 256 } });
  return (res.text ?? "").trim();
}
