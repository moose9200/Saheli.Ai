# SaheliAI

A multilingual voice companion for Indian households — built dialect-first.

The product is company, not information. That makes accent, tone, pitch and
lexicon the core engineering problem, not a finishing touch: a reply that is
correct but sounds like a Delhi newsreader has failed.

## What exists today

A working API and agent. No frontend, no database, no auth.

| Endpoint | What it does |
|---|---|
| `GET /api/health` | Liveness + which providers are configured + how many dialects a native speaker has approved |
| `GET /api/dialects` | 18 languages, 9 dialect profiles, helplines |
| `POST /api/chat` | One companion turn; returns reply + tool results + crisis signal |
| `POST /api/speech/tts` | Text → WAV in a chosen dialect; reports which provider and fidelity tier served it |
| `POST /api/speech/stt` | Recorded audio → transcript, with the crisis net applied |
| `WS /ws?tenant=` | Household sync room, server-authoritative and tenant-bound |

## Run it

```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY
npm run dev               # http://localhost:3000
npm test                  # 27 tests, no network, no key needed
npm run typecheck
```

## Try it

```bash
curl -s localhost:3000/api/health

curl -s -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","text":"कल सुबह दूध लाना याद दिलाना"}],"dialectId":"hi-in-delhi"}'

curl -s -X POST localhost:3000/api/speech/tts \
  -H 'content-type: application/json' \
  -d '{"text":"थे कनै जा रह्या हो?","dialectId":"hi-in-marwari"}' -o out.wav
```

## How dialect fidelity works

A language code is not a voice. `hi-IN` produces accentless broadcast Hindi that
nobody in Jodhpur hears as a person.

So the unit of design is a **DialectProfile** — persona, region, accent
description, target pitch, target pace in syllables/second, code-mix policy,
dialect lexicon, address forms, and an explicit list of things that instantly read
as foreign. Providers compile the same profile into whatever they can control; see
[docs/adr/0003](docs/adr/0003-dialect-profile.md).

Fidelity ladder, highest first:

1. A consented recording of a local speaker
2. A model with a **protected native voice** for that language — Indic-Speak
3. A **prompt-directed accent** on a general model — Gemini 3.8 TTS
4. Browser Web Speech — fallback, never the product

`/api/speech/tts` returns `x-speech-tier`, so a downgrade is visible instead of
silent.

> **Every dialect profile is currently `reviewedBy: null`.** `/api/health` reports
> `dialectsReviewed: 0`. A profile nobody native has heard is not authentic yet,
> and the UI must not claim otherwise.

## Architecture

- **One agent.** `gemini-3.8-flash`, four tools, no crew
  ([ADR-0001](docs/adr/0001-single-agent.md)).
- **Cascaded speech** — STT → LLM → TTS, which is where the dialect controls live
  ([ADR-0002](docs/adr/0002-cascade-not-live.md)).
- **Provider-agnostic speech** with an honest fidelity tier
  ([ADR-0004](docs/adr/0004-speech-providers.md)).
- **Crisis detection outside the model**, deterministic, can answer alone
  ([ADR-0005](docs/adr/0005-safety-outside-the-model.md)).

Full design, targets and failure modes: [docs/agent-design.md](docs/agent-design.md).

## Tools the agent has

| Tool | Writes? | Fence |
|---|---|---|
| `proposeMemoryFact` | No | Creates a proposal the user must approve — DPDP Act 2023 consent |
| `createHouseholdReminder` | Yes | Household-scoped, reversible; unparseable times rejected |
| `updateShoppingList` | Yes | Household-scoped |
| `escalateSafetyRisk` | No | Can only show helplines, never contact anyone |

## Safety

Crisis detection covers self-harm, domestic abuse, medical emergency, financial
coercion and child safety, across Devanagari, Latin-script Hinglish, Tamil,
Telugu and Bengali. It catches negation in any word order ("जीना नहीं" *and*
"नहीं जीना चाहती"), which a phrase list alone does not.

Helplines: Tele-MANAS `14416`, KIRAN `1800-599-0019`, Emergency `112`, Women's
Helpline `181`, Childline `1098`, Cyber Crime `1930`.

This is triage, not diagnosis. It never tells anyone what is wrong with them.

## Deploy

Railway. `railway.json` sets the healthcheck to `/api/health`. Push to `main`.

```bash
railway variables --service app --set "GEMINI_API_KEY=<key>"
```

## Not built yet

Frontend/PWA · database · auth · Live API voice · any native-speaker sign-off ·
measured latency, cost or dialect quality. See §9–10 of the design doc.
