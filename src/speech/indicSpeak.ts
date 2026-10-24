import type { DialectProfile } from "../indic/registry.js";
import { LANGUAGES } from "../indic/registry.js";
import type { SpeakRequest, SpeechClip, TtsProvider } from "./types.js";

/**
 * Indic-Speak — Bodhan AI / AI4Bharat, 3.36B, 22 scheduled Indian languages.
 *
 * Why this exists next to Gemini: Indic-Speak ships *protected native voices*
 * per language (Hindi `Kavya`/`Amit`, Maithili `Vaidehi`/`Madhukar`, …) and reads
 * code-mixed Hinglish naturally — "देख, honestly मुझे idea पसंद है" comes out as one
 * stream. That is the single hardest thing for a general model to fake.
 *
 * The catch, straight from its own model card, and the reason the dialect
 * registry picks the voice and not the caller:
 *   "Each voice can read different languages, but its original accent carries
 *    over. Start with a recommended native voice when that matters."
 * So drift between a profile's region and the voice's region produces a speaker
 * from the wrong place. We only claim support when the language has a native
 * voice listed.
 *
 * Also from the card: style control is "preview-quality … not yet consistent
 * enough to rely on". We therefore do NOT send the style prose — this provider
 * gets the voice and the text, and the accent fidelity comes from the voice.
 *
 * Licence: Indic Open Model License v1.0. Hosting the weights as a service for
 * third parties needs Bodhan's written approval, so we use their hosted API
 * rather than self-hosting a model on Railway.
 */

export const INDIC_SPEAK_BASE_URL = process.env.INDIC_SPEAK_BASE_URL ?? "https://api.bodhan.ai/v1";
export const INDIC_SPEAK_MODEL = process.env.INDIC_SPEAK_MODEL ?? "indic-speak";
export const INDIC_SPEAK_PRICE_PER_10K_CHARS_INR = 6;

export class IndicSpeakTtsProvider implements TtsProvider {
  readonly name = "indic-speak";
  readonly tier = 2 as const;

  supports(profile: DialectProfile): boolean {
    if (!process.env.INDIC_SPEAK_API_KEY) return false;
    return this.voiceFor(profile) !== null;
  }

  /** The native voice for the profile's language, or null when there is none. */
  voiceFor(profile: DialectProfile): string | null {
    const voices = LANGUAGES[profile.language].indicSpeakVoices;
    if (!voices || voices.length === 0) return null;
    // Registration order is [female, male] in the published voice table.
    return voices[0] ?? null;
  }

  async speak(req: SpeakRequest, profile: DialectProfile): Promise<SpeechClip> {
    const voice = req.voiceId ?? this.voiceFor(profile);
    if (!voice) throw new Error(`indic-speak: no native voice for ${profile.language}`);

    const response = await fetch(`${INDIC_SPEAK_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.INDIC_SPEAK_API_KEY}`,
      },
      body: JSON.stringify({
        model: INDIC_SPEAK_MODEL,
        input: req.text,
        voice,
        language: LANGUAGES[profile.language].code,
        response_format: "wav",
        speed: req.rate ?? 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`indic-speak: ${response.status} ${await response.text().catch(() => "")}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    return {
      audio,
      mimeType: "audio/wav",
      sampleRate: 24_000,
      provider: this.name,
      dialectId: profile.id,
      tier: this.tier,
    };
  }
}

/** Rough per-utterance cost. Used by the unit-economics check, not billing. */
export function estimateIndicSpeakCostInr(text: string): number {
  return (text.length / 10_000) * INDIC_SPEAK_PRICE_PER_10K_CHARS_INR;
}
