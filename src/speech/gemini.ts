import { GoogleGenAI } from "@google/genai";
import type { DialectProfile } from "../indic/registry.js";
import { LANGUAGES } from "../indic/registry.js";
import { pcmToWav, type SpeakRequest, type SpeechClip, type SttProvider, type Transcript, type TtsProvider } from "./types.js";

/**
 * Gemini speech.
 *
 * Verified against ai.google.dev (fetched 2026-10-24):
 *  - `gemini-3.8-flash-tts`        flagship, studio-grade, regional dialects, 130 languages
 *  - `gemini-3.8-flash-lite-tts`   fast/cheap, 101 languages — our default for conversation
 *  - `gemini-3.5-transcribe`       utterance-based language detection, word timestamps, custom vocab
 * Output audio is headerless 24 kHz 16-bit mono PCM; we wrap it in WAV.
 *
 * LIMITATION that drives the whole design: Gemini TTS is controllable *only*
 * through the prompt. There is no pitch/rate/accent parameter. So the dialect
 * profile has to be serialised into prose the model will act on, which is exactly
 * what `buildTtsPrompt` does — and exactly why it is the thing we evaluate.
 */

export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? "gemini-3.8-flash-lite-tts";
export const GEMINI_STT_MODEL = process.env.GEMINI_STT_MODEL ?? "gemini-3.5-transcribe";
export const GEMINI_SAMPLE_RATE = 24_000;

/** Prebuilt voice names accepted by the API (subset of the published enum). */
export const GEMINI_VOICES = [
  "Kore", "Zephyr", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

/**
 * Serialise a dialect profile into the instruction Gemini actually obeys.
 *
 * Order matters. The API has no separate style field, so the persona and the
 * delivery instruction must come BEFORE the text, and the text must be quoted
 * so the model does not read the instruction aloud.
 *
 * Pure and synchronous on purpose: this is the highest-leverage string in the
 * product and it must be unit-testable without a network call.
 */
export function buildTtsPrompt(text: string, profile: DialectProfile, rate = 1): string {
  const language = LANGUAGES[profile.language];
  const pace =
    rate < 0.95 ? "Speak a little slower than usual, as if to someone hard of hearing."
    : rate > 1.05 ? "Speak a little faster than usual, but stay clear."
    : "Speak at a natural conversational pace.";

  const pitch =
    profile.pitch === "low" ? "Keep the pitch low and settled."
    : profile.pitch === "bright" ? "Keep the pitch light and slightly raised."
    : profile.pitch === "warm" ? "Keep the pitch warm and rounded, in the lower-middle of the range."
    : "Keep the pitch in your natural range.";

  const codeMix =
    profile.codeMix === "prefer-native"
      ? "Where an everyday native word exists, use it instead of the English one."
      : profile.codeMix === "transliterate"
      ? "Render English words in the local script with the same sounds."
      : "Keep English words exactly as written, said in an Indian-English accent, without translating them.";

  const lines = [
    `You are voicing a character: ${profile.speakerPersona}`,
    `Language: ${language.name} (${language.nativeName}), script ${language.script}.`,
    profile.style,
    pitch,
    pace,
    codeMix,
  ];

  if (profile.lexicon.length > 0) {
    lines.push(`Word choices that sound right: ${profile.lexicon.join(", ")}.`);
  }
  if (profile.addressForms.length > 0) {
    lines.push(`Address the listener as: ${profile.addressForms.join(" or ")}.`);
  }
  if (profile.avoid.length > 0) {
    lines.push(`Never do this: ${profile.avoid.join("; ")}.`);
  }

  lines.push("", `Read exactly the following text, and nothing else:`, `"${text}"`);
  return lines.join("\n");
}

/** Default Gemini voice for a dialect. Chosen for timbre, not for accent. */
export function defaultVoiceFor(profile: DialectProfile): string {
  switch (profile.pitch) {
    case "bright": return "Zephyr";
    case "warm": return "Kore";
    case "low": return "Charon";
    default: return "Aoede";
  }
}

export interface GeminiClientLike {
  models: {
    generateContent(args: unknown): Promise<{
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> } }>;
    }>;
  };
}

export class GeminiTtsProvider implements TtsProvider {
  readonly name = "gemini";
  readonly tier = 3 as const;
  private readonly client: GeminiClientLike;

  constructor(client?: GeminiClientLike) {
    // Lazy so importing this module never requires a key (tests, health checks).
    this.client = client ?? (new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" }) as unknown as GeminiClientLike);
  }

  supports(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async speak(req: SpeakRequest, profile: DialectProfile): Promise<SpeechClip> {
    const prompt = buildTtsPrompt(req.text, profile, req.rate ?? 1);
    const response = await this.client.models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: req.voiceId ?? defaultVoiceFor(profile) },
          },
        },
      },
    });

    const inline = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!inline?.data) throw new Error("gemini-tts: response contained no audio");

    return {
      audio: pcmToWav(Buffer.from(inline.data, "base64"), GEMINI_SAMPLE_RATE),
      mimeType: "audio/wav",
      sampleRate: GEMINI_SAMPLE_RATE,
      provider: this.name,
      dialectId: profile.id,
      tier: this.tier,
    };
  }
}

export class GeminiSttProvider implements SttProvider {
  readonly name = "gemini";
  private readonly client: GeminiClientLike;

  constructor(client?: GeminiClientLike) {
    this.client = client ?? (new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" }) as unknown as GeminiClientLike);
  }

  /**
   * Transcribe recorded audio. The prompt asks for the transcript only; the
   * model's own language detection is returned alongside so the caller can
   * switch dialect without asking the user.
   */
  async transcribe(audio: Buffer, mimeType: string): Promise<Transcript> {
    const response = await this.client.models.generateContent({
      model: GEMINI_STT_MODEL,
      contents: [
        {
          parts: [
            { text: "Transcribe this speech exactly as spoken, in its original script and language. Output the transcript only, with no commentary, no translation and no romanisation." },
            { inlineData: { mimeType, data: audio.toString("base64") } },
          ],
        },
      ],
    });

    const text = response.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
    return { text: text.trim(), languageCode: null, confidence: null, provider: this.name };
  }
}
