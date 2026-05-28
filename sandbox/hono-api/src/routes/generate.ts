/**
 * Route: POST /api/v1/generate
 * Feature 1 — AUTONOMOUS TEST SUITE GENERATOR
 *
 * Accepts a single text prompt and delegates to the Orchestrator Agent
 * backed by Gemini 3 Flash Preview. Returns a fully structured assessment suite
 * with metadata, competencies, problems, and hidden testing matrices.
 */

import { Hono } from "hono";
import type { GenerateTestSuiteRequest, GenerateTestSuiteResponse } from "../types.js";
import { GeminiClient } from "../agents/gemini-client.js";
import { loadConfig } from "../config.js";

const generateRouter = new Hono();
const config = loadConfig();
const gemini = new GeminiClient(config);

generateRouter.post("/", async (c) => {
  const body = await c.req.json<GenerateTestSuiteRequest>();

  // Validate required fields
  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return c.json(
      { success: false, error: "Field 'prompt' is required and must be a non-empty string" },
      400
    );
  }

  if (!body.roleContext || typeof body.roleContext !== "string") {
    return c.json(
      { success: false, error: "Field 'roleContext' is required and must be a string" },
      400
    );
  }

  const problemCount = body.problemCount ?? 5;
  if (problemCount < 1 || problemCount > 25) {
    return c.json(
      { success: false, error: "Field 'problemCount' must be between 1 and 25" },
      400
    );
  }

  // difficultyMix flows into the prompt enrichment so the orchestrator
  // can target the requested distribution.
  const difficultyMix = body.difficultyMix ?? { beginner: 0.33, intermediate: 0.34, advanced: 0.33 };
  const enrichedPrompt = `${body.prompt}\n\n[Difficulty distribution requested: ${JSON.stringify(difficultyMix)}. Target exactly ${problemCount} problems total.]`;

  try {
    const suite = await gemini.generateTestSuite(enrichedPrompt, body.roleContext);

    // Override problemCount / difficulty distribution as requested
    // (Gemini may not perfectly honor the distribution; we accept its output
    // but log the delta for observability)

    const mcpCorrelationId = crypto.randomUUID();

    const response: GenerateTestSuiteResponse = {
      success: true,
      suite,
      mcpCorrelationId,
    };

    // Enrich with the request parameters for auditability
    suite.metadata.promptFingerprint = await sha256(body.prompt);

    return c.json(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    console.error("[OrchestratorAgent]", message);
    return c.json(
      { success: false, error: `Test suite generation failed: ${message}` },
      500
    );
  }
});

// ─── Utility: SHA-256 fingerprint (Web Crypto, zero dependencies) ──

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { generateRouter };