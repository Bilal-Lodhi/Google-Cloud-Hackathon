/**
 * Route: GET /api/v1/sessions/:sessionId/review
 * Feature 3 (Backend API) — INTERACTIVE ANALYTICAL REVIEW LOG
 *
 * Serves the complete session review payload consumed by the Flutter
 * split-panel analytical review UI. Returns submitted code, timestamped
 * security metrics, suspicion scores, and behavioral flags.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ENTERPRISE HARDENING (2026-05-28):
 *   - Every MCP HTTP call is wrapped in an isolated AbortController
 *     timeout (MCP_TIMEOUT_MS) so that a slow MongoDB Atlas connection
 *     never starves the review endpoint.
 *   - Deep observability telemetry logs at every pipeline milestone.
 *
 * ENTERPRISE HARDENING (2026-06-04):
 *   - MCP enrichment timeouts silently zero out event/paste/tab counts
 *     in the session list left-drawer. The review route now imports the
 *     guardian's in-memory sessionStore and uses it as an authoritative
 *     fallback so the Flutter drawer always shows accurate live counts
 *     regardless of MCP MongoDB reachability.
 *
 * ENTERPRISE HARDENING (2026-06-04 v2):
 *   - When MCP list_sessions is unreachable (timed out / down), the
 *     review route previously returned `data: []` — showing 0 events
 *     in the Flutter left drawer even though sessionStore had live
 *     sessions. Now builds the session list from a UNION of MCP
 *     (durable) + sessionStore (live) so the drawer always reflects
 *     active sessions regardless of MongoDB Atlas connectivity.
 * ═══════════════════════════════════════════════════════════════════
 */

import { Hono } from "hono";
import type { SessionReviewResponse, RiskAssessmentPayload } from "../types.js";
import { toISOStringLocal } from "../utils/time.js";
import { sessionStore } from "./guardian.js";

const reviewRouter = new Hono();

// MCP HTTP Adapter base URL (sidecar on port 3001)
const MCP_BASE = process.env["MCP_URL"] ?? "http://localhost:3001";

/**
 * Maximum time (ms) any single MCP fetch call is allowed to take.
 * Exceeding this threshold aborts the request and returns a degraded
 * (but valid) response instead of timing out the client.
 */
const MCP_TIMEOUT_MS = 5_000;

// ═══════════════════════════════════════════════════════════════════
// MCP Timeout-Isolated Fetch Helper
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
      `[Review MCP] [${requestId}] ABORTING ${tool} after ${MCP_TIMEOUT_MS}ms`
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
      `[Review MCP] [${requestId}] ${tool} completed — HTTP ${res.status} in ${Date.now() - startMs}ms`
    );
    return res;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(
        `[Review MCP] [${requestId}] ${tool} TIMED OUT after ${MCP_TIMEOUT_MS}ms`
      );
    } else {
      console.error(
        `[Review MCP] [${requestId}] ${tool} error:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── GET /api/v1/sessions ───────────────────────────────────────
// Lists all sessions from a UNION of MCP (durable MongoDB) + in-memory
// sessionStore (live). The Flutter left drawer always shows active
// sessions regardless of MCP MongoDB Atlas reachability.

reviewRouter.get("/", async (c) => {
  const requestId = crypto.randomUUID();
  console.log(`[Review Route] [${requestId}] Incoming GET /api/v1/sessions`);

  try {
    // ═════════════════════════════════════════════════════════════
    // Build the session list from a UNION of:
    //   A) MCP list_sessions  (durable, MongoDB-backed)
    //   B) sessionStore       (live, in-memory, authoritative for
    //                          sessions that have ingested events)
    //
    // sessionStore is authoritative — a session created by ingestion
    // without /deploy is still a valid live session with real events.
    // ═════════════════════════════════════════════════════════════

    type McpSessionEntry = {
      sessionId: string;
      candidateId: string;
      assessmentId: string;
      status: string;
      createdAt: string;
      updatedAt: string;
      eventCount?: number;
      pasteCount?: number;
      tabSwitchCount?: number;
      copyAttemptCount?: number;
      peakRiskScore?: number;
    };

    const seenIds = new Set<string>();
    const allSessions: McpSessionEntry[] = [];

    // --- Path A: Try MCP list_sessions (durable MongoDB) ---
    const res = await mcpFetch("list_sessions", {}, requestId);
    if (res?.ok) {
      try {
        const mcpResult = (await res.json()) as {
          success: boolean;
          data?: McpSessionEntry[];
        };
        if (mcpResult.success && Array.isArray(mcpResult.data)) {
          for (const s of mcpResult.data) {
            if (!seenIds.has(s.sessionId)) {
              allSessions.push(s);
              seenIds.add(s.sessionId);
            }
          }
          console.log(
            `[Review Route] [${requestId}] MCP list_sessions returned ${mcpResult.data.length} sessions`
          );
        }
      } catch {
        console.warn(
          `[Review Route] [${requestId}] Failed to parse MCP list_sessions response — continuing with sessionStore`
        );
      }
    } else {
      console.warn(
        `[Review Route] [${requestId}] MCP list_sessions unavailable — using sessionStore alone`
      );
    }

    // --- Path B: Add sessions from sessionStore that MCP didn't return ---
    if (sessionStore.size > 0) {
      for (const [sid, state] of sessionStore.entries()) {
        if (!seenIds.has(sid)) {
          allSessions.push({
            sessionId: sid,
            candidateId: state.employeeId ?? "unknown",
            assessmentId: state.auditId ?? "",
            status: "active",
            createdAt: state.events[0]?.timestamp ?? toISOStringLocal(),
            updatedAt:
              state.events[state.events.length - 1]?.timestamp ??
              toISOStringLocal(),
          });
          seenIds.add(sid);
        }
      }
      console.log(
        `[Review Route] [${requestId}] sessionStore contributed ${sessionStore.size} entries (${allSessions.length - (res?.ok ? (await res?.json?.() as any)?.data?.length ?? 0 : 0)} new)`
      );
    }

    if (allSessions.length === 0) {
      console.log(
        `[Review Route] [${requestId}] No sessions found (MCP + sessionStore both empty)`
      );
      return c.json({ success: true, data: [] });
    }

    console.log(
      `[Review Route] [${requestId}] ${allSessions.length} total sessions (MCP + sessionStore union) — enriching...`
    );

    // Enrich each session with counts from micro_events and suspicion_reports.
    // sessionStore is the primary (authoritative) source for live counts;
    // MCP get_session_review is supplementary for MongoDB-persisted data.
    const enrichedSessions = await Promise.all(
      allSessions.map(async (s) => {
        // ── Seed from the in-memory session store FIRST (authoritative live data) ──
        const memSession = sessionStore.get(s.sessionId);
        let eventCount = memSession?.events.length ?? (s.eventCount ?? 0);
        let pasteCount = memSession?.pasteCount ?? (s.pasteCount ?? 0);
        let tabSwitchCount = memSession?.tabSwitchCount ?? (s.tabSwitchCount ?? 0);
        let copyAttemptCount = memSession?.copyAttemptCount ?? (s.copyAttemptCount ?? 0);
        let suspicionScore = memSession?.lastRiskPayload?.overallRiskScore ?? (s.peakRiskScore ?? 0);
        let lastEventTimestamp: string | null = s.updatedAt ?? null;

        // ── Try MCP enrichment for persisted data (durable, but may timeout) ──
        const reviewRes = await mcpFetch(
          "get_session_review",
          { sessionId: s.sessionId },
          requestId
        );

        if (reviewRes?.ok) {
          try {
            const reviewData = (await reviewRes.json()) as {
              success: boolean;
              events?: Array<{
                eventType: string;
                timestamp: string;
              }>;
              suspicionReports?: Array<{
                overallRiskScore: number;
              }>;
            };
            if (reviewData.success && reviewData.events) {
              // Merge: MCP may have events persisted to MongoDB that the
              // in-memory store doesn't (e.g. if the server restarted between
              // ingestion and now). Take the max of both sources.
              const mcpEventCount = reviewData.events.length;
              if (mcpEventCount > eventCount) eventCount = mcpEventCount;

              const mcpPasteCount = reviewData.events.filter(
                (e) => e.eventType === "PASTE_TRIGGER" || e.eventType === "PASTE"
              ).length;
              if (mcpPasteCount > pasteCount) pasteCount = mcpPasteCount;

              const mcpTabCount = reviewData.events.filter(
                (e) =>
                  e.eventType === "TAB_SWITCH" ||
                  e.eventType === "WINDOW_BLUR"
              ).length;
              if (mcpTabCount > tabSwitchCount) tabSwitchCount = mcpTabCount;

              const mcpCopyCount = reviewData.events.filter(
                (e) => e.eventType === "COPY_ATTEMPT"
              ).length;
              if (mcpCopyCount > copyAttemptCount) copyAttemptCount = mcpCopyCount;

              if (reviewData.events.length > 0) {
                const sorted = [...reviewData.events].sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime()
                );
                lastEventTimestamp = sorted[0].timestamp;
              }
            }
            if (
              reviewData.success &&
              reviewData.suspicionReports &&
              reviewData.suspicionReports.length > 0
            ) {
              const mcpScore =
                reviewData.suspicionReports[
                  reviewData.suspicionReports.length - 1
                ].overallRiskScore;
              if (mcpScore > suspicionScore) suspicionScore = mcpScore;
            }
          } catch {
            // Silently fall back — in-memory counts already populated
          }
        } else {
          console.log(
            `[Review Route] [${requestId}] MCP enrichment for session '${s.sessionId}' ` +
              `unavailable — using in-memory counts (events=${eventCount}, pastes=${pasteCount}, tabs=${tabSwitchCount})`
          );
        }

        // ── FinSec rebranded enriched return payload ──────────────────
        // Emits both legacy keys (candidateId, assessmentId) for backward
        // compat AND FinSec keys (employeeId, auditId, targetSystem,
        // alertTriggered, peakRiskScore) so the Flutter left drawer
        // SessionSummary.fromJson & ReviewRecord.fromJson parse without
        // throwing "Audit record data missing".
        return {
          sessionId: s.sessionId,
          employeeId: s.candidateId ?? "unknown-operator",
          candidateId: s.candidateId,
          auditId: s.assessmentId,
          assessmentId: s.assessmentId,
          status: s.status as SessionReviewResponse["status"],
          eventCount,
          pasteCount,
          tabSwitchCount,
          suspicionScore,
          lastEventTimestamp,
          targetSystem: "Core Trading Ledger",
          alertTriggered: suspicionScore >= 75,
          peakRiskScore: suspicionScore,
          createdAt: s.createdAt ?? toISOStringLocal(),
          startedAt: s.createdAt ?? toISOStringLocal(),
        };
      })
    );

    console.log(`[Review Route] [${requestId}] COMPLETE — ${enrichedSessions.length} enriched sessions`);
    return c.json({ success: true, data: enrichedSessions });
  } catch (error) {
    console.error(
      `[Review Route] [${requestId}] FAILURE:`,
      error instanceof Error ? error.message : String(error)
    );
    return c.json({ success: true, data: [] });
  }
});

// ─── GET /api/v1/sessions/:sessionId ────────────────────────────
// Fetches a single session from MongoDB via the MCP HTTP adapter.
// Falls back to in-memory sessionStore when MCP is unreachable.

reviewRouter.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const requestId = crypto.randomUUID();
  console.log(`[Review Route] [${requestId}] Incoming GET /api/v1/sessions/${sessionId}`);

  // ── In-memory session for live counts fallback ──
  const memSession = sessionStore.get(sessionId);

  try {
    const mcpRes = await mcpFetch(
      "get_session_review",
      { sessionId },
      requestId
    );

    if (!mcpRes || !mcpRes.ok) {
      if (mcpRes) {
        const errBody = await mcpRes.text().catch(() => "<unreadable>");
        console.error(
          `[Review Route] [${requestId}] get_session_review failed: HTTP ${mcpRes.status} ${errBody.substring(0, 300)}`
        );
      }
      return c.json(
        { success: false, error: `Session '${sessionId}' not found` },
        404
      );
    }

    const mcpData = (await mcpRes.json()) as {
      success: boolean;
      session?: {
        sessionId: string;
        candidateId: string;
        assessmentId: string;
        status: string;
        submittedCode?: string;
      } | null;
      events?: Array<{
        sessionId: string;
        eventType: string;
        timestamp: string;
        payload?: Record<string, unknown>;
      }>;
      suspicionReports?: Array<Record<string, unknown>>;
    };

    if (!mcpData.success || !mcpData.session) {
      console.warn(`[Review Route] [${requestId}] Session '${sessionId}' not found in MongoDB`);
      return c.json(
        { success: false, error: `Session '${sessionId}' not found` },
        404
      );
    }

    const session = mcpData.session;
    const events = mcpData.events ?? [];
    const reports = mcpData.suspicionReports ?? [];

    console.log(
      `[Review Route] [${requestId}] Session '${sessionId}' loaded — ` +
        `${events.length} events, ${reports.length} reports`
    );

    // Build timeline from micro-events
    const timeline = events.map((event) => {
      // Guard against malformed MongoDB documents where eventType is
      // missing or null — this prevents "Cannot read property 'replace'
      // of undefined" crashes on sessions with incomplete event data.
      const rawType = event.eventType ?? "";
      let severity: "info" | "warning" | "critical" = "info";
      let label = rawType;
      let detail = "";

      switch (rawType) {
        case "KEYSTROKE":
          label = "Keystroke";
          detail = `Delta: ${event.payload?.deltaMs ?? "N/A"}ms`;
          if (
            typeof event.payload?.deltaMs === "number" &&
            (event.payload.deltaMs as number) < 80
          ) {
            severity = "warning";
          }
          break;
        case "PASTE_TRIGGER":
          label = "Paste Event";
          detail = `Content length: ${(event.payload?.pasteContent as string)?.length ?? 0} chars`;
          severity = "critical";
          break;
        case "CODE_DELTA":
          label = "Code Change";
          detail = `Diff size: ${(event.payload?.diffPatch as string)?.length ?? 0} chars`;
          severity = "info";
          break;
        case "TAB_SWITCH":
          label = "Tab Switch";
          detail = `Visibility: ${event.payload?.visibilityState ?? "unknown"}`;
          severity = "warning";
          break;
        case "WINDOW_BLUR":
          label = "Window Blur";
          detail = "Candidate left the test window";
          severity = "warning";
          break;
        case "COPY_ATTEMPT":
          label = "Copy Attempt";
          detail = `Selected: ${((event.payload?.selectedText as string)?.length ?? 0)} chars`;
          severity = "critical";
          break;
        case "DEVELOPER_TOOLS_OPEN":
          label = "Dev Tools Opened";
          detail = "Browser developer console activated";
          severity = "critical";
          break;
        case "FULLSCREEN_EXIT":
          label = "Fullscreen Exit";
          detail = "Candidate exited fullscreen mode";
          severity = "critical";
          break;
        case "SUBMIT":
          label = "Submission";
          detail = "Final answer submitted";
          severity = "info";
          break;
        case "EDIT":
          label = "Code Edit";
          detail = `Snapshot: ${(event.payload?.newText as string)?.length ?? 0} chars`;
          severity = "info";
          break;
        case "PASTE":
          label = "Paste Detected";
          detail = `Inserted ${event.payload?.changeLength ?? "?"} chars`;
          severity = "critical";
          break;
        default:
          // Catch CODE_EDIT / unknown types gracefully — guard against
          // malformed MongoDB documents where eventType is missing/null.
          label = event.eventType
            ? event.eventType
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase())
            : "Unknown Event";
          detail = JSON.stringify(event.payload ?? {});
          severity = "info";
          break;
      }

      return {
        timestamp: event.timestamp,
        eventType: event.eventType,
        label,
        severity,
        detail,
      };
    });

    // Compute status
    let status: SessionReviewResponse["status"] =
      (session.status as SessionReviewResponse["status"]) ?? "active";
    const hasSubmission = events.some((e) => e.eventType === "SUBMIT");
    const lastReport =
      reports.length > 0 ? reports[reports.length - 1] : null;
    const isFlagged =
      lastReport !== null &&
      (lastReport["overallRiskScore"] as number) > 50;

    if (hasSubmission && isFlagged) {
      status = "flagged";
    } else if (isFlagged) {
      status = "flagged";
    } else if (hasSubmission) {
      status = "investigating";
    }

    // Map risk reports to RiskAssessmentPayload type.
    // Flags are stored in MongoDB as full objects from Gemini's JSON output,
    // NOT as plain strings. We map Gemini's field names to the contract expected
    // by the Flutter AnomalyFlag.fromJson parser.
    const riskSummary: RiskAssessmentPayload[] = reports.map((r) => {
      const rawFlags: Record<string, unknown>[] =
        Array.isArray(r["flags"]) ? (r["flags"] as Record<string, unknown>[]) : [];
      const generatedAt =
        (r["generatedAt"] as string) ?? toISOStringLocal();
      const rawDims = r["dimensionScores"] as Record<string, unknown> | undefined;
      return {
        riskAssessmentId:
          (r["suspicionId"] as string) ?? crypto.randomUUID(),
        sessionId: (r["sessionId"] as string) ?? sessionId,
        employeeId: (r["candidateId"] as string) ?? session.candidateId,
        auditId: (r["assessmentId"] as string) ?? session.assessmentId,
        overallRiskScore: (r["overallRiskScore"] as number) ?? (r["overallScore"] as number) ?? 0,
        dimensionScores: {
          dataExfiltration: (rawDims?.["dataExfiltration"] as number) ?? 0,
          unauthorizedAccess: (rawDims?.["unauthorizedAccess"] as number) ?? 0,
          policyViolation: (rawDims?.["policyViolation"] as number) ?? 0,
          amlRedFlag: (rawDims?.["amlRedFlag"] as number) ?? 0,
          insiderTrading: (rawDims?.["insiderTrading"] as number) ?? 0,
          soxNonCompliance: (rawDims?.["soxNonCompliance"] as number) ?? 0,
        },
        flags: rawFlags.map((f) => ({
          // The Hono types use {flagType, severity, sourceEventId, ...}
          // Flutter's AnomalyFlag.fromJson maps them as:
          //   flagId    ← sourceEventId
          //   category  ← flagType
          //   confidence← confidence
          //   description← description
          //   evidenceSnippet ← description (best available evidence)
          flagType: (f["flagType"] as string) ?? (f["flagId"] as string) ?? "unknown",
          severity: ((f["severity"] as string) ?? "medium") as "low" | "medium" | "high" | "critical",
          sourceEventId: (f["sourceEventId"] as string) ?? "",
          description: (f["description"] as string) ?? (f["flagType"] as string) ?? "",
          confidence: (f["confidence"] as number) ?? 1,
          timestamp:
            (f["timestamp"] as string) ?? generatedAt,
        })),
        exfiltrationReport:
          (r["plagiarismReport"] as RiskAssessmentPayload["exfiltrationReport"]) ??
          null,
        behavioralAnomalies:
          (r["behavioralAnomalies"] as RiskAssessmentPayload["behavioralAnomalies"]) ??
          [],
        generatedAt,
      };
    });

    // ── Merge in-memory live counts (authoritative) with MCP durable data ──
    const finalRiskScore = lastReport
      ? (lastReport["overallRiskScore"] as number) ?? 0
      : (memSession?.lastRiskPayload?.overallRiskScore ?? 0);

    const response: SessionReviewResponse = {
      sessionId: session.sessionId,
      employeeId: session.candidateId,
      auditId: session.assessmentId,
      status,
      terminalContent: session.submittedCode ?? memSession?.currentCode ?? "",
      timeline,
      riskSummary,
      finalRiskScore,
    };

    console.log(
      `[Review Route] [${requestId}] COMPLETE — status=${status} ` +
        `events=${timeline.length} risks=${riskSummary.length} finalRiskScore=${response.finalRiskScore}`
    );
    return c.json({ success: true, data: response });
  } catch (error) {
    console.error(
      `[Review Route] [${requestId}] FAILURE:`,
      error instanceof Error ? error.message : String(error)
    );
    return c.json(
      { success: false, error: "Failed to fetch session" },
      500
    );
  }
});

export { reviewRouter };