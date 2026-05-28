/**
 * Route: GET /api/v1/sessions/:sessionId/review
 * Feature 3 (Backend API) — INTERACTIVE ANALYTICAL REVIEW LOG
 *
 * Serves the complete session review payload consumed by the Flutter
 * split-panel analytical review UI. Returns submitted code, timestamped
 * security metrics, suspicion scores, and behavioral flags.
 */

import { Hono } from "hono";
import type { SessionReviewResponse, SuspicionPayload } from "../types.js";

const reviewRouter = new Hono();

// MCP HTTP Adapter base URL (sidecar on port 3001)
const MCP_BASE = process.env["MCP_URL"] ?? "http://localhost:3001";

// ─── GET /api/v1/sessions ───────────────────────────────────────
// Lists all sessions from MongoDB via the MCP HTTP adapter.

reviewRouter.get("/", async (c) => {
  try {
    const res = await fetch(`${MCP_BASE}/tools/list_sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        `[review] list_sessions failed: ${res.status} ${errBody}`
      );
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
      return c.json({ success: true, data: [] });
    }

    // Enrich each session with counts from micro_events and suspicion_reports
    const enrichedSessions = await Promise.all(
      mcpResult.data.map(async (s) => {
        let eventCount = 0;
        let pasteCount = 0;
        let tabSwitchCount = 0;
        let suspicionScore = 0;
        let lastEventTimestamp: string | null = s.updatedAt ?? null;

        try {
          const reviewRes = await fetch(
            `${MCP_BASE}/tools/get_session_review`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: s.sessionId }),
            }
          );
          if (reviewRes.ok) {
            const reviewData = (await reviewRes.json()) as {
              success: boolean;
              events?: Array<{
                eventType: string;
                timestamp: string;
              }>;
              suspicionReports?: Array<{
                overallScore: number;
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
                ].overallScore;
            }
          }
        } catch {
          // Silently fall back — counts will be zero
        }

        return {
          sessionId: s.sessionId,
          candidateId: s.candidateId,
          assessmentId: s.assessmentId,
          status: s.status as SessionReviewResponse["status"],
          eventCount,
          pasteCount,
          tabSwitchCount,
          suspicionScore,
          lastEventTimestamp,
        };
      })
    );

    return c.json({ success: true, data: enrichedSessions });
  } catch (error) {
    console.error("[review] list_sessions error:", error);
    return c.json({ success: true, data: [] });
  }
});

// ─── GET /api/v1/sessions/:sessionId ────────────────────────────
// Fetches a single session from MongoDB via the MCP HTTP adapter.

reviewRouter.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    const mcpRes = await fetch(`${MCP_BASE}/tools/get_session_review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });

    if (!mcpRes.ok) {
      const errBody = await mcpRes.text();
      console.error(
        `[review] get_session_review failed: ${mcpRes.status} ${errBody}`
      );
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
      return c.json(
        { success: false, error: `Session '${sessionId}' not found` },
        404
      );
    }

    const session = mcpData.session;
    const events = mcpData.events ?? [];
    const reports = mcpData.suspicionReports ?? [];

    // Build timeline from micro-events
    const timeline = events.map((event) => {
      let severity: "info" | "warning" | "critical" = "info";
      let label = event.eventType;
      let detail = "";

      switch (event.eventType) {
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
      (session.status as SessionReviewResponse["status"]) ?? "in_progress";
    const hasSubmission = events.some((e) => e.eventType === "SUBMIT");
    const lastReport =
      reports.length > 0 ? reports[reports.length - 1] : null;
    const isFlagged =
      lastReport !== null &&
      (lastReport["overallScore"] as number) > 50;

    if (hasSubmission && isFlagged) {
      status = "flagged";
    } else if (hasSubmission) {
      status = "submitted";
    } else if (isFlagged) {
      status = "flagged";
    }

    // Map suspicion reports to SuspicionPayload type
    const suspicionSummary: SuspicionPayload[] = reports.map((r) => {
      const rawFlags = (r["flags"] as string[]) ?? [];
      return {
        suspicionId:
          (r["suspicionId"] as string) ?? crypto.randomUUID(),
        sessionId: (r["sessionId"] as string) ?? sessionId,
        candidateId: (r["candidateId"] as string) ?? session.candidateId,
        assessmentId: (r["assessmentId"] as string) ?? session.assessmentId,
        overallScore: (r["overallScore"] as number) ?? 0,
        flags: rawFlags.map((f) => ({
          flagType: f,
          severity: "medium" as const,
          sourceEventId: "",
          description: f,
          confidence: 1,
          timestamp:
            (r["generatedAt"] as string) ?? new Date().toISOString(),
        })),
        plagiarismReport:
          (r["plagiarismReport"] as SuspicionPayload["plagiarismReport"]) ??
          null,
        behavioralAnomalies:
          (r["behavioralAnomalies"] as SuspicionPayload["behavioralAnomalies"]) ??
          [],
        generatedAt:
          (r["generatedAt"] as string) ?? new Date().toISOString(),
      };
    });

    const response: SessionReviewResponse = {
      sessionId: session.sessionId,
      candidateId: session.candidateId,
      assessmentId: session.assessmentId,
      status,
      submittedCode: session.submittedCode ?? "",
      timeline,
      suspicionSummary,
      finalScore: hasSubmission
        ? lastReport
          ? Math.max(0, 100 - ((lastReport["overallScore"] as number) ?? 0))
          : null
        : null,
    };

    return c.json({ success: true, data: response });
  } catch (error) {
    console.error("[review] get_session error:", error);
    return c.json(
      { success: false, error: "Failed to fetch session" },
      500
    );
  }
});

export { reviewRouter };