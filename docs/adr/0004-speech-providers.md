# ADR-0004: Provider-agnostic speech with an honest fidelity tier

## Status
Proposed

## Date
2026-10-24

## Context

Two speech providers are viable today, with genuinely different strengths:

- **Gemini 3.8 Flash / Flash-Lite TTS** — 101–130 languages including regional
  dialects, controllable *only* through a natural-language prompt, 24 kHz WAV,
  managed, no GPU, cheap per character.
- **Indic-Speak** (Bodhan AI / AI4Bharat, 3.36B) — 22 scheduled Indian languages,
  95 voices with **protected native speakers per language**, and natural
  code-mixed Hinglish. ~200 ms TTS TTFB. Hosted API, ₹6 / 10k characters.

Indic-Speak's own model card states the constraint that makes routing non-obvious:
*"Each voice can read different languages, but its original accent carries over.
Start with a recommended native voice when that matters."* And its style control is
*"preview-quality … not yet consistent enough to rely on."*

So the two providers fail in different ways: Gemini can be *told* an accent but
has no protected native persona; Indic-Speak *has* native personas but cannot be
told a style. Neither is uniformly better.

## Decision

A `TtsProvider` interface with a **fidelity tier**, and a router that walks tiers
in order, returning the first provider that both claims support and succeeds.

```
IndicSpeakTtsProvider  tier 2  — only when the language has a native voice
GeminiTtsProvider      tier 3  — prompt-directed, always available with a key
(browser Web Speech)   tier 4  — client-side fallback, never presented as the product
```

The tier travels to the client (`SpeechClip.tier`, `x-speech-tier`), so a
downgrade is visible rather than silent.

`supports()` is a *cheap, offline capability check* — no network. Indic-Speak
returns true only when the profile's language has a listed native voice, which is
what keeps a Marwari profile from being served by a Hindi speaker and calling it
Marwari.

## Alternatives Considered

### Single provider (Gemini only)
- Pros: one integration, one bill, one failure mode.
- Cons: gives up the native-voice tier, which is the best accent fidelity we have
  for the 13 production languages. For a product whose premise is authenticity,
  that is giving up the main advantage.
- Rejected.

### Single provider (Indic-Speak only)
- Pros: best voices for major Indian languages.
- Cons: no Marwari, Bhojpuri, Tulu, or any non-scheduled variety. Style is
  unreliable, so tone control is lost. Licence: hosting the *weights* as a service
  for third parties needs Bodhan's written approval, so we must stay on their API
  and inherit its availability and pricing.
- Rejected as sole provider.

### Self-host Indic-Speak on Railway
- Pros: fixed cost, no per-character billing, data stays in our infra.
- Cons: needs a GPU; Railway GPU availability and cold-start make this a bad fit
  for a latency-critical idle-heavy workload. Plus the licence approval above.
- Rejected for v1; revisit only if volume makes per-character billing dominant.

### Speak in the user's detected language, one voice everywhere
- Pros: simplest.
- Cons: one "Indian" voice across 18 languages is the fake-accent failure mode.
- Rejected.

## Consequences

- **Two integrations to maintain**, two sets of credentials, two latency profiles.
  Accepted because the fidelity gain is the product.
- **Fallback can silently change the voice the user hears.** Mitigated, not
  eliminated: the tier header is exposed, and the UI is expected to keep the voice
  stable per household rather than per utterance.
- **Cost model is split**: per-character for Indic-Speak, per-token for Gemini.
  The unit-economics check must account for both.
- **Routing is per-profile, not per-request.** A provider outage degrades a whole
  dialect, not one turn — that is the correct granularity but it means an outage
  is audible.
- **Open item:** the Indic-Speak request shape here (`POST /v1/audio/speech`,
  OpenAI-compatible) is inferred from the vendor's published "OpenAI-compatible
  request shapes" and has **not** been verified against a live key. Verify before
  relying on it.
