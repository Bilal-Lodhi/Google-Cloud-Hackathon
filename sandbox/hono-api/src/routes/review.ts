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
 * ═══════════════════════════════════════════════════════════════════
 */

import { Hono } from "hono";
import type { SessionReviewResponse, RiskAssessmentPayload } from "../types.js";

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
// Lists all sessions from MongoDB via the MCP HTTP adapter.

reviewRouter.get("/", async (c) => {
  const requestId = crypto.randomUUID();
  console.log(`[Review Route] [${requestId}] Incoming GET /api/v1/sessions`);

  try {
    const res = await mcpFetch("list_sessions", {}, requestId);

    if (!res || !res.ok) {
      if (res) {
        const errBody = await res.text().catch(() => "<unreadable>");
        console.error(
          `[Review Route] [${requestId}] list_sessions failed: HTTP ${res.status} ${errBody.substring(0, 300)}`
        );
      } else {
        console.warn(
          `[Review Route] [${requestId}] list_sessions timed out / unreachable — returning empty list`
        );
      }
      return c.json({ success: true, data: [] });
    }

    const mcpResult = (await res.json()) as {
      success: boolean;
      data?: Array<{
        sessionId: string;
        candidateId: string;
        assessmentId: string;
        status: string;
        createdAt: string;
        updatedAt: string;
      }>;
    };

    if (!mcpResult.success || !mcpResult.data) {
      console.log(`[Review Route] [${requestId}] list_sessions returned empty data`);
      return c.json({ success: true, data: [] });
    }

    console.log(
      `[Review Route] [${requestId}] list_sessions returned ${mcpResult.data.length} sessions — enriching...`
    );

    // Enrich each session with counts from micro_events and suspicion_reports
    const enrichedSessions = await Promise.all(
      mcpResult.data.map(async (s) => {
        let eventCount = 0;
        let pasteCount = 0;
        let tabSwitchCount = 0;
        let suspicionScore = 0;
        let lastEventTimestamp: string | null = s.updatedAt ?? null;

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
              eventCount = reviewData.events.length;
              pasteCount = reviewData.events.filter(
                (e) => e.eventType === "PASTE_TRIGGER"
              ).length;
              tabSwitchCount = reviewData.events.filter(
                (e) =>
                  e.eventType === "TAB_SWITCH" ||
                  e.eventType === "WINDOW_BLUR"
              ).length;
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
              suspicionScore =
                reviewData.suspicionReports[
                  reviewData.suspicionReports.length - 1
                ].overallRiskScore;
            }
          } catch {
            // Silently fall back — counts will be zero
          }
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
          createdAt: s.createdAt ?? new Date().toISOString(),
          startedAt: s.createdAt ?? new Date().toISOString(),
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

reviewRouter.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const requestId = crypto.randomUUID();
  console.log(`[Review Route] [${requestId}] Incoming GET /api/v1/sessions/${sessionId}`);

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
        (r["generatedAt"] as string) ?? new Date().toISOString();
      return {
        riskAssessmentId:
          (r["suspicionId"] as string) ?? crypto.randomUUID(),
        sessionId: (r["sessionId"] as string) ?? sessionId,
        employeeId: (r["candidateId"] as string) ?? session.candidateId,
        auditId: (r["assessmentId"] as string) ?? session.assessmentId,
        overallRiskScore: (r["overallRiskScore"] as number) ?? (r["overallScore"] as number) ?? 0,
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

    const response: SessionReviewResponse = {
      sessionId: session.sessionId,
      employeeId: session.candidateId,
      auditId: session.assessmentId,
      status,
      terminalContent: session.submittedCode ?? "",
      timeline,
      riskSummary,
      finalRiskScore: lastReport
        ? (lastReport["overallRiskScore"] as number) ?? 0
        : 0,
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