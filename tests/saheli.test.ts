import { test } from "node:test";
import assert from "node:assert/strict";

import { DIALECTS, LANGUAGES, getDialect, approvedDialects } from "../src/indic/registry.js";
import { detectCrisis } from "../src/safety/crisis.js";
import { executeTool, TOOL_DECLARATIONS } from "../src/agent/tools.js";
import { Companion, buildSystemPrompt, clampSpokenReply, type ModelClientLike } from "../src/agent/companion.js";
import { buildTtsPrompt, defaultVoiceFor, GEMINI_VOICES } from "../src/speech/gemini.js";
import { pcmToWav } from "../src/speech/types.js";
import { SpeechRouter } from "../src/speech/router.js";
import { IndicSpeakTtsProvider } from "../src/speech/indicSpeak.js";

// ---------------------------------------------------------------- registry

test("every dialect points at a real language", () => {
  for (const profile of Object.values(DIALECTS)) {
    assert.ok(LANGUAGES[profile.language], `${profile.id} -> unknown language ${profile.language}`);
    assert.equal(profile.id, profile.id.trim());
  }
});

test("dialect profile ids are unique keys", () => {
  for (const [key, profile] of Object.entries(DIALECTS)) assert.equal(key, profile.id);
});

test("an unreviewed dialect is never reported as approved", () => {
  // This is the guard that keeps an unvalidated accent out of a shipped build.
  // If someone sets reviewedBy without a listener, this test still passes — but
  // `dialectsReviewed` in /api/health makes the count visible.
  for (const profile of approvedDialects()) {
    assert.notEqual(profile.reviewedBy, null);
    assert.ok(profile.reviewedBy!.length > 2, `${profile.id} has a hollow reviewer name`);
  }
});

test("unknown dialect ids fall back instead of throwing", () => {
  assert.equal(getDialect("does-not-exist").id, "hi-in-standard");
  assert.equal(getDialect(undefined).id, "hi-in-standard");
});

// ---------------------------------------------------------------- dialect -> prompt

test("Marwari profile survives serialisation into the TTS prompt", () => {
  const profile = getDialect("hi-in-marwari");
  const prompt = buildTtsPrompt("थे कनै जा रह्या हो?", profile);

  assert.match(prompt, /Marwari/);
  assert.match(prompt, /म्हारो/);        // lexicon present
  assert.match(prompt, /थे|तम/);          // address form present
  assert.match(prompt, /Never do this/);  // the anti-English tell is stated
  assert.ok(prompt.trimEnd().endsWith('"'), "text must be quoted last so the model reads only it");
});

test("code-mix policy changes the instruction", () => {
  const delhi = buildTtsPrompt("x", getDialect("hi-in-delhi"));
  const marwari = buildTtsPrompt("x", getDialect("hi-in-marwari"));
  assert.notEqual(delhi, marwari);
  assert.match(delhi, /without translating/);
  assert.match(marwari, /native word exists/);
});

test("speaking-rate override reaches the prompt", () => {
  const slow = buildTtsPrompt("x", getDialect("hi-in-standard"), 0.8);
  assert.match(slow, /slower than usual/);
});

test("default voices are all real Gemini voice names", () => {
  for (const profile of Object.values(DIALECTS)) {
    assert.ok((GEMINI_VOICES as readonly string[]).includes(defaultVoiceFor(profile)), profile.id);
  }
});

// ---------------------------------------------------------------- wav

test("pcmToWav writes a valid 24 kHz mono header", () => {
  const pcm = Buffer.alloc(4800); // 100ms of silence
  const wav = pcmToWav(pcm, 24_000);

  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.readUInt16LE(22), 1);        // mono
  assert.equal(wav.readUInt32LE(24), 24_000);   // sample rate
  assert.equal(wav.readUInt16LE(34), 16);       // bit depth
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.length, 44 + pcm.length);
});

// ---------------------------------------------------------------- safety

test("crisis detection fires on Hindi, Hinglish and Tamil self-harm language", () => {
  for (const text of [
    "मैं मरना चाहता हूँ",
    "marna chahta hoon, jeena nahi",
    "தற்கொலை பற்றி யோசிக்கிறேன்",
  ]) {
    const signal = detectCrisis(text);
    assert.equal(signal.level, "urgent", text);
    assert.ok(signal.categories.includes("self-harm"), text);
    assert.ok(signal.helplines.some((h) => h.number === "14416"), text);
    assert.ok(signal.reply, "a crisis must always produce something to say");
  }
});

test("crisis reply never diagnoses", () => {
  const reply = detectCrisis("मैं मरना चाहती हूँ").reply!;
  for (const word of ["depress", "disorder", "diagnos", "patient"]) {
    assert.ok(!reply.toLowerCase().includes(word), `reply leaked a diagnosis: ${reply}`);
  }
});

test("ordinary conversation does not trip the net", () => {
  for (const text of [
    "आज खाने में क्या बनाऊँ?",
    "मेरी बेटी को स्कूल भेजना है",
    "थे कनै जा रह्या हो?",
    "sirf thoda paisa bachana hai",
  ]) {
    assert.equal(detectCrisis(text).level, "none", text);
  }
});

test("financial coercion is a watch, not an emergency", () => {
  const signal = detectCrisis("kisi ne OTP maang liya");
  assert.equal(signal.level, "watch");
  assert.ok(signal.helplines.some((h) => h.number === "1930"));
});

// ---------------------------------------------------------------- tools

const ctx = { tenantId: "demo", profileId: "p", dialect: getDialect("hi-in-standard") };

test("memory proposal never claims to have saved anything", () => {
  const result = executeTool("proposeMemoryFact", { fact: "उन्हें अदरक वाली चाय पसंद है", category: "preference" }, ctx);
  assert.equal(result.kind, "memory-proposal");
  assert.equal(result.kind === "memory-proposal" && result.requiresApproval, true);
});

test("a reminder with an unparseable time is refused", () => {
  assert.throws(() => executeTool("createHouseholdReminder", { title: "दूध", when: "कल सुबह" }, ctx), /not a valid date/);
});

test("a valid reminder is normalised to ISO", () => {
  const result = executeTool("createHouseholdReminder", { title: "दूध लाना", when: "2026-10-25T08:00:00+05:30" }, ctx);
  assert.equal(result.kind, "reminder");
  assert.ok(result.kind === "reminder" && result.when.endsWith("Z"));
});

test("an empty shopping-list add is refused", () => {
  assert.throws(() => executeTool("updateShoppingList", { action: "add", items: [] }, ctx), /no items/);
});

test("every declared tool has a handler and vice versa", () => {
  for (const { name } of TOOL_DECLARATIONS) {
    // Tools may reject empty args with their own validation error; what must not
    // happen is "unknown tool", which means a declaration with no implementation.
    try {
      executeTool(name, {}, ctx);
    } catch (error) {
      assert.doesNotMatch(String(error), /unknown tool/, `${name} is declared but not implemented`);
    }
  }
  assert.throws(() => executeTool("noSuchTool", {}, ctx), /unknown tool/);
});

test("self-harm is caught whatever the word order", () => {
  // Regression: the phrase list caught "जीना नहीं" but missed the equally common
  // "नहीं जीना" and "और नहीं जीना चाहती".
  for (const text of [
    "मैं अब और नहीं जीना चाहती",
    "जीना नहीं चाहता हूँ",
    "jeena nahi chahta",
    "अब जिंदा नहीं रहना",
    "मरना चाहता हूँ",
  ]) {
    assert.equal(detectCrisis(text).level, "urgent", text);
  }
});

// ---------------------------------------------------------------- agent loop

function fakeModel(replies: Array<{ text?: string; call?: { name: string; args: Record<string, unknown> } }>): ModelClientLike {
  let i = 0;
  return {
    models: {
      async generateContent() {
        const reply = replies[Math.min(i++, replies.length - 1)]!;
        const parts = reply.call ? [{ functionCall: reply.call }] : [{ text: reply.text }];
        return { candidates: [{ content: { parts } }] };
      },
    },
  };
}

test("system prompt carries the dialect, not just the language", () => {
  const prompt = buildSystemPrompt(getDialect("hi-in-bhojpuri"));
  assert.match(prompt, /Bhojpuri/);
  assert.match(prompt, /रउरा/);
  assert.match(prompt, /Devanagari/);
  assert.match(prompt, /At most 3 short sentences/);
});

test("companion executes a tool then speaks using the result", async () => {
  const model = fakeModel([
    { call: { name: "createHouseholdReminder", args: { title: "दूध लाना", when: "2026-10-25T08:00:00+05:30" } } },
    { text: "अच्छा, मैंने दूध लाने का याद दिला दिया है।" },
  ]);
  const companion = new Companion({ client: model });

  const reply = await companion.reply({ messages: [{ role: "user", text: "कल सुबह दूध लाना याद दिलाना" }], context: ctx });

  assert.equal(reply.toolResults.length, 1);
  assert.equal(reply.toolResults[0]!.kind, "reminder");
  assert.match(reply.text, /याद दिला दिया/);
  assert.equal(reply.shortCircuited, false);
});

test("an urgent crisis short-circuits before the model is ever called", async () => {
  let called = false;
  const companion = new Companion({
    client: { models: { async generateContent() { called = true; return { candidates: [] }; } } },
  });

  const reply = await companion.reply({
    messages: [{ role: "user", text: "मैं अब और नहीं जीना चाहती" }],
    context: ctx,
  });

  assert.equal(called, false, "the safety net must not depend on a model round-trip");
  assert.equal(reply.shortCircuited, true);
  assert.equal(reply.crisis.level, "urgent");
});

test("spoken replies are trimmed to three sentences on danda and full stop", () => {
  const text = "एक। दो। तीन। चार। पाँच।";
  assert.equal(clampSpokenReply(text), "एक। दो। तीन।");
});

// ---------------------------------------------------------------- routing

class StubProvider {
  name: string;
  tier: 1 | 2 | 3 | 4;
  constructor(name: string, tier: 1 | 2 | 3 | 4, private readonly ok: boolean) {
    this.name = name;
    this.tier = tier;
  }
  supports = () => this.ok;
  async speak(req: { text: string }, profile: { id: string }) {
    return { audio: Buffer.alloc(4), mimeType: "audio/wav" as const, sampleRate: 24000, provider: this.name, dialectId: profile.id, tier: this.tier };
  }
}

test("router prefers the native-voice provider over the general model", async () => {
  const router = new SpeechRouter([new StubProvider("indic-speak", 2, true), new StubProvider("gemini", 3, true)] as never);
  const clip = await router.speak({ text: "नमस्ते", dialectId: "hi-in-standard" });
  assert.equal(clip.provider, "indic-speak");
  assert.equal(clip.tier, 2);
});

test("router falls through when the better provider fails, and reports the tier honestly", async () => {
  const broken = new StubProvider("indic-speak", 2, true);
  broken.speak = async () => { throw new Error("429 quota"); };
  const router = new SpeechRouter([broken, new StubProvider("gemini", 3, true)] as never);
  const clip = await router.speak({ text: "नमस्ते", dialectId: "hi-in-standard" });
  assert.equal(clip.provider, "gemini");
  assert.equal(clip.tier, 3, "a silent downgrade must be visible to the client");
});

test("router refuses dialects no provider can serve", async () => {
  const router = new SpeechRouter([new StubProvider("gemini", 3, false)] as never);
  await assert.rejects(router.speak({ text: "x", dialectId: "hi-in-standard" }), /no speech provider/);
});

test("Indic-Speak only claims a language it has a native voice for", () => {
  const provider = new IndicSpeakTtsProvider();
  const original = process.env.INDIC_SPEAK_API_KEY;
  process.env.INDIC_SPEAK_API_KEY = "test-key";
  try {
    assert.equal(provider.supports(getDialect("hi-in-standard")), true);   // Kavya
    assert.equal(provider.supports(getDialect("bn-in-kolkata")), true);    // Ishita
    assert.equal(provider.supports(getDialect("hi-in-marwari")), false);   // no Marwari voice
  } finally {
    if (original === undefined) delete process.env.INDIC_SPEAK_API_KEY;
    else process.env.INDIC_SPEAK_API_KEY = original;
  }
});
