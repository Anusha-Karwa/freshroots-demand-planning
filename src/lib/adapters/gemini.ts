import { GoogleGenAI } from "@google/genai";
import { integrationMode } from "@/lib/integrations";

/**
 * Gemini writes words, never numbers that drive orders. Callers pass the facts the
 * rules engine already computed plus a template fallback; mock mode returns the fallback.
 */
export interface ExplainRequest {
  instruction: string; // what to write, e.g. "2-line reason for the flag"
  facts: Record<string, unknown>; // the numbers behind the flag
  fallback: string; // template text used in mock mode or on any AI error
}

export interface ExplainResult {
  text: string;
  source: "gemini" | "template";
}

const SYSTEM = `You explain inventory flags to a demand planner at an FMCG distributor in India.
Use only the facts given. Do not suggest or change any order quantity. Plain English, at most 2 short sentences.`;

export async function explain(req: ExplainRequest): Promise<ExplainResult> {
  if (integrationMode("gemini") !== "live") return { text: req.fallback, source: "template" };
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL!,
      contents: `${req.instruction}\n\nFacts (JSON):\n${JSON.stringify(req.facts)}`,
      config: { systemInstruction: SYSTEM, temperature: 0.2, maxOutputTokens: 200 },
    });
    const text = res.text?.trim();
    return text ? { text, source: "gemini" } : { text: req.fallback, source: "template" };
  } catch (err) {
    console.error("[gemini] falling back to template:", err);
    return { text: req.fallback, source: "template" };
  }
}
