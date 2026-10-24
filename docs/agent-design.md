# Companion agent — design

Status: **proposed**, not approved. Every number in §7 is a target; nothing here
is a measured result yet, because the app has not run against a live key.

---

## 1. What the agent is for

Saheli holds a conversation in the caller's own dialect and occasionally does a
small household task. That is the whole job. The product is *company*, not
information, which changes the design: a reply that is correct but sounds like a
Delhi newsreader has failed, even if every fact in it is true.

Success is therefore judged on three axes at once, and the third one is the one
that decides whether this ships:

| Axis | Question |
|---|---|
| Quality | Does it sound like a person from the caller's region, and is it safe? |
| Latency | Does the voice come back fast enough to feel like conversation? |
| Cost | Can a household use it daily on an Indian subscription price? |

## 2. Agent topology: one agent

```
user speech ──► STT ──► ┌──────────────────────────────┐ ──► TTS ──► audio
                        │  Companion (one model call)  │
                        │  gemini-3.8-flash            │
                        │  + 4 tools                   │
                        └──────────────────────────────┘
                                    ▲
             crisis net (deterministic, runs before the model)
```

One agent, one model, four tools. No planner, no router, no specialist crew, no
delegation. The reasoning is in [ADR-0001](adr/0001-single-agent.md) — the short
version is that a second agent has to earn its latency and cost, and nothing has
been measured that would let it.

The one genuine split is the crisis net: it is deterministic code that runs
*before* the model and can answer without it. That is not a second agent; it is a
safety interlock, and it is the only thing in the system allowed to bypass the
model ([ADR-0005](adr/0005-safety-outside-the-model.md)).

## 3. The loop

One turn, start to finish:

1. **Transcribe.** `/api/speech/stt` (`gemini-3.5-transcribe`). Browser Web Speech
   is used first when available; recorded audio is the fallback path.
2. **Screen.** `detectCrisis()` runs on the transcript. Urgent → return the fixed
   reply and helplines immediately, never call the model.
3. **Compose.** System prompt = dialect profile (persona, accent, pitch, pace,
   lexicon, address forms, anti-patterns) + six behavioural rules.
4. **Call.** `gemini-3.8-flash`, temperature 0.8, four tool declarations.
5. **Act.** Any `functionCall` is executed. `proposeMemoryFact` can only produce a
   *proposal*; nothing is written without user approval.
6. **Close the loop (max 1 extra round).** Tool results go back to the model so
   the spoken reply is coherent ("मैंने दूध लिस्ट में डाल दिया"). Capped at one
   round — see §7 for what that cap buys.
7. **Speak.** Dialect profile is serialised into a TTS instruction
   ([ADR-0003](adr/0003-dialect-profile.md)); provider chosen by fidelity tier
   ([ADR-0004](adr/0004-speech-providers.md)).
8. **Broadcast.** Household mutations emit one idempotent event to the tenant's
   socket room.

## 4. Model choice

| Slot | Model | Why this and not something bigger |
|---|---|---|
| Conversation | `gemini-3.8-flash` | Dialect quality is carried by the prompt and the TTS voice, not by reasoning depth. A Pro-class model costs multiples per turn for a gain nobody has demonstrated on "how was your day". |
| TTS (default) | `gemini-3.8-flash-lite-tts` | Prompt-directed accent/pitch/pace; 101 languages; cheap enough for daily use. |
| TTS (fidelity) | `gemini-3.8-flash-tts` | Studio-grade, regional dialects, 130 languages — reserved for the profile a user actually settles on, or for onboarding. |
| TTS (native voice) | Indic-Speak (Bodhan AI / AI4Bharat) | Protected native speakers per language and natural code-mixed Hinglish. Best accent fidelity for the 13 production languages. |
| STT | `gemini-3.5-transcribe` | Utterance-level language detection + custom vocabulary biasing, which is what code-mixed speech needs. |

Verified on ai.google.dev (fetched 2026-10-24). The 2.5-family models are now
gated to prior users; new work must use 3.5 Flash-Lite / 3.8 Flash.

**Upgrade trigger, written down so it is not a vibe:** move a slot up a tier only
when the eval in §8 shows a ≥0.3 MOS-equivalent gain on the dialect set *and* the
per-turn cost stays inside the §7 ceiling. Until then the cheaper model is the
correct choice.

## 5. Tools and permissions

Four tools. Each row states what stops it being abused, because that is the only
interesting part of a tool definition.

| Tool | Writes? | Permission fence |
|---|---|---|
| `proposeMemoryFact` | **No** | Returns a pending proposal. The agent cannot self-grant memory consent; the user taps approve. DPDP Act 2023 needs specific, revocable consent. |
| `createHouseholdReminder` | Yes, tenant-scoped | Reversible, visible, scoped to the caller's household. `when` must parse to a real date or the call is rejected. |
| `updateShoppingList` | Yes, tenant-scoped | Same fence. Empty adds rejected. |
| `escalateSafetyRisk` | No | Can only *show* helplines. It can never call, message or book anything on the user's behalf. |

No tool can read another tenant. No tool can send money, contact a third party,
or write to the open web. A fifth tool needs its own threat note first.

## 6. Memory and human-in-the-loop

Three tiers, deliberately separated because the risk is not the same:

1. **Session transcript** — ephemeral, never used to train, never shown to family
   members even inside the same household.
2. **Approved memory** — only what the user tapped approve on. Inspectable,
   editable, deletable, exportable as JSON.
3. **Household shared state** — reminders and the shopping list. Shared by
   design; still not the transcripts.

Checkpoints where the human decides:

- **Before memory persists** — always. There is no path from a model call to a
  stored personal fact.
- **Before a safety escalation contacts anyone** — there is no such path at all;
  escalation only renders a phone number.
- **Before cross-tenant access** — `x-tenant-id` is checked per request and
  fails closed (403) when unknown.

## 7. Targets

Stated before any measurement, so they can be disproved.

| Dimension | Target | Basis |
|---|---|---|
| First audio byte | **≤ 1.2 s** p50, ≤ 2.0 s p95 on 4G | STT on device + one flash turn + TTS streaming. Indic-Speak reports ~200 ms TTS TTFB. |
| Full reply audio | ≤ 3.5 s p50 for a 3-sentence reply | Derived from the clip budget, not measured. |
| Cost per turn | **≤ ₹0.35** (~$0.004) at 3 sentences in / 3 out | Ceiling set by the ₹99–199/mo consumer tier; vendor unit prices still to be fetched and pinned. Indic-Speak alone is ₹6 / 10k chars ≈ ₹0.02 a reply. |
| Daily cost per active household | ≤ ₹10 (30 turns/day) | Follows from the per-turn ceiling. |
| Comprehension | ≥ 95% of replies understood on first hearing, per language | Listener panel. Proxy: WER of the reply re-transcribed. |
| Dialect authenticity | ≥ 4.0 / 5 mean listener score, ≥ 4.0 for the target region specifically | Native-speaker panel, blind. This is the number that decides the product. |
| Safety recall | 100% on the fixed crisis corpus, per script | Non-negotiable. Any miss is a release blocker. |
| Safety false-positive | ≤ 5% of ordinary turns | Above this, the net becomes wallpaper people click past. |
| Cross-tenant leakage | 0 | Automated suite. |

Every one of these is currently **unmeasured**. That is the honest state.

## 8. Failure modes

| Failure | Effect | Mitigation | Residual risk |
|---|---|---|---|
| Dialect drifts toward standard Hindi mid-conversation | Sounds foreign; the whole premise collapses | Profile restated in every system prompt, not just turn 1; TTS instruction rebuilt per utterance | **High.** No mechanism proves the model still obeys on turn 20. Needs a per-turn check. |
| Model reads the style instruction aloud | Nonsense audio | Text is quoted last and labelled | Low |
| Crisis phrase in a dialect we have no keywords for | False negative | Co-occurrence stems, not just phrases; multiple scripts | **High** — 18 languages, no native keyword coverage yet. Highest-priority gap. |
| Provider quota / outage | Silence | Fallback chain, tier reported to client | Medium |
| Silent downgrade to a worse voice | Users hear a bad accent without knowing why | `x-speech-tier` header, `SpeechClip.tier` | Low |
| Tool call claims success it did not have | User trusts a reminder that never existed | Rule 4 + tool errors swallowed (no result → no claim) | Medium |
| Someone else's household reminder appears | Privacy breach | Tenant-bound sockets, fail-closed guard | Medium until the membership table exists |
| Long monologue (model ignores the 3-sentence rule) | Bad in voice, expensive | `clampSpokenReply` hard-trims | Low |
| Unreviewed accent ships as "authentic" | Trust damage, cultural harm | `reviewedBy` gate, `dialectsReviewed` in `/api/health` | Medium — currently 0 reviewed, by design |

## 9. What is deliberately not built

Named so nobody assumes it exists:

- No frontend. The API and the agent are real; the PWA is not started.
- No database. Tenant guard is a fail-closed stub; memories are not persisted.
- No auth. Google OAuth variables are configured in Railway, unused by code.
- No second agent, and no plan for one until ADR-0001's trigger is met.
- No Live API. Deliberately deferred — see ADR-0002.
- No dialect with a native speaker's sign-off. All nine are unvalidated.

## 10. Before this can be called approved

1. Nine dialects listened to by native speakers; `reviewedBy` filled or the
   profile deleted. This is the gate the whole product turns on.
2. The §7 latency and cost numbers measured on a live key, not estimated.
3. Crisis corpus expanded to every supported script, with recall measured.
4. A measured eval harness that scores dialect authenticity blind.

Until 1–4 exist, this document describes intent. It does not certify quality.
