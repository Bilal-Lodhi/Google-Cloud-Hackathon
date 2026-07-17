/**
 * Health check and capability discovery endpoint.
 * Provides OpenAPI-aligned metadata for the agent ecosystem.
 */

import { Hono } from "hono";
import { toISOStringLocal } from "../utils/time.js";
import { getDataHubClient } from "../agents/datahub-client.js";

const healthRouter = new Hono();

healthRouter.get("/", async (c) => {
  let datahubStatus = { enabled: false, connected: false, latencyMs: 0 };

  try {
    const datahub = getDataHubClient();
    datahubStatus = { enabled: true, ...(await datahub.healthCheck()) };
  } catch {
    // DataHub client not initialized — ignore
  }

  return c.json({
    status: "healthy",
    service: "cerberus-finsect",
    version: "1.0.0",
    platform: "Google Cloud Run",
    modelProvider: "Gemini 3 Flash Preview (Vertex AI / Gemini API)",
    mcpTrack: "MongoDB Atlas",
    integrations: {
      datahub: datahubStatus,
    },
    features: {
      autonomousTestGeneration: "/api/v1/generate",
      intentGuardian: "/api/v1/guardian/ingest",
      analyticalReview: "/api/v1/sessions/:sessionId/review",
    },
    uptime: process.uptime(),
    timestamp: toISOStringLocal(),
  });
});

export { healthRouter };
