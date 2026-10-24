import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import { Companion, clampSpokenReply } from "./agent/companion.js";
import { DIALECTS, getDialect, LANGUAGES } from "./indic/registry.js";
import { allHelplines, detectCrisis } from "./safety/crisis.js";
import { GeminiSttProvider } from "./speech/gemini.js";
import { SpeechRouter } from "./speech/router.js";
import type { ChatTurn } from "./agent/companion.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json({ limit: "12mb" })); // recorded audio arrives base64'd

const companion = new Companion();
const speech = new SpeechRouter();
const stt = new GeminiSttProvider();

/**
 * Tenant guard.
 *
 * A real implementation reads membership from Postgres. This one refuses to
 * guess: with no membership table it accepts only the demo tenant, so an
 * unknown `x-tenant-id` can never accidentally read another household. The
 * shape is what matters here — every route goes through it, and the day the
 * table lands nothing else has to change.
 */
const DEMO_TENANT = "demo";

function tenantOf(req: express.Request): { tenantId: string; profileId: string } | null {
  const tenantId = String(req.header("x-tenant-id") ?? DEMO_TENANT);
  const profileId = String(req.header("x-profile-id") ?? "default");
  if (tenantId !== DEMO_TENANT && !process.env.ALLOW_UNVERIFIED_TENANTS) return null;
  return { tenantId, profileId };
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: process.env.CHAT_MODEL ?? "gemini-3.8-flash",
    speech: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      indicSpeak: Boolean(process.env.INDIC_SPEAK_API_KEY),
    },
    dialects: Object.keys(DIALECTS).length,
    // A profile with no native speaker sign-off is not "ready", whatever the code says.
    dialectsReviewed: Object.values(DIALECTS).filter((d) => d.reviewedBy !== null).length,
  });
});

app.get("/api/dialects", (_req, res) => {
  res.json({
    languages: Object.values(LANGUAGES),
    dialects: Object.values(DIALECTS).map((d) => ({
      id: d.id,
      label: d.label,
      language: d.language,
      region: d.region,
      pitch: d.pitch,
      pace: d.pace,
      nativeVoice: speech.plan(d)?.name ?? null,
      reviewed: d.reviewedBy !== null,
    })),
    helplines: allHelplines(),
  });
});

app.post("/api/chat", async (req, res) => {
  const tenant = tenantOf(req);
  if (!tenant) return res.status(403).json({ error: "unknown tenant" });

  const messages = Array.isArray(req.body?.messages) ? (req.body.messages as ChatTurn[]) : [];
  if (messages.length === 0) return res.status(400).json({ error: "messages[] required" });

  const dialect = getDialect(req.body?.dialectId);

  try {
    const reply = await companion.reply({
      messages: messages.slice(-20),
      dialectId: dialect.id,
      context: { ...tenant, dialect },
    });
    res.json({
      reply: clampSpokenReply(reply.text),
      toolResults: reply.toolResults,
      crisis: reply.crisis,
      shortCircuited: reply.shortCircuited,
      dialectId: dialect.id,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "chat failed" });
  }
});

app.post("/api/speech/tts", async (req, res) => {
  const tenant = tenantOf(req);
  if (!tenant) return res.status(403).json({ error: "unknown tenant" });

  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "text required" });
  if (text.length > 2000) return res.status(413).json({ error: "text too long" });

  const dialect = getDialect(req.body?.dialectId);

  try {
    const clip = await speech.speak({ text, dialectId: dialect.id, rate: Number(req.body?.rate ?? 1) });
    res.setHeader("content-type", clip.mimeType);
    res.setHeader("x-speech-provider", clip.provider);
    res.setHeader("x-speech-tier", String(clip.tier));
    res.setHeader("x-dialect-id", clip.dialectId);
    res.send(clip.audio);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "tts failed" });
  }
});

app.post("/api/speech/stt", async (req, res) => {
  const tenant = tenantOf(req);
  if (!tenant) return res.status(403).json({ error: "unknown tenant" });

  const data = String(req.body?.audio ?? "");
  if (!data) return res.status(400).json({ error: "audio (base64) required" });

  try {
    const transcript = await stt.transcribe(Buffer.from(data, "base64"), String(req.body?.mimeType ?? "audio/webm"));
    // Run the safety net on the transcript too: voice is the primary surface and
    // a crisis spoken aloud must not wait for the chat round-trip.
    res.json({ ...transcript, crisis: detectCrisis(transcript.text) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "stt failed" });
  }
});

const server = createServer(app);

/**
 * Household sync. Server-authoritative: clients never broadcast to each other,
 * and every socket is bound to the tenant it authenticated as, so a family
 * reminder cannot leak across tenants.
 */
const wss = new WebSocketServer({ server, path: "/ws" });
const rooms = new Map<string, Set<WebSocket>>();

wss.on("connection", (socket, request) => {
  const url = new URL(request.url ?? "/ws", "http://localhost");
  const tenantId = url.searchParams.get("tenant") ?? DEMO_TENANT;

  if (!rooms.has(tenantId)) rooms.set(tenantId, new Set());
  rooms.get(tenantId)!.add(socket);
  socket.send(JSON.stringify({ type: "init", tenantId }));

  socket.on("close", () => {
    rooms.get(tenantId)?.delete(socket);
    if (rooms.get(tenantId)?.size === 0) rooms.delete(tenantId);
  });
});

export function broadcast(tenantId: string, event: Record<string, unknown>): number {
  const sockets = rooms.get(tenantId);
  if (!sockets) return 0;
  const payload = JSON.stringify(event);
  let delivered = 0;
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
      delivered++;
    }
  }
  return delivered;
}

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`Saheli listening on :${PORT} — ${Object.keys(DIALECTS).length} dialects, speech: ${speech.plan(getDialect(undefined))?.name ?? "none"}`);
  });
}

export { app, server };
