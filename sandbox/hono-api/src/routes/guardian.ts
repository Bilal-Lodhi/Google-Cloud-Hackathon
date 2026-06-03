/**
 * Route: POST /api/v1/guardian/ingest
 * Feature 2 — REAL-TIME INSIDER THREAT & DATA EXFILTRATION GUARDIAN
 *
 * Streaming micro-event ingestion handler. Accepts batches of telemetry
 * (paste triggers, code deltas, tab switches, copy attempts) and delegates
 * to the Cerberus FinSec Guardian Agent backed by Gemini for semantic
 * data exfiltration detection and behavioral anomaly scoring.
 *
 * Sessions are persisted to MongoDB via the MCP HTTP adapter sidecar.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ENTERPRISE HARDENING (2026-05-28):
 *   - Every MCP HTTP call is wrapped in an isolated AbortController
 *     timeout (MCP_TIMEOUT_MS) so that a slow MongoDB Atlas connection
 *     never starves the ingestion loop.
 *   - Deep observability telemetry logs at every pipeline milestone.
 * ═══════════════════════════════════════════════════════════════════
 */

import { Hono } from "hono";
import type { IngestMicroEventRequest, IngestMicroEventResponse, MicroEvent, RiskAssessmentPayload, DeploySessionRequest, DeploySessionResponse, ActiveSession } from "../types.js";
import { GeminiClient } from "../agents/gemini-client.js";
import { loadConfig } from "../config.js";

const guardianRouter = new Hono();
const config = loadConfig();
const gemini = new GeminiClient(config);

// ─── MCP Constants ──────────────────────────────────────────────

/** MCP HTTP Adapter base URL (sidecar on port 3001). */
const MCP_BASE = process.env["MCP_URL"] ?? "http://localhost:3001";

// ─── Active Session Registry (in-memory, resets on restart) ─────
// This list powers the left drawer in the Flutter dashboard.
// Sessions are persisted to MongoDB for durability; this registry
// provides sub-millisecond lookups for the live UI.

const activeSessions = new Map<string, ActiveSession>();

/**
 * Maximum time (ms) any single MCP fetch call is allowed to take.
 * Exceeding this threshold aborts the request and falls through to
 * the in-memory-only path so the ingestion pipeline stays responsive.
 */
const MCP_TIMEOUT_MS = 5_000;

// ─── In-Memory Session Store (replaced by MongoDB via MCP in production) ──

interface SessionState {
  sessionId: string;
  employeeId: string;
  auditId: string;
  events: MicroEvent[];
  currentCode: string;
  pasteCount: number;
  keystrokeDeltas: number[];
  tabSwitchCount: number;
  fullscreenExitCount: number;
  copyAttemptCount: number;
  lastRiskPayload: RiskAssessmentPayload | null;
}

const sessionStore = new Map<string, SessionState>();

// ─── POST /api/v1/guardian/ingest ─────────────────────────────────

guardianRouter.post("/ingest", async (c) => {
  const requestId = crypto.randomUUID();
  console.log(`[Guardian Route] [${requestId}] Incoming POST /api/v1/guardian/ingest`);

  let body: IngestMicroEventRequest;
  try {
    body = await c.req.json<IngestMicroEventRequest>();
  } catch (parseError) {
    console.error(`[Guardian Route] [${requestId}] JSON parse failure:`, parseError);
    return c.json(
      { success: false, error: "Invalid JSON body", correlationId: requestId },
      400
    );
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    console.warn(`[Guardian Route] [${requestId}] Validation failed: body is not a valid object`);
    return c.json(
      { success: false, error: "Request body must be a valid JSON object", correlationId: requestId },
      400
    );
  }

  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    console.warn(`[Guardian Route] [${requestId}] Validation failed: empty/missing events array`);
    return c.json(
      { success: false, error: "Field 'events' must be a non-empty array" },
      400
    );
  }

  // Determine the primary session from the first event
  const primaryEvent = body.events[0];
  const sessionId = primaryEvent?.sessionId;
  if (!sessionId) {
    console.warn(`[Guardian Route] [${requestId}] Validation failed: missing sessionId in first event`);
    return c.json({ success: false, error: "Each event must contain a sessionId" }, 400);
  }

  const processedCount = body.events.length;
  let riskPayload: RiskAssessmentPayload | null = null;
  let alertTriggered = false;

  try {
    // ── Step 1: Ensure session exists in MongoDB (timeout-isolated) ──
    console.log(`[Guardian Route] [${requestId}] Ensuring session ${sessionId} in MongoDB...`);
    await ensureMongoSession(sessionId, primaryEvent, requestId);

    // ── Step 2: Persist micro-events to MongoDB (timeout-isolated) ──
    console.log(`[Guardian Route] [${requestId}] Persisting ${processedCount} events to MongoDB...`);
    await persistMicroEvents(body.events, requestId);

    // ── Step 3: In-memory processing (real-time guardian analysis) ──
    console.log(`[Guardian Route] [${requestId}] Processing ${processedCount} events in-memory...`);
    for (const event of body.events) {
      processEvent(event);
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      console.error(`[Guardian Route] [${requestId}] Session ${sessionId} not found after processing`);
      return c.json({ success: false, error: `Session ${sessionId} not found after processing` }, 404);
    }

    // ── Step 4: Suspicion analysis threshold check ──
    // ANY single large paste (≥100 chars inserted) triggers immediate analysis
    const hasLargePaste = body.events.some(
      (e) =>
        e.eventType === "PASTE" &&
        (e.payload.changeLength ?? 0) >= 100
    );
    const shouldAnalyze =
      hasLargePaste ||
      session.pasteCount > config.security.maxPasteEventsPerSession ||
      session.tabSwitchCount > 3 ||
      session.fullscreenExitCount > 0 ||
      session.copyAttemptCount > 2 ||
      hasAnomalousKeystrokes(session.keystrokeDeltas);

    console.log(
      `[Guardian Route] [${requestId}] Suspicion check — ` +
        `largePaste=${hasLargePaste} ` +
        `pastes=${session.pasteCount}/${config.security.maxPasteEventsPerSession} ` +
        `tabs=${session.tabSwitchCount} fullscreen=${session.fullscreenExitCount} ` +
        `copies=${session.copyAttemptCount} codeLen=${session.currentCode.length} ` +
        `shouldAnalyze=${shouldAnalyze}`
    );

    if (shouldAnalyze && session.currentCode.length > 50) {
      const keystrokeMetrics = computeKeystrokeMetrics(session.keystrokeDeltas);
      // Collect paste content from both legacy PASTE_TRIGGER and new PASTE events
      const pasteContents = session.events
        .filter(
          (e) =>
            (e.eventType === "PASTE_TRIGGER" && e.payload.pasteContent) ||
            (e.eventType === "PASTE" && e.payload.newText)
        )
        .map((e) => e.payload.pasteContent ?? e.payload.newText ?? "");

      // Gather reference completions — in production this queries a cache of
      // Gemini outputs for the same problem from the MCP MongoDB store
      const referenceCompletions = await getReferenceCompletions(
        session.auditId,
        primaryEvent?.vectorId ?? ""
      );

      console.log(
        `[Guardian Route] [${requestId}] Invoking GeminiClient.analyzeSuspicion ` +
          `— codeLen=${session.currentCode.length} pastes=${pasteContents.length} ` +
          `refCompletions=${referenceCompletions.length} keystrokeAvg=${keystrokeMetrics.avgDeltaMs.toFixed(1)}ms`
      );

      const analysisStartMs = Date.now();
      try {
        riskPayload = await gemini.analyzeSuspicion(
          session.currentCode,
          pasteContents,
          keystrokeMetrics,
          referenceCompletions
        );
        console.log(
          `[Guardian Route] [${requestId}] Gemini risk analysis complete in ${Date.now() - analysisStartMs}ms ` +
            `— score=${riskPayload.overallRiskScore} flags=${riskPayload.flags.length}`
        );

        // ── Enrich with complete incident context for MongoDB persistence ──
        riskPayload.sessionId = sessionId;
        riskPayload.employeeId = session.employeeId;
        riskPayload.auditId = session.auditId;
        riskPayload.generatedAt = new Date().toISOString();

        // Capture full paste content blobs (including multi-line pastes)
        riskPayload.pasteSnippets = session.events
          .filter(
            (e) =>
              (e.eventType === "PASTE_TRIGGER" && e.payload.pasteContent) ||
              (e.eventType === "PASTE" && e.payload.newText)
          )
          .map((e) => e.payload.pasteContent ?? e.payload.newText ?? "");
        riskPayload.pasteLineCount = riskPayload.pasteSnippets
          .reduce((sum, s) => sum + (s.match(/\n/g) ?? []).length + 1, 0);
        riskPayload.pasteCharCount = riskPayload.pasteSnippets
          .reduce((sum, s) => sum + s.length, 0);

        // Full terminal code snapshot at detection time
        riskPayload.codeSnapshot = session.currentCode;

        // Behavioral context snapshot (all micro-event counters)
        riskPayload.behavioralContext = {
          totalPasteEvents: session.pasteCount,
          totalFocusBreaches: session.tabSwitchCount + session.fullscreenExitCount,
          totalCopyAttempts: session.copyAttemptCount,
          totalDevToolsOpens: session.events.filter(
            (e) => e.eventType === "DEVELOPER_TOOLS_OPEN"
          ).length,
          totalFullscreenExits: session.fullscreenExitCount,
        };

        // Keystroke rhythm metrics
        const km = computeKeystrokeMetrics(session.keystrokeDeltas);
        riskPayload.keystrokeMetrics = {
          averageInterKeyMs: km.avgDeltaMs,
          minInterKeyMs: km.minDeltaMs,
          burstKeystrokes: session.keystrokeDeltas.filter(
            (d) => d < config.security.minHumanKeystrokeMs
          ).length,
        };

        // Build a short 1-2 line incident summary for the notification UI
        const summaryParts: string[] = [];
        if (riskPayload.pasteSnippets && riskPayload.pasteSnippets.length > 0) {
          summaryParts.push(
            `${riskPayload.pasteSnippets.length} paste event${riskPayload.pasteSnippets.length > 1 ? "s" : ""} (${riskPayload.pasteLineCount} lines)`
          );
        }
        if (session.tabSwitchCount > 0) {
          summaryParts.push(`${session.tabSwitchCount} tab switch${session.tabSwitchCount > 1 ? "es" : ""}`);
        }
        if (session.copyAttemptCount > 0) {
          summaryParts.push(`${session.copyAttemptCount} copy attempt${session.copyAttemptCount > 1 ? "s" : ""}`);
        }
        if (session.fullscreenExitCount > 0) {
          summaryParts.push(`fullscreen exit detected`);
        }
        if (hasAnomalousKeystrokes(session.keystrokeDeltas)) {
          summaryParts.push("anomalous keystroke rhythm");
        }
        riskPayload.incidentSummary =
          summaryParts.length > 0
            ? summaryParts.join(" · ")
            : `Risk score: ${riskPayload.overallRiskScore.toFixed(0)}%`;
        riskPayload.employeeDisplayName =
          `Operator ${session.employeeId}`;
        riskPayload.incidentTimeLabel = formatLocalTime(new Date());

        session.lastRiskPayload = riskPayload;
        sessionStore.set(sessionId, session);

        alertTriggered = riskPayload.overallRiskScore > 50;

        // ── Persist risk report to MongoDB (timeout-isolated, non-fatal) ──
        await persistRiskReport(riskPayload, requestId);
      } catch (analysisError) {
        const msg = analysisError instanceof Error ? analysisError.message : "Unknown analysis error";
        console.error(
          `[Guardian Route] [${requestId}] Gemini analysis FAILED (non-fatal) — ${msg}`
        );
      }
    }

    const response: IngestMicroEventResponse = {
      success: true,
      processedCount,
      riskPayload,
      alertTriggered,
      anomalyRiskIndex: riskPayload?.overallRiskScore ?? 0,
    };

    console.log(
      `[Guardian Route] [${requestId}] COMPLETE — processedCount=${processedCount} ` +
        `alertTriggered=${alertTriggered} score=${riskPayload?.overallRiskScore ?? "N/A"}`
    );
    return c.json(response, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown guardian error";
    console.error(
      `[Guardian Route] [${requestId}] FAILURE — ${message}`,
      error instanceof Error ? error.stack : ""
    );
    return c.json(
      { success: false, error: `Guardian analysis failed: ${message}`, correlationId: requestId },
      500
    );
  }
});

// ─── GET /api/v1/guardian/sessions/:sessionId ─────────────────────

guardianRouter.get("/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionStore.get(sessionId);
  const activeSession = activeSessions.get(sessionId);

  // If session exists in the in-memory store (has ingested events), return full data
  if (session) {
    return c.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        employeeId: session.employeeId,
        auditId: session.auditId,
        eventCount: session.events.length,
        pasteCount: session.pasteCount,
        tabSwitchCount: session.tabSwitchCount,
        fullscreenExitCount: session.fullscreenExitCount,
        copyAttemptCount: session.copyAttemptCount,
        currentCodeLength: session.currentCode.length,
        lastRiskPayload: session.lastRiskPayload,
        currentCode: session.currentCode,
        riskIndex: session.lastRiskPayload?.overallRiskScore ?? 0,
        overallRiskScore: session.lastRiskPayload?.overallRiskScore ?? 0,
        peakRiskScore: session.lastRiskPayload?.overallRiskScore ?? 0,
        startedAt: activeSession?.deployedAt ?? "",
        deployedAt: activeSession?.deployedAt ?? "",
        status: activeSession?.status ?? "active",
        targetSystem: activeSession?.targetSystem ?? "",
      },
    });
  }

  // Fallback: session deployed but no events ingested yet — return minimal data
  // from the activeSessions registry so the frontend doesn't crash with 404.
  if (activeSession) {
    return c.json({
      success: true,
      session: {
        sessionId: activeSession.sessionId,
        employeeId: activeSession.employeeId,
        auditId: activeSession.matrixId,
        eventCount: 0,
        pasteCount: 0,
        tabSwitchCount: 0,
        fullscreenExitCount: 0,
        copyAttemptCount: 0,
        currentCodeLength: 0,
        currentCode: "",
        lastRiskPayload: null,
        riskIndex: activeSession.riskIndex,
        overallRiskScore: activeSession.riskIndex,
        peakRiskScore: activeSession.riskIndex,
        startedAt: activeSession.deployedAt,
        deployedAt: activeSession.deployedAt,
        status: activeSession.status,
        targetSystem: activeSession.targetSystem,
      },
    });
  }

  return c.json({ success: false, error: "Session not found" }, 404);
});

// ─── POST /api/v1/guardian/deploy ─────────────────────────────────
// Deploys a guardrail by creating a new audited terminal session.
// Persists to MongoDB via the MCP sidecar and adds to the active
// session registry so the Flutter left drawer list populates instantly.

guardianRouter.post("/deploy", async (c) => {
  const requestId = crypto.randomUUID();
  console.log(`[Guardian Route] [${requestId}] Incoming POST /api/v1/guardian/deploy`);

  let body: DeploySessionRequest;
  try {
    body = await c.req.json<DeploySessionRequest>();
  } catch {
    return c.json(
      { success: false, error: "Invalid JSON body", correlationId: requestId },
      400
    );
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return c.json(
      { success: false, error: "Request body must be a valid JSON object", correlationId: requestId },
      400
    );
  }

  // Validate required fields
  const { employeeUid, sessionId, matrixId, targetSystem } = body;
  const employeeId = employeeUid; // Map from updated contract field name
  const missing: string[] = [];
  if (!employeeUid?.trim()) missing.push("employeeUid");
  if (!sessionId?.trim()) missing.push("sessionId");
  if (!matrixId?.trim()) missing.push("matrixId");
  if (!targetSystem?.trim()) missing.push("targetSystem");

  if (missing.length > 0) {
    console.warn(`[Guardian Route] [${requestId}] Validation failed — missing: [${missing.join(", ")}]`);
    return c.json(
      {
        success: false,
        error: `Missing required fields: ${missing.join(", ")}`,
        correlationId: requestId,
      },
      400
    );
  }

  try {
    // ── Step 1: Persist session to MongoDB via MCP ──
    console.log(
      `[Guardian Route] [${requestId}] Creating session '${sessionId}' for employee '${employeeId}' ` +
        `on target '${targetSystem}' (matrix: ${matrixId})`
    );

    const mcpRes = await mcpFetch(
      "create_session",
      {
        sessionId,
        candidateId: employeeId,          // backward-compat field name in Mongo
        employeeId,
        assessmentId: matrixId,
        auditId: matrixId,
        matrixId,
        targetSystem,
        status: "active",
      },
      requestId
    );

    let mongoDocumentId = "local-only";
    if (mcpRes?.ok) {
      try {
        const mcpData = (await mcpRes.json()) as { success: boolean; mongoDocumentId?: string };
        if (mcpData.success && mcpData.mongoDocumentId) {
          mongoDocumentId = mcpData.mongoDocumentId;
        }
      } catch {
        // Non-fatal — session is still tracked in-memory
        console.warn(`[Guardian Route] [${requestId}] Could not parse MCP response, using local fallback`);
      }
    } else {
      console.warn(
        `[Guardian Route] [${requestId}] MCP create_session failed/inaccessible — ` +
          `session tracked in-memory only`
      );
    }

    // ── Step 2: Register in active session registry ──
    const deployedAt = new Date().toISOString();
    const activeSession: ActiveSession = {
      sessionId,
      employeeId,
      matrixId,
      targetSystem,
      status: "active",
      deployedAt,
      riskIndex: 0,
    };
    activeSessions.set(sessionId, activeSession);

    console.log(
      `[Guardian Route] [${requestId}] Guardrail deployed — ` +
        `sessionId=${sessionId} mongoDoc=${mongoDocumentId} registrySize=${activeSessions.size}`
    );

    const response: DeploySessionResponse = {
      success: true,
      sessionId,
      employeeId,
      deployedAt,
      mongoDocumentId,
      mcpCorrelationId: requestId,
    };

    return c.json(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown deploy error";
    console.error(
      `[Guardian Route] [${requestId}] DEPLOY FAILURE — ${message}`,
      error instanceof Error ? error.stack : ""
    );
    return c.json(
      {
        success: false,
        error: `Failed to deploy guardrail: ${message}`,
        correlationId: requestId,
      },
      500
    );
  }
});

// ─── GET /api/v1/guardian/sessions ─────────────────────────────────
// Lists all active audited terminal sessions. Reads from the in-memory
// registry first; when the process has restarted (empty Map), falls
// through to the MCP list_sessions MongoDB query so the Flutter drawer
// always shows previously deployed sessions.

guardianRouter.get("/sessions", async (c) => {
  const requestId = crypto.randomUUID();

  // ── Path A: In-memory registry (fast path) ──
  if (activeSessions.size > 0) {
    const sessions = Array.from(activeSessions.values()).sort(
      (a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime()
    );

    // Enrich with in-memory session store metrics (paste count, tab switches, etc.)
    // Emits both FinSec & backward-compat field names so Flutter's
    // SessionSummary.fromJson parses without throwing "Audit record data missing".
    const enriched = sessions.map((s) => {
      const state = sessionStore.get(s.sessionId);
      return {
        sessionId: s.sessionId,
        employeeId: s.employeeId,
        auditId: s.matrixId,                                  // Flutter expects auditId
        matrixId: s.matrixId,
        targetSystem: s.targetSystem,
        status: s.status,
        deployedAt: s.deployedAt,
        startedAt: s.deployedAt,                               // Flutter SessionSummary.startedAt
        createdAt: s.deployedAt,                               // Flutter SessionSummary.createdAt
        riskIndex: state?.lastRiskPayload?.overallRiskScore ?? s.riskIndex,
        peakRiskScore: state?.lastRiskPayload?.overallRiskScore ?? s.riskIndex, // Flutter expects peakRiskScore
        eventCount: state?.events.length ?? 0,
        pasteCount: state?.pasteCount ?? 0,
        tabSwitchCount: state?.tabSwitchCount ?? 0,
        alertTriggered: (state?.lastRiskPayload?.overallRiskScore ?? s.riskIndex) >= 75,
      };
    });

    console.log(
      `[Guardian Route] GET /sessions — ${enriched.length} active sessions (in-memory)`
    );
    return c.json({ success: true, data: enriched });
  }

  // ── Path B: MongoDB fallback via MCP list_sessions (post-restart) ──
  console.log(
    `[Guardian Route] [${requestId}] In-memory registry empty, querying MongoDB via MCP list_sessions...`
  );

  const listRes = await mcpFetch("list_sessions", {}, requestId);

  if (listRes?.ok) {
    try {
      const listData = (await listRes.json()) as {
        success: boolean;
        data?: Array<Record<string, unknown>>;
      };

      if (listData.success && Array.isArray(listData.data) && listData.data.length > 0) {
        // Map MongoDB documents into the Flutter SessionSummary shape.
        // Re-hydrate the in-memory registry so subsequent calls hit the fast path.
        const enriched = listData.data.map((doc) => {
          const sessionId = String(doc["sessionId"] ?? doc["_id"] ?? "");
          const employeeId = String(doc["employeeId"] ?? doc["candidateId"] ?? "unknown");
          const matrixId = String(doc["auditId"] ?? doc["assessmentId"] ?? doc["matrixId"] ?? "");
          const deployedAt = String(doc["deployedAt"] ?? doc["createdAt"] ?? new Date().toISOString());
          const rawStatus = String(doc["status"] ?? "active");
          const status = (
            ["active", "flagged", "investigating", "cleared"].includes(rawStatus)
              ? rawStatus
              : "active"
          ) as ActiveSession["status"];
          const riskScore = Number(doc["peakRiskScore"] ?? doc["overallRiskScore"] ?? doc["riskIndex"] ?? 0);
          const eventCount = Number(doc["eventCount"] ?? 0);

          // Rebuilt ActiveSession so the registry is usable for future events
          if (!activeSessions.has(sessionId)) {
            activeSessions.set(sessionId, {
              sessionId,
              employeeId,
              matrixId,
              targetSystem: "",
              status,
              deployedAt,
              riskIndex: riskScore,
            });
          }

          return {
            sessionId,
            employeeId,
            auditId: matrixId,
            matrixId,
            targetSystem: "",
            status,
            deployedAt,
            startedAt: deployedAt,
            createdAt: deployedAt,
            riskIndex: riskScore,
            peakRiskScore: riskScore,
            eventCount,
            pasteCount: Number(doc["pasteCount"] ?? 0),
            tabSwitchCount: Number(doc["tabSwitchCount"] ?? 0),
            alertTriggered: riskScore >= 75,
          };
        });

        console.log(
          `[Guardian Route] GET /sessions — ${enriched.length} sessions restored from MongoDB`
        );
        return c.json({ success: true, data: enriched });
      }
    } catch (parseError) {
      console.error(
        `[Guardian Route] [${requestId}] Failed to parse MCP list_sessions response:`,
        parseError instanceof Error ? parseError.message : String(parseError)
      );
    }
  }

  // ── Path C: Nothing in memory AND nothing in MongoDB ──
  console.log(
    `[Guardian Route] [${requestId}] GET /sessions — 0 sessions (memory + MongoDB both empty)`
  );
  return c.json({ success: true, data: [] });
});

// ═══════════════════════════════════════════════════════════════════
// MCP Timeout-Isolated Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Executes an MCP HTTP fetch with a hard timeout. Returns the Response
 * on success, or null if the call timed out / errored.
 */
async function mcpFetch(
  tool: string,
  body: unknown,
  requestId: string
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(
      `[Guardian MCP] [${requestId}] ABORTING ${tool} after ${MCP_TIMEOUT_MS}ms`
    );
    controller.abort();
  }, MCP_TIMEOUT_MS);

  try {
    const startMs = Date.now();
    const res = await fetch(`${MCP_BASE}/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    console.log(
      `[Guardian MCP] [${requestId}] ${tool} completed — HTTP ${res.status} in ${Date.now() - startMs}ms`
    );
    return res;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(
        `[Guardian MCP] [${requestId}] ${tool} TIMED OUT after ${MCP_TIMEOUT_MS}ms`
      );
    } else {
      console.error(
        `[Guardian MCP] [${requestId}] ${tool} error:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureMongoSession(
  sessionId: string,
  primaryEvent: MicroEvent,
  requestId: string
): Promise<void> {
  // Check if session exists
  const checkRes = await mcpFetch("get_session_review", { sessionId }, requestId);

  let exists = false;
  if (checkRes?.ok) {
    try {
      const checkData = (await checkRes.json()) as { success: boolean; session?: unknown };
      exists = checkData.success && !!checkData.session;
    } catch {
      exists = false;
    }
  }

  if (!exists) {
    console.log(`[Guardian MCP] [${requestId}] Session '${sessionId}' not found, creating...`);
    const createRes = await mcpFetch(
      "create_session",
      {
        sessionId,
        candidateId: primaryEvent.employeeId ?? "unknown",
        employeeId: primaryEvent.employeeId ?? "unknown",
        assessmentId: primaryEvent.auditId ?? "unknown",
        auditId: primaryEvent.auditId ?? "unknown",
        status: "in_progress",
      },
      requestId
    );
    if (createRes?.ok) {
      console.log(`[Guardian MCP] [${requestId}] Session '${sessionId}' created`);
    } else {
      console.warn(`[Guardian MCP] [${requestId}] Failed to create session (non-fatal)`);
    }
  }
}

async function persistMicroEvents(
  events: MicroEvent[],
  requestId: string
): Promise<void> {
  const res = await mcpFetch("ingest_micro_events", { events }, requestId);
  if (!res?.ok) {
    console.warn(`[Guardian MCP] [${requestId}] Failed to persist events (non-fatal)`);
  }
}

async function persistRiskReport(
  report: RiskAssessmentPayload,
  requestId: string
): Promise<void> {
  const res = await mcpFetch("store_suspicion_report", { report }, requestId);
  if (!res?.ok) {
    console.warn(`[Guardian MCP] [${requestId}] Failed to persist risk report (non-fatal)`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════

function processEvent(event: MicroEvent): void {
  let session = sessionStore.get(event.sessionId);

  if (!session) {
    session = {
      sessionId: event.sessionId,
      employeeId: event.employeeId,
      auditId: event.auditId,
      events: [],
      currentCode: "",
      pasteCount: 0,
      keystrokeDeltas: [],
      tabSwitchCount: 0,
      fullscreenExitCount: 0,
      copyAttemptCount: 0,
      lastRiskPayload: null,
    };
  }

  // Guarantee non-nullability after construction
  const sess = session;

  sess.events.push(event);

  switch (event.eventType) {
    case "KEYSTROKE":
      if (event.payload.deltaMs !== undefined) {
        sess.keystrokeDeltas.push(event.payload.deltaMs);
      }
      break;
    case "PASTE_TRIGGER":
      sess.pasteCount++;
      if (event.payload.pasteContent) {
        sess.currentCode += event.payload.pasteContent;
      }
      break;
    case "CODE_DELTA":
      if (event.payload.diffPatch) {
        sess.currentCode = applyDiffPatch(sess.currentCode, event.payload.diffPatch);
      }
      break;
    case "TAB_SWITCH":
      sess.tabSwitchCount++;
      break;
    case "WINDOW_BLUR":
    case "FULLSCREEN_EXIT":
      sess.fullscreenExitCount++;
      break;
    case "COPY_ATTEMPT":
      sess.copyAttemptCount++;
      break;
    case "SUBMIT":
      // Final code snapshot
      if (event.payload.pasteContent) {
        sess.currentCode = event.payload.pasteContent;
      }
      break;
    case "EDIT":
      // Live terminal workspace edit — update the full code snapshot
      if (event.payload.newText !== undefined) {
        sess.currentCode = event.payload.newText;
      }
      break;
    case "PASTE":
      // Live terminal paste — track as paste + update code snapshot
      sess.pasteCount++;
      if (event.payload.newText !== undefined) {
        sess.currentCode = event.payload.newText;
      }
      if (event.payload.changeLength !== undefined) {
        sess.keystrokeDeltas.push(event.payload.changeLength);
      }
      break;
  }

  sessionStore.set(event.sessionId, sess);
}

function hasAnomalousKeystrokes(deltas: number[]): boolean {
  if (deltas.length < 10) return false;
  const fastCount = deltas.filter((d) => d < config.security.minHumanKeystrokeMs).length;
  return fastCount / deltas.length > 0.3;
}

/**
 * Formats a Date into a human-readable local time label like "Today 10:32 AM"
 * or "Jun 3, 10:32 AM" for the risk notification popup UI.
 */
function formatLocalTime(date: Date): string {
  const now = new Date();
  const isToday =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  const timeStr = `${hour12}:${minutes} ${ampm}`;

  if (isToday) return `Today ${timeStr}`;

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[date.getMonth()]} ${date.getDate()}, ${timeStr}`;
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
  if (_diffPatch.startsWith("@@") || _diffPatch.startsWith("---")) {
    const lines = _diffPatch.split("\n");
    const newLines = lines
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    return newLines.length > 0 ? newLines.join("\n") : current;
  }
  return current + _diffPatch;
}

async function getReferenceCompletions(
  _auditId: string,
  _vectorId: string
): Promise<string[]> {
  // In production, queries the MCP MongoDB store for cached Gemini completions
  return [];
}

export { guardianRouter, sessionStore };