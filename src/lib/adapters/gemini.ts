import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { integrationMode } from "@/lib/integrations";

/**
 * Gemini writes words, never numbers that drive orders. It gets the facts the rules engine already
 * computed and returns (a) a 2-line reason and (b) whether the case looks unusual enough for Raghav's
 * exceptions queue. Its output schema has no quantity field, and any failure falls back to the template.
 */

const SYSTEM = `You explain demand-planning flags to Raghav, a senior demand planner at an Indian FMCG distributor.
Rules (not you) already decided the flag and the order quantity. Use only the facts given; never invent numbers,
never suggest or change a quantity. Write at most 2 short sentences in plain English.
Set "unusual" to true only if the facts look like a case the rules may get wrong (e.g. the flag contradicts the
trend, demand is erratic, or a festival uplift seems to drive the flag on its own) and say why in one sentence.`;

const reviewSchema = z.object({
  reason: z.string().min(10).max(400),
  unusual: z.boolean(),
  unusualWhy: z.string().max(300).default(""),
});

const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "At most 2 short sentences explaining the flag from the facts." },
    unusual: { type: "boolean" },
    unusualWhy: { type: "string", description: "One sentence, empty when not unusual." },
  },
  required: ["reason", "unusual", "unusualWhy"],
};

export interface FlagReview {
  reason: string;
  unusual: boolean;
  unusualWhy: string;
  source: "gemini" | "template";
}

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! }));

type GenConfig = NonNullable<Parameters<GoogleGenAI["models"]["generateContent"]>[0]["config"]>;

/**
 * Gemini 3.x models "think" before answering, and that thinking counts against maxOutputTokens (at 400 tokens
 * the reply was cut off mid-JSON). Thinking is kept LOW (GEMINI_THINKING_LEVEL to change it); a model that
 * doesn't accept the setting is retried without it.
 */
async function generate(contents: string, config: GenConfig) {
  const level = (process.env.GEMINI_THINKING_LEVEL || "LOW").toUpperCase();
  const withThinking = { ...config, thinkingConfig: { thinkingLevel: level as never } };
  try {
    return await ai().models.generateContent({ model: process.env.GEMINI_MODEL!, contents, config: withThinking });
  } catch (err) {
    if (!/thinking/i.test(err instanceof Error ? err.message : String(err))) throw err;
    return ai().models.generateContent({ model: process.env.GEMINI_MODEL!, contents, config });
  }
}

/** Parses Gemini's JSON reply; null if it isn't what we asked for. Exported for tests. */
export function parseReview(text: string | undefined): Omit<FlagReview, "source"> | null {
  if (!text) return null;
  try {
    const r = reviewSchema.safeParse(JSON.parse(text));
    return r.success ? { reason: r.data.reason.trim(), unusual: r.data.unusual, unusualWhy: r.data.unusualWhy.trim() } : null;
  } catch {
    return null;
  }
}

/** Reason + "looks unusual?" for one flag. Mock mode (no key) returns the template and never routes. */
export async function reviewFlag(facts: Record<string, unknown>, fallback: string): Promise<FlagReview> {
  const template: FlagReview = { reason: fallback, unusual: false, unusualWhy: "", source: "template" };
  if (integrationMode("gemini") !== "live") return template;
  try {
    const res = await generate(`Explain this flag.\n\nFacts (JSON):\n${JSON.stringify(facts)}`, {
      systemInstruction: SYSTEM,
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_JSON_SCHEMA,
    });
    const parsed = parseReview(res.text);
    if (!parsed)
      console.error(`[gemini] unusable reply (finish: ${res.candidates?.[0]?.finishReason ?? "?"}) — using the template:`, res.text?.slice(0, 200));
    return parsed ? { ...parsed, source: "gemini" } : template;
  } catch (err) {
    console.error("[gemini] falling back to template:", err instanceof Error ? err.message : err);
    return template;
  }
}

/** A short note on why an exception looks unusual. Mock mode returns the template. */
export async function noteException(facts: Record<string, unknown>, fallback: string): Promise<{ text: string; source: "gemini" | "template" }> {
  if (integrationMode("gemini") !== "live") return { text: fallback, source: "template" };
  try {
    const res = await generate(
      `This SKU was sent to the planner's judgement queue. In at most 2 short sentences, say what looks unusual and what to check.\n\nFacts (JSON):\n${JSON.stringify(facts)}`,
      { systemInstruction: SYSTEM, temperature: 0.2, maxOutputTokens: 1024 },
    );
    const text = res.text?.trim();
    return text && text.length <= 500 ? { text, source: "gemini" } : { text: fallback, source: "template" };
  } catch (err) {
    console.error("[gemini] falling back to template:", err instanceof Error ? err.message : err);
    return { text: fallback, source: "template" };
  }
}

/** Run async work over items with at most `limit` in flight (keeps within Gemini rate limits). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
