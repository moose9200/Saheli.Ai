import { getDialect, type DialectProfile } from "../indic/registry.js";
import { GeminiTtsProvider } from "./gemini.js";
import { IndicSpeakTtsProvider } from "./indicSpeak.js";
import type { SpeakRequest, SpeechClip, TtsProvider } from "./types.js";

/**
 * Provider routing.
 *
 * Order is fidelity first, not cost first: a native voice for the language beats
 * a prompt-directed accent, which beats nothing. The router walks the list and
 * returns the first provider that both claims support and succeeds. Every
 * failure is reported back so a silent downgrade never reaches the user as if it
 * were the real thing — `SpeechClip.tier` travels to the client.
 */
export class SpeechRouter {
  constructor(
    private readonly providers: TtsProvider[] = [
      new IndicSpeakTtsProvider(),
      new GeminiTtsProvider(),
    ],
  ) {}

  /** Which provider would serve this profile, without calling it. */
  plan(profile: DialectProfile): TtsProvider | null {
    return this.providers.find((p) => p.supports(profile)) ?? null;
  }

  async speak(req: SpeakRequest): Promise<SpeechClip> {
    const profile = getDialect(req.dialectId);
    const failures: string[] = [];

    for (const provider of this.providers) {
      if (!provider.supports(profile)) {
        failures.push(`${provider.name}: unsupported`);
        continue;
      }
      try {
        return await provider.speak(req, profile);
      } catch (error) {
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new Error(`no speech provider could serve ${profile.id} — ${failures.join(" | ")}`);
  }
}
