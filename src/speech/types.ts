import type { DialectProfile } from "../indic/registry.js";

export interface SpeakRequest {
  /** What to say. Already in the target language/script. */
  text: string;
  dialectId?: string;
  /** Provider-specific voice override. */
  voiceId?: string;
  /** Speaking-rate multiplier applied on top of the profile's natural pace. */
  rate?: number;
}

export interface SpeechClip {
  audio: Buffer;
  mimeType: "audio/wav";
  sampleRate: number;
  provider: string;
  dialectId: string;
  /** Which fidelity tier produced this clip. Surfaced to the client so the UI can be honest. */
  tier: 1 | 2 | 3 | 4;
}

export interface Transcript {
  text: string;
  languageCode: string | null;
  confidence: number | null;
  provider: string;
}

export interface TtsProvider {
  readonly name: string;
  readonly tier: 1 | 2 | 3 | 4;
  /** Cheap capability check — no network. */
  supports(profile: DialectProfile): boolean;
  speak(req: SpeakRequest, profile: DialectProfile): Promise<SpeechClip>;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Buffer, mimeType: string): Promise<Transcript>;
}

/**
 * Wrap raw little-endian 16-bit mono PCM in a RIFF/WAVE container.
 * Gemini TTS returns headerless PCM; browsers and <audio> need the header.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);           // PCM fmt chunk size
  header.writeUInt16LE(1, 20);            // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
