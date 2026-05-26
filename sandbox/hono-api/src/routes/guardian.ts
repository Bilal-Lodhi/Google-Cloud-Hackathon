/**
 * Route: POST /api/v1/guardian/ingest
 * Feature 2 — REAL-TIME INTENT & PLAGIARISM GUARDIAN
 *
 * Streaming micro-event ingestion handler. Accepts batches of micro-inputs
 * (paste triggers, code deltas, tab switches) and delegates to the Intent
 * Guardian Agent backed by Gemini for semantic plagiarism detection.
 */

import { Hono } from "hono";
import type { IngestMicroEventRequest, IngestMicroEventResponse, MicroEvent, SuspicionPayload } from "../types.js";
import { GeminiClient } from "../agents/gemini-client.js";
import { loadConfig } from "../config.js";

const guardianRouter = new Hono();
const config = loadConfig();
const gemini = new GeminiClient(config);

// ─── In-Memory Session Store (replaced by MongoDB via MCP in production) ──

interface SessionState {
  sessionId: string;
  candidateId: string;
  assessmentId: string;
  events: MicroEvent[];
  currentCode: string;
  pasteCount: number;
  keystrokeDeltas: number[];
  tabSwitchCount: number;
  fullscreenExitCount: number;
  copyAttemptCount: number;
  lastSuspicionPayload: SuspicionPayload | null;
}

const sessionStore = new Map<string, SessionState>();

// ─── POST /api/v1/guardian/ingest ─────────────────────────────────

guardianRouter.post("/ingest", async (c) => {
  const body = await c.req.json<IngestMicroEventRequest>();

  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return c.json(
      { success: false, error: "Field 'events' must be a non-empty array" },
      400
    );
  }

  const processedCount = body.events.length;
  let suspicionPayload: SuspicionPayload | null = null;
  let alertTriggered = false;

  try {
    // Aggregate events into session
    for (const event of body.events) {
      processEvent(event);
    }

    // Determine the primary session from the first event
    const primaryEvent = body.events[0];
    const sessionId = primaryEvent?.sessionId;
    if (!sessionId) {
      return c.json({ success: false, error: "Each event must contain a sessionId" }, 400);
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return c.json({ success: false, error: `Session ${sessionId} not found` }, 404);
    }

    // Check if suspicion analysis should be triggered
    const shouldAnalyze =
      session.pasteCount > config.security.maxPasteEventsPerSession ||
      session.tabSwitchCount > 3 ||
      session.fullscreenExitCount > 0 ||
      session.copyAttemptCount > 2 ||
      hasAnomalousKeystrokes(session.keystrokeDeltas);

    if (shouldAnalyze && session.currentCode.length > 50) {
      const keystrokeMetrics = computeKeystrokeMetrics(session.keystrokeDeltas);
      const pasteContents = session.events
        .filter((e) => e.eventType === "PASTE_TRIGGER" && e.payload.pasteContent)
        .map((e) => e.payload.pasteContent!);

      // Gather reference completions — in production this queries a cache of
      // Gemini outputs for the same problem from the MCP MongoDB store
      const referenceCompletions = await getReferenceCompletions(
        session.assessmentId,
        primaryEvent?.problemId ?? ""
      );

      suspicionPayload = await gemini.analyzeSuspicion(
        session.currentCode,
        pasteContents,
        keystrokeMetrics,
        referenceCompletions
      );

      // Enrich with session context
      suspicionPayload.sessionId = sessionId;
      suspicionPayload.candidateId = session.candidateId;
      suspicionPayload.assessmentId = session.assessmentId;
      suspicionPayload.generatedAt = new Date().toISOString();

      session.lastSuspicionPayload = suspicionPayload;
      sessionStore.set(sessionId, session);

      alertTriggered = suspicionPayload.overallScore > 50;
    }

    const response: IngestMicroEventResponse = {
      success: true,
      processedCount,
      suspicionPayload,
      alertTriggered,
    };

    return c.json(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown guardian error";
    console.error("[IntentGuardian]", message);
    return c.json(
      { success: false, error: `Guardian analysis failed: ${message}` },
      500
    );
  }
});

// ─── GET /api/v1/guardian/sessions/:sessionId ─────────────────────

guardianRouter.get("/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionStore.get(sessionId);

  if (!session) {
    return c.json({ success: false, error: "Session not found" }, 404);
  }

  return c.json({
    success: true,
    session: {
      sessionId: session.sessionId,
      candidateId: session.candidateId,
      assessmentId: session.assessmentId,
      eventCount: session.events.length,
      pasteCount: session.pasteCount,
      tabSwitchCount: session.tabSwitchCount,
      fullscreenExitCount: session.fullscreenExitCount,
      copyAttemptCount: session.copyAttemptCount,
      currentCodeLength: session.currentCode.length,
      lastSuspicionPayload: session.lastSuspicionPayload,
    },
  });
});

// ─── Internal Helpers ──────────────────────────────────────────────

function processEvent(event: MicroEvent): void {
  let session = sessionStore.get(event.sessionId);

  if (!session) {
    session = {
      sessionId: event.sessionId,
      candidateId: event.candidateId,
      assessmentId: event.assessmentId,
      events: [],
      currentCode: "",
      pasteCount: 0,
      keystrokeDeltas: [],
      tabSwitchCount: 0,
      fullscreenExitCount: 0,
      copyAttemptCount: 0,
      lastSuspicionPayload: null,
    };
  }

  session.events.push(event);

  switch (event.eventType) {
    case "KEYSTROKE":
      if (event.payload.deltaMs !== undefined) {
        session.keystrokeDeltas.push(event.payload.deltaMs);
      }
      break;
    case "PASTE_TRIGGER":
      session.pasteCount++;
      if (event.payload.pasteContent) {
        session.currentCode += event.payload.pasteContent;
      }
      break;
    case "CODE_DELTA":
      if (event.payload.diffPatch) {
        session.currentCode = applyDiffPatch(session.currentCode, event.payload.diffPatch);
      }
      break;
    case "TAB_SWITCH":
      session.tabSwitchCount++;
      break;
    case "WINDOW_BLUR":
    case "FULLSCREEN_EXIT":
      session.fullscreenExitCount++;
      break;
    case "COPY_ATTEMPT":
      session.copyAttemptCount++;
      break;
    case "SUBMIT":
      // Final code snapshot
      if (event.payload.pasteContent) {
        session.currentCode = event.payload.pasteContent;
      }
      break;
  }

  sessionStore.set(event.sessionId, session);
}

function hasAnomalousKeystrokes(deltas: number[]): boolean {
  if (deltas.length < 10) return false;
  const fastCount = deltas.filter((d) => d < config.security.minHumanKeystrokeMs).length;
  return fastCount / deltas.length > 0.3;
}

function computeKeystrokeMetrics(deltas: number[]): {
  avgDeltaMs: number;
  maxDeltaMs: number;
  minDeltaMs: number;
} {
  if (deltas.length === 0) return { avgDeltaMs: 0, maxDeltaMs: 0, minDeltaMs: 0 };
  return {
    avgDeltaMs: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    maxDeltaMs: Math.max(...deltas),
    minDeltaMs: Math.min(...deltas),
  };
}

function applyDiffPatch(current: string, _diffPatch: string): string {
  // Simplified: append the diff as a code block update.
  // In production, this applies a proper unified diff algorithm.
  // For hackathon purposes, we treat the diff as the new code state
  // when it represents a full replacement.
  if (_diffPatch.startsWith("@@") || _diffPatch.startsWith("---")) {
    // Extract the new code portion from the unified diff
    const lines = _diffPatch.split("\n");
    const newLines = lines
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    return newLines.length > 0 ? newLines.join("\n") : current;
  }
  return current + _diffPatch;
}

async function getReferenceCompletions(
  _assessmentId: string,
  _problemId: string
): Promise<string[]> {
  // In production, queries the MCP MongoDB store for cached Gemini completions
  // that were pre-generated for the same problem as part of the test suite.
  // For hackathon, returns the expected answer from the generated suite (if cached).
  return [];
}

export { guardianRouter, sessionStore };