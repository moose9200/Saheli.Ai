# ADR-0001: One agent with four tools, not a multi-agent system

## Status
Proposed

## Date
2026-10-24

## Context

Saheli has one conversational job: hold a warm exchange in the caller's own
dialect, and occasionally do a small household task (remember a preference,
set a reminder, add to a shopping list, surface emergency help).

The reference implementation plan (`implementation_plan (1).md`) describes five
implementation steps, seven custom skills and a multi-surface product. None of
that requires more than one reasoning agent — but the plan's framing ("complete
agent skills suite", "agent skills", per-feature skills) makes it easy to arrive
at a crew of specialists by default.

What a multi-agent split would cost, concretely, on the hot path:

- every hop is another model call: +400–900 ms p50 each, before tools
- each hop re-reads context, so token cost multiplies on the turn that matters most
- a hand-off loses prosody and paralinguistic cues that a voice product depends on
- failure modes multiply: two agents can disagree, loop, or deadlock
- debugging moves from "read one prompt" to "reconstruct a conversation graph"

## Decision

**One agent.** `Companion` is a single class wrapping one `gemini-3.8-flash`
call, with four tool declarations. No planner, no router over specialists, no
delegation, no crew.

The only component allowed to answer without the model is the deterministic
crisis net, which is a safety interlock rather than an agent (ADR-0005).

## Alternatives Considered

### Multi-agent crew (planner + companion + household + safety specialists)
- Pros: each prompt stays short and focused; a specialist can be swapped alone.
- Cons: three to four extra round-trips per turn on a latency-critical voice
  product; safety as an *agent* is strictly worse than safety as code.
- Rejected: no measured gain exists, and the latency cost is immediate and large.

### Router over per-language agents
- Pros: a Marwari agent can be tuned without touching Tamil.
- Cons: dialect quality comes from the *dialect profile* and the TTS voice, not
  from a separate model instance. A profile is data; a router is infrastructure.
- Rejected: solves a problem the profile registry already solves for free.

### One agent, but with a sub-call per tool
- Pros: tool arguments get a focused prompt.
- Cons: doubles cost on exactly the turns users repeat daily.
- Rejected: `gemini-3.8-flash` emits valid arguments for four flat tools without help.

## Consequences

- **Latency:** one model call per turn, two when a tool fires (capped at one
  extra round). This is what makes the ≤1.2 s first-audio target reachable at all.
- **Cost:** the per-turn ceiling in the design doc is a one-model budget. A second
  agent would break it arithmetically, not marginally.
- **Debuggability:** one system prompt, one transcript, one place to look.
- **Debt accepted:** the prompt does three jobs at once (persona, dialect,
  behaviour). It will grow. When it exceeds roughly 1500 tokens, split by *prompt
  section*, not by agent.
- **Revisit trigger:** adopt a second agent only when a measured eval shows a
  specific dimension scoring below target *and* a specialist demonstrably fixes
  it on a blind test set. "The prompt is getting long" is not a trigger.
