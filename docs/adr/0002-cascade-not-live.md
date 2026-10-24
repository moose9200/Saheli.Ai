# ADR-0002: Cascaded speech (STT → LLM → TTS) for v1, Live API deferred

## Status
Proposed

## Date
2026-10-24

## Context

Two ways to build a voice companion on Gemini:

**Cascade** — browser or `gemini-3.5-transcribe` produces text, the companion
answers in text, `gemini-3.8-flash-*-tts` speaks it.

**Native audio** — `gemini-3.8-live` takes audio in and returns audio out, in one
model, with no text in between.

Native audio is the better *product*: it preserves the caller's own prosody and
emotion, handles interruptions natively, and its replies can mirror the caller's
energy. Google's own model notes call it "the default option for most low-latency
voice agent experiences".

But the requirement here is not generic voice-chat quality. It is **dialect
fidelity** — and that requirement pulls in a specific direction:

- Native audio chooses its own voice and delivery. There is no per-utterance
  prompt telling it to speak Marwari with a falling-then-level contour.
- The strongest *dialect* controls we have are text-side: Gemini TTS accepts a
  natural-language style instruction per call, and Indic-Speak exposes named
  native voices per language. Both are text-in.
- Voice-design and voice-replication personas (Gemini 3.8 TTS) can pin a region's
  accent. Those live in the TTS layer, not the Live layer.

So the cascade is not a shortcut here — it is where the dialect controls are.

## Decision

Ship the cascade in v1: `gemini-3.5-transcribe` (or browser Web Speech) →
`gemini-3.8-flash` with tools → dialect-profile-driven TTS.

Keep the speech layer behind `TtsProvider` / `SttProvider` interfaces so a Live
path can be added without touching the agent.

## Alternatives Considered

### `gemini-3.8-live` only
- Pros: best naturalness, native barge-in, lowest perceived latency.
- Cons: no per-utterance dialect instruction; the accent is whatever the model
  has; a Live WebSocket is materially harder to serve from Railway and to
  observe; cost per minute is higher than per-token flash turns.
- Rejected **for v1 only** — this is the likely end state, and the reason the
  interfaces exist.

### Hybrid: Live for conversation, cascade for scripted/dialect-critical turns
- Pros: best of both.
- Cons: two lifecycles, two cost models, two failure surfaces. Not justified
  before v1 has a listener panel.
- Deferred.

### Client-only Web Speech API
- Pros: zero cost, zero latency.
- Cons: Indian-language voice quality on Android/desktop browsers is exactly the
  flat, non-dialectal voice this product exists to fix. On-device voices vary by
  handset and carrier build.
- Rejected as the product; kept as the ≤ tier-4 fallback when a provider fails.

## Consequences

- **Latency budget is the sum of three hops**, so each must be individually
  measured. This is the main cost of the decision.
- **Round-trip through text loses prosody.** The caller's emotion is not carried
  into the reply. Mitigation: keep replies short and warm; do not attempt
  emotional mirroring we cannot actually do.
- **Barge-in must be implemented client-side** (stop audio on speech onset), since
  the server has no continuous audio stream.
- **Revisit trigger:** when the dialect eval (§7 of the design doc) is at target
  *and* first-audio latency is still above 1.2 s p50, evaluate `gemini-3.8-live`
  against the same eval. Adopt only if dialect authenticity does not regress.
