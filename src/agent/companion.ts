import { GoogleGenAI } from "@google/genai";
import { LANGUAGES, type DialectProfile } from "../indic/registry.js";
import { detectCrisis, type CrisisSignal } from "../safety/crisis.js";
import { executeTool, TOOL_DECLARATIONS, type ToolContext, type ToolResult } from "./tools.js";

/**
 * The companion is ONE agent.
 *
 * Not a crew, not a router over specialists. The product has one job — hold a
 * warm conversation in the user's own dialect and occasionally do a small
 * household task — and a single model with four tools does that job. Adding a
 * second agent would need a measured gain over this baseline (see
 * docs/adr/0001-single-agent.md), and no such measurement exists.
 *
 * The only split that is real: crisis detection runs BEFORE the model, in
 * parallel, deterministically. A safety net should not depend on a language
 * model choosing to call a tool.
 */

export const CHAT_MODEL = process.env.CHAT_MODEL ?? "gemini-3.8-flash";

/** Voice-first: short turns, no markdown, no lists — this text gets spoken. */
export const MAX_REPLY_SENTENCES = 3;

export function buildSystemPrompt(dialect: DialectProfile): string {
  const language = LANGUAGES[dialect.language];
  return [
    `You are Saheli, a warm companion for people in India. You speak ${language.name} (${language.nativeName}).`,
    ``,
    `WHO YOU ARE TALKING TO`,
    `${dialect.label} — ${dialect.region}.`,
    `${dialect.speakerPersona}`,
    ``,
    `HOW YOU SPEAK`,
    dialect.style,
    `Pitch: ${dialect.pitch}. Natural pace: about ${dialect.pace} syllables per second — do not drag.`,
    `Address the person as ${dialect.addressForms.join(" or ")}.`,
    dialect.lexicon.length ? `Word choices that mark this dialect: ${dialect.lexicon.join(", ")}.` : ``,
    dialect.avoid.length ? `Never sound like this: ${dialect.avoid.join("; ")}.` : ``,
    ``,
    `RULES`,
    `1. Reply in ${language.name}, in ${language.script}. Never answer in English unless the person did.`,
    `2. Your reply will be spoken aloud. At most ${MAX_REPLY_SENTENCES} short sentences. No markdown, no bullet points, no emoji, no stage directions.`,
    `3. You are a companion, not a doctor, lawyer or financial adviser. Never diagnose or give medical, legal or investment advice.`,
    `4. Never say you have remembered, saved, scheduled or sent anything unless a tool returned success. Memory needs the person's approval and you cannot grant it yourself.`,
    `5. If the person seems to be in danger, call escalateSafetyRisk immediately and then say one short, calm sentence offering help. Do not ask probing questions first.`,
    `6. Ask at most one question per turn, and only when it helps. Silence is allowed — company is the product, not information.`,
  ].filter((line) => line !== undefined).join("\n");
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface CompanionRequest {
  messages: ChatTurn[];
  dialectId?: string;
  context: ToolContext;
}

export interface CompanionReply {
  text: string;
  toolResults: ToolResult[];
  crisis: CrisisSignal;
  /** True when the deterministic net fired and short-circuited the model. */
  shortCircuited: boolean;
}

export interface ModelClientLike {
  models: {
    generateContent(args: unknown): Promise<{
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: { name?: string; args?: Record<string, unknown> };
          }>;
        };
      }>;
    }>;
  };
}

export class Companion {
  private readonly client: ModelClientLike;

  constructor(private readonly options: { client?: ModelClientLike; maxToolRounds?: number } = {}) {
    this.client = options.client ?? (new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" }) as unknown as ModelClientLike);
  }

  async reply(req: CompanionRequest): Promise<CompanionReply> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");

    // Deterministic net first. If it fires urgently we still return the model's
    // warmth-free short message: a hard-coded sentence in the right language is
    // more reliable in a crisis than waiting on a model round-trip.
    const crisis = detectCrisis(lastUser?.text ?? "");
    if (crisis.level === "urgent") {
      return { text: crisis.reply ?? "", toolResults: [], crisis, shortCircuited: true };
    }

    const system = buildSystemPrompt(req.context.dialect);
    const contents = req.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
    const toolResults: ToolResult[] = [];
    const maxRounds = this.options.maxToolRounds ?? 1;

    let text = "";

    for (let round = 0; round <= maxRounds; round++) {
      const response = await this.client.models.generateContent({
        model: CHAT_MODEL,
        contents,
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS as unknown as Record<string, unknown>[] }],
          temperature: 0.8,
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall?.name);

      if (calls.length === 0) {
        text = parts.map((p) => p.text ?? "").join("").trim();
        break;
      }

      if (round === maxRounds) break; // out of rounds: return what we have

      // Execute, then give the model its own tool results so the spoken reply
      // stays coherent ("मैंने दूध लिस्ट में डाल दिया").
      for (const call of calls) {
        try {
          toolResults.push(executeTool(call.functionCall!.name!, call.functionCall!.args ?? {}, req.context));
        } catch {
          // A rejected tool call must not kill the turn; the model gets no result
          // for it and rule 4 forbids claiming success.
        }
      }

      contents.push({ role: "model", parts: calls as never[] });
      contents.push({
        role: "user",
        parts: [{ text: `Tool results: ${JSON.stringify(toolResults)}` } as never],
      });
    }

    return { text, toolResults, crisis, shortCircuited: false };
  }
}

/** Trim to the spoken-length budget without cutting mid-word. */
export function clampSpokenReply(text: string, maxSentences = MAX_REPLY_SENTENCES): string {
  const sentences = text.match(/[^.!?।॥]+[.!?।॥]*/g) ?? [text];
  return sentences.slice(0, maxSentences).join("").trim();
}
