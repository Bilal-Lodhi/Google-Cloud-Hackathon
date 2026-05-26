/**
 * Route: GET /api/v1/sessions/:sessionId/review
 * Feature 3 (Backend API) — INTERACTIVE ANALYTICAL REVIEW LOG
 *
 * Serves the complete session review payload consumed by the Flutter
 * split-panel analytical review UI. Returns submitted code, timestamped
 * security metrics, suspicion scores, and behavioral flags.
 */

import { Hono } from "hono";
import type { SessionReviewResponse } from "../types.js";
import { sessionStore } from "./guardian.js";

const reviewRouter = new Hono();

reviewRouter.get("/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionStore.get(sessionId);

  if (!session) {
    return c.json(
      { success: false, error: `Session '${sessionId}' not found` },
      404
    );
  }

  // Build the complete timeline from all stored micro-events
  const timeline = session.events.map((event) => {
    let severity: "info" | "warning" | "critical" = "info";
    let label: string = event.eventType;
    let detail = "";

    switch (event.eventType) {
      case "KEYSTROKE":
        label = "Keystroke";
        detail = `Delta: ${event.payload.deltaMs ?? "N/A"}ms`;
        if (event.payload.deltaMs !== undefined && event.payload.deltaMs < 80) {
          severity = "warning";
        }
        break;
      case "PASTE_TRIGGER":
        label = "Paste Event";
        detail = `Content length: ${event.payload.pasteContent?.length ?? 0} chars`;
        severity = "critical";
        break;
      case "CODE_DELTA":
        label = "Code Change";
        detail = `Diff size: ${event.payload.diffPatch?.length ?? 0} chars`;
        severity = "info";
        break;
      case "TAB_SWITCH":
        label = "Tab Switch";
        detail = `Visibility: ${event.payload.visibilityState ?? "unknown"}`;
        severity = "warning";
        break;
      case "WINDOW_BLUR":
        label = "Window Blur";
        detail = "Candidate left the test window";
        severity = "warning";
        break;
      case "COPY_ATTEMPT":
        label = "Copy Attempt";
        detail = `Selected: ${(event.payload.selectedText?.length ?? 0)} chars`;
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
  let status: SessionReviewResponse["status"] = "in_progress";
  const hasSubmission = session.events.some((e) => e.eventType === "SUBMIT");
  const isFlagged = session.lastSuspicionPayload !== null &&
    session.lastSuspicionPayload.overallScore > 50;

  if (hasSubmission && isFlagged) {
    status = "flagged";
  } else if (hasSubmission) {
    status = "submitted";
  } else if (isFlagged) {
    status = "flagged";
  }

  const suspicionSummary: SessionReviewResponse["suspicionSummary"] =
    session.lastSuspicionPayload ? [session.lastSuspicionPayload] : [];

  const response: SessionReviewResponse = {
    sessionId: session.sessionId,
    candidateId: session.candidateId,
    assessmentId: session.assessmentId,
    status,
    submittedCode: session.currentCode,
    timeline,
    suspicionSummary,
    finalScore: hasSubmission
      ? session.lastSuspicionPayload
        ? Math.max(0, 100 - session.lastSuspicionPayload.overallScore)
        : null
      : null,
  };

  return c.json({ success: true, data: response });
});

export { reviewRouter };