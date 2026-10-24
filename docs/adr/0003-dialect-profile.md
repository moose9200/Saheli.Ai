# ADR-0003: The dialect profile is the product artifact, and a native speaker must sign it

## Status
Proposed

## Date
2026-10-24

## Context

The requirement is that Saheli's dialect, accent, tone, pitch and language land
*very close* to local regional speech. That is not a feature you add at the end;
it is the thing that decides whether the product is real.

The naive implementation is a language code. `hi-IN` goes into the TTS call and
you get a fluent, accentless Hindi that sounds like a Delhi news bulletin. Nobody
in Jodhpur hears a person; they hear a machine reading Hindi at them. The same
failure repeats in every language: `ta-IN` is not a Chennai grandmother.

What actually distinguishes a regional variety, in the order the ear notices it:

1. **Lexicon and morphology.** Marwari `म्हारो` / `छे`, Bhojpuri `बा` / `रउरा`,
   Marathi `बरं` / `नक्की`. Get these wrong and no amount of accent work saves it.
2. **Prosody.** Marwari lands soft and drawn-out; Bhojpuri rises at clause ends;
   Tamil in Chennai stays even and resists the film-dialogue drawl. Pitch range,
   declination, and where the fall happens.
3. **Code-mix behaviour.** Urban Hinglish is one stream — "मतलब, honestly मुझे
   idea पसंद है" — with no pause at the switch. Forcing translation breaks it.
4. **Accent, narrowly.** Retroflexion, vowel length, consonant attack.
5. **Register.** Who the speaker is talking *to*, encoded in address forms
   (आप / तुम / थे / रउरा / தங்கள்).

A language code encodes none of 1–5.

## Decision

**The dialect profile is the unit of design, and it is data, not code.**

`DialectProfile` (in `src/indic/registry.ts`) carries: persona, region, a prose
`style` written the way you would brief a voice actor, target `pitch`, target
`pace` in syllables/second, a `codeMix` policy, a `lexicon`, `addressForms`, and an
explicit `avoid` list of things that instantly read as foreign.

Each speech provider compiles the same profile into whatever it can control:

| Provider | Controls available | What the profile becomes |
|---|---|---|
| Gemini TTS | prompt only — no pitch/rate/accent params | `buildTtsPrompt()` serialises persona + style + pitch + pace + lexicon + avoid, then quotes the text last |
| Indic-Speak | named native voices; style is preview-quality | the profile selects the **native voice**; style prose is deliberately not sent |
| Browser Web Speech | rate only | profile is not honoured; tier 4, never the product |

Two consequences that are load-bearing:

**a) A native voice beats a prompted accent.** The fidelity ladder is
1. a consented recording of a local speaker → 2. a model with a protected native
voice for that language → 3. a prompt-directed accent on a general model →
4. browser speech. The router walks this order (ADR-0004).

**b) A profile nobody has listened to is not a profile.** Every profile carries
`reviewedBy`, `null` until a native speaker has heard it and approved. `/api/health`
reports `dialectsReviewed`, and it is **0** today. An unreviewed accent must never
be presented to a user as authentic — that is both a quality failure and a
cultural one.

## Alternatives Considered

### Language code only (`hi-IN`)
- Pros: one line, works today, ships.
- Cons: produces exactly the accentless-broadcast voice the product exists to
  replace. In a companionship product, "sounds like a call-centre IVR" is a
  product failure, not a polish item.
- Rejected.

### Fine-tune a TTS model per dialect
- Pros: highest possible ceiling for accent.
- Cons: needs hours of consented regional speech per dialect (Marwari, Bhojpuri
  have thin corpora), GPU inference on the hot path, and a training loop per
  variant. Nobody has measured that a prompt cannot get close enough yet.
- Deferred: the correct *second* step, after the prompt baseline is measured.
  If prompt-directed fidelity plateaus below 4.0/5, this becomes ADR-0006.

### Voice cloning of a single "Saheli" voice into every dialect
- Pros: brand consistency.
- Cons: a cloned Hindi speaker reading Marwari is the worst of both — wrong
  prosody delivered confidently. Also heavier consent obligations.
- Rejected.

## Consequences

- **Adding a language is cheap; adding a dialect is expensive.** Correct — the
  expensive part is the listener panel, and pretending otherwise is how you ship
  a fake accent.
- **Profiles will drift.** The system prompt restates the profile every turn
  because models drift toward standard registers over a long conversation. There
  is no per-turn proof of compliance yet; this is the design's largest open
  quality risk and it is recorded as such in the design doc.
- **The eval is a listening test, not a unit test.** The unit tests here prove the
  profile *reaches* the provider intact. Only a native panel can score whether it
  sounds right.
- **Release gate:** a dialect cannot be listed as supported in the UI while
  `reviewedBy` is null. Wire this into CI before the first release.
