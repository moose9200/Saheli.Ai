# ADR-0005: The crisis net runs outside the model and answers without it

## Status
Proposed

## Date
2026-10-24

## Context

Saheli talks to Indian households including seniors, about their actual lives.
Some of those conversations will include self-harm, domestic violence, a medical
emergency, a financial scam, or danger to a child. The product's obligation is not
to handle this well; it is to not fail at it.

The obvious implementation is a tool (`escalateSafetyRisk`) the model calls when it
judges a risk. It is also the wrong one, for reasons that are structural rather
than a matter of prompt quality:

- **Availability.** If the model call fails, times out, or is rate-limited, the
  safety path fails with it. The moment someone needs it is the moment the
  provider is least likely to be healthy.
- **Latency.** A model round-trip before showing a helpline number adds a second
  to the worst second of someone's day.
- **Attribution.** A missed escalation becomes "the model decided not to", which is
  unauditable and un-testable against a fixed corpus.
- **Instruction conflict.** The persona prompt asks for warmth, brevity and
  companion-like restraint. Those are the right instincts for conversation and
  the wrong ones for a disclosure of harm. A single prompt carrying both will
  compromise one of them.
- **Coverage.** Detection needs to work in Devanagari, Latin-script Hinglish,
  Tamil, Telugu, Bengali and more. That is a keyword/stem problem, and it is
  testable in a way a model's judgement is not.

## Decision

**Detection is deterministic code that runs before the model, and it can answer
instead of the model.**

`detectCrisis()` in `src/safety/crisis.ts` returns `none | watch | urgent`:

- `urgent` → the companion returns the fixed reply + helplines and **never calls
  the model**. The test asserts `called === false`.
- `watch` → the turn proceeds, and the reply nudges without alarm.
- The same net runs on **STT transcripts** as well as typed text, because voice is
  the primary surface.

Detection uses two mechanisms, and the second exists because the first failed:

1. **Phrase lists** across scripts.
2. **Co-occurrence rules** — a life/death stem plus a negation anywhere in the
   utterance. The phrase list caught "जीना नहीं" and *missed* "और नहीं जीना चाहती",
   which is the same statement with the verb in a different position. Hindi and
   its relatives move negation freely; a phrase list cannot follow it. This was
   found by a test, not by review.

The model still has `escalateSafetyRisk` — as a *second* net for what keywords
cannot see, never as the first.

## Alternatives Considered

### Model-judged only (`escalateSafetyRisk` alone)
- Pros: handles paraphrase and novel phrasing; no keyword maintenance.
- Cons: fails exactly when it matters (outage, timeout, bad instruction
  trade-off), and cannot be certified against a corpus.
- Rejected as the primary net. Retained as the secondary.

### Model-judged *and* deterministic, in parallel, both required
- Pros: maximum caution.
- Cons: a model call on every turn before any reply — one extra latency hop on
  a 1.2 s budget, for a signal the deterministic net already covers.
- Rejected. Parallel, but the deterministic net is authoritative and can complete
  the turn alone.

### Third-party safety classifier
- Pros: trained, multilingual, maintained.
- Cons: an external dependency on the hot path for a non-negotiable function;
  added latency and cost; and a vendor whose failure means silence at the worst
  moment.
- Rejected for the primary path; noted as a candidate to *strengthen* the
  secondary net later.

## Consequences

- **False positives are a design choice, not a bug.** `watch` exists so mild hits
  nudge instead of shrieking. Target: ≤5% of ordinary turns.
- **Keyword coverage is now a maintenance burden with a release gate.** 18
  languages × 5 categories, with no native keyword coverage yet. This is the
  highest-priority open gap and is listed as such in the design doc.
- **Helplines are hard-coded facts.** They must be verified before every release;
  a wrong number is worse than no number.
- **The reply is fixed text, not generated.** It cannot drift into diagnosing
  ("you may be depressed") or into promises the system cannot keep. A test asserts
  no diagnostic vocabulary appears in it.
- **The net can be wrong in the direction of alarm.** Someone saying "मैं मर
  रहा हूँ" (exhausted, idiomatic) may see a helpline card. Accepted: the cost of
  that is embarrassment, and the cost of the opposite is not comparable.
