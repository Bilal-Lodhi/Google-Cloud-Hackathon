/**
 * Route: POST /api/v1/generate
 * Feature 1 — AUTONOMOUS TEST SUITE GENERATOR
 *
 * Accepts a single text prompt and delegates to the Orchestrator Agent
 * backed by Gemini 3 Flash Preview. Returns a fully structured assessment suite
 * with metadata, competencies, problems, and hidden testing matrices.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ENTERPRISE HARDENING (2026-05-28):
 *   - MCP grounding operations are wrapped in isolated timeout
 *     trackers to prevent a slow MongoDB Atlas connection from
 *     bottlenecking upstream client requests.
 *   - Deep observability telemetry logs at every pipeline milestone.
 *   - JSON parse errors on the request body are caught and returned
 *     as structured 400 responses instead of crashing the event loop.
 * ═══════════════════════════════════════════════════════════════════
 */

import { Hono } from "hono";
import type { GenerateTestSuiteRequest, GenerateTestSuiteResponse } from "../types.js";
import { GeminiClient } from "../agents/gemini-client.js";
import { loadConfig } from "../config.js";

const generateRouter = new Hono();
const config = loadConfig();
const gemini = new GeminiClient(config);

// ─── MCP Grounding Constants ──────────────────────────────────────

/** MCP HTTP Adapter base URL (sidecar on port 3001). */
const MCP_BASE = process.env["MCP_URL"] ?? "http://localhost:3001";

/**
 * Maximum time (ms) the route will wait for an MCP grounding operation
 * before aborting and falling back. This prevents a slow MongoDB Atlas
 * connection from holding the upstream client request hostage.
 */
const MCP_GROUNDING_TIMEOUT_MS = 5_000;

// ─── POST / ───────────────────────────────────────────────────────

generateRouter.post("/", async (c) => {
  const requestId = c.res.headers.get("X-Correlation-Id") ?? crypto.randomUUID();
  console.log(`[Generate Route] [${requestId}] Incoming POST /api/v1/generate request`);

  // ── Step 1: Parse & Validate Request Body ──────────────────────
  let body: GenerateTestSuiteRequest;
  try {
    body = await c.req.json<GenerateTestSuiteRequest>();
    console.log(
      `[Generate Route] [${requestId}] Body parsed — promptLen=${body.prompt?.length ?? 0} ` +
        `roleContext="${body.roleContext ?? "undefined"}" problemCount=${body.problemCount ?? "default"}`
    );
  } catch (parseError) {
    console.error(
      `[Generate Route] [${requestId}] JSON parse failure on request body:`,
      parseError
    );
    return c.json(
      {
        success: false,
        error: "Invalid JSON body — request must be valid JSON with 'prompt' and 'roleContext' fields",
        correlationId: requestId,
      },
      400
    );
  }

  if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    console.warn(`[Generate Route] [${requestId}] Validation failed: missing/empty 'prompt'`);
    return c.json(
      { success: false, error: "Field 'prompt' is required and must be a non-empty string" },
      400
    );
  }

  // ── Semantic prompt validation: reject trivial/non-assessment inputs ──
  const trimmedPrompt = body.prompt.trim();
  const semanticError = validateAssessmentPrompt(trimmedPrompt);
  if (semanticError) {
    console.warn(
      `[Generate Route] [${requestId}] Semantic validation failed: "${semanticError}" — ` +
        `prompt="${trimmedPrompt.substring(0, 80)}..."`
    );
    return c.json(
      { success: false, error: semanticError, correlationId: requestId },
      400
    );
  }

  if (!body.roleContext || typeof body.roleContext !== "string") {
    console.warn(`[Generate Route] [${requestId}] Validation failed: missing 'roleContext'`);
    return c.json(
      { success: false, error: "Field 'roleContext' is required and must be a string" },
      400
    );
  }

  const problemCount = body.problemCount ?? 5;
  if (problemCount < 1 || problemCount > 25) {
    console.warn(
      `[Generate Route] [${requestId}] Validation failed: problemCount=${problemCount} out of range`
    );
    return c.json(
      { success: false, error: "Field 'problemCount' must be between 1 and 25" },
      400
    );
  }

  // Each sum of difficultyMix weights should be ~1.0; we log but don't reject
  const difficultyMix = body.difficultyMix ?? {
    beginner: 0.33,
    intermediate: 0.34,
    advanced: 0.33,
  };
  const mixSum = difficultyMix.beginner + difficultyMix.intermediate + difficultyMix.advanced;
  if (Math.abs(mixSum - 1.0) > 0.05) {
    console.warn(
      `[Generate Route] [${requestId}] Difficulty mix weights sum to ${mixSum.toFixed(3)} ` +
        `(expected ~1.0). Proceeding anyway.`
    );
  }

  const enrichedPrompt = `${body.prompt}\n\n[Difficulty distribution requested: ${JSON.stringify(difficultyMix)}. Target exactly ${problemCount} problems total.]`;
  console.log(
    `[Generate Route] [${requestId}] Prompt enriched — final length=${enrichedPrompt.length} chars`
  );

  // ── Step 2: Invoke Gemini Orchestrator (with its own internal retry/timeout) ──
  let mcpCorrelationId = crypto.randomUUID();
  let fingerprint = "";

  try {
    console.log(
      `[Generate Route] [${requestId}] Delegating to GeminiClient.generateTestSuite...`
    );
    const suiteStartMs = Date.now();

    const suite = await gemini.generateTestSuite(enrichedPrompt, body.roleContext, problemCount);

    const suiteElapsed = Date.now() - suiteStartMs;
    console.log(
      `[Generate Route] [${requestId}] GeminiClient returned suite in ${suiteElapsed}ms — ` +
        `${suite.problems.length} problems, ${suite.competencies.length} competencies`
    );

    // ── Step 3: Compute prompt fingerprint (non-blocking) ────────
    fingerprint = await sha256(body.prompt);
    suite.metadata.promptFingerprint = fingerprint;
    console.log(
      `[Generate Route] [${requestId}] SHA-256 fingerprint computed — ${fingerprint.substring(0, 12)}...`
    );

    // ── Step 4: MCP Grounding (isolated timeout) ─────────────────
    // This operation persists the generated suite to MongoDB Atlas
    // via the MCP HTTP adapter. If the MCP server or MongoDB is slow,
    // we abort after MCP_GROUNDING_TIMEOUT_MS and return success anyway
    // — the suite was already generated successfully.
    await persistSuiteViaMCP(suite, mcpCorrelationId, requestId);

    const response: GenerateTestSuiteResponse = {
      success: true,
      suite,
      mcpCorrelationId,
    };

    console.log(
      `[Generate Route] [${requestId}] COMPLETE — 201 Created, correlationId=${mcpCorrelationId}`
    );
    return c.json(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown agent error";
    const stack = error instanceof Error ? error.stack : "";
    console.error(
      `[Generate Route] [${requestId}] FAILURE — ${message}`,
      stack
    );

    // ── Classify error for proper HTTP status ────────────────────
    // 503: Gemini is overloaded / timed out — client should retry
    // 500: Unexpected / internal error — may not be retryable
    const isGeminiOverloaded =
      message.includes("Gemini request failed after") ||
      message.includes("timed out after") ||
      message.includes("overloaded") ||
      message.includes("Gemini API error 503") ||
      message.includes("Gemini API error 504") ||
      message.includes("Gemini API error 429");

    const statusCode = isGeminiOverloaded ? 503 : 500;
    const userError = isGeminiOverloaded
      ? "Gemini is currently busy. Please retry in a moment."
      : `Test suite generation failed: ${message}`;

    return c.json(
      {
        success: false,
        error: userError,
        correlationId: requestId,
        retryable: isGeminiOverloaded,
      },
      statusCode
    );
  }
});

// ─── MCP Persistence Helper ────────────────────────────────────────

/**
 * Persists the generated test suite to MongoDB via the MCP HTTP adapter.
 *
 * This operation is wrapped in an isolated AbortController timeout so
 * that a slow MongoDB Atlas connection cannot starve the upstream
 * client request for more than {@link MCP_GROUNDING_TIMEOUT_MS}.
 *
 * If the MCP call fails or times out, the function logs the incident
 * and resolves silently — the suite was already generated and returned
 * to the caller. MCP persistence is a "best-effort" audit trail.
 */
async function persistSuiteViaMCP(
  suite: unknown,
  correlationId: string,
  requestId: string
): Promise<void> {
  console.log(
    `[MCP Grounding] [${requestId}] Syncing tool payloads → correlationId=${correlationId}`
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn(
      `[MCP Grounding] [${requestId}] ABORTING after ${MCP_GROUNDING_TIMEOUT_MS}ms — ` +
        `MCP/MongoDB unresponsive. Suite was already returned to client.`
    );
    controller.abort();
  }, MCP_GROUNDING_TIMEOUT_MS);

  try {
    const mcpStartMs = Date.now();
    const mcpRes = await fetch(`${MCP_BASE}/tools/store_test_suite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suite,
        correlationId,
        persistedAt: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    const mcpElapsed = Date.now() - mcpStartMs;

    if (!mcpRes.ok) {
      const errBody = await mcpRes.text().catch(() => "<unreadable>");
      console.error(
        `[MCP Grounding] [${requestId}] Persist failed — HTTP ${mcpRes.status} ` +
          `after ${mcpElapsed}ms: ${errBody.substring(0, 300)}`
      );
      // Non-fatal: suite was already returned to client
      return;
    }

    const mcpResult = (await mcpRes.json().catch(() => ({}))) as {
      success?: boolean;
      documentId?: string;
    };

    console.log(
      `[MCP Grounding] [${requestId}] Persist SUCCESS in ${mcpElapsed}ms — ` +
        `documentId=${mcpResult.documentId ?? "unknown"}, success=${mcpResult.success ?? false}`
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(
        `[MCP Grounding] [${requestId}] Persist TIMED OUT after ${MCP_GROUNDING_TIMEOUT_MS}ms. ` +
          `MCP/MongoDB may be unavailable — suite generation was unaffected.`
      );
    } else {
      console.error(
        `[MCP Grounding] [${requestId}] Persist error:`,
        error instanceof Error ? error.message : String(error)
      );
    }
    // Non-fatal — do NOT rethrow
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Utility: SHA-256 fingerprint (Web Crypto, zero dependencies) ──

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Semantic Prompt Validation ────────────────────────────────────

/**
 * Rejects prompts that are clearly not valid assessment-generation requests.
 *
 * Cerberus-AI is a test suite generator, not a general-purpose chatbot.
 * Trivial greetings, single-word inputs, or prompts shorter than a meaningful
 * assessment description are rejected early — before wasting a Gemini API call.
 *
 * Returns a user-facing error message if the prompt is invalid, or `null` if
 * the prompt passes semantic validation.
 */
function validateAssessmentPrompt(prompt: string): string | null {
  const MIN_WORD_COUNT = 4;
  const MIN_LENGTH = 20;

  // ── Trivial / greeting-only prompts ──────────────────────────────
  const trivialPatterns = [
    /^(hi|hey|hello|yo|sup|hola|howdy|greetings)[\s!.,]*$/i,
    /^(good\s+(morning|afternoon|evening|night))[\s!.,]*$/i,
    /^(what('s|\s+is)\s+up|how\s+are\s+you|wyd|wbu)[\s?.,]*$/i,
    /^(ok|okay|k|kk|alright|fine|cool|nice|great|awesome|thanks|thx|ty|bye)[\s!.,]*$/i,
    /^(test|testing|test\s+1\s*2\s*3)[\s!.,]*$/i,
    /^(help|what\s+is\s+this|what\s+do\s+you\s+do)[\s?.,]*$/i,
  ];

  if (trivialPatterns.some((p) => p.test(prompt))) {
    return (
      'This is an assessment test-suite generator. Please describe the role, ' +
      'skills, or competencies you want to assess. For example:\n' +
      '"Generate a senior TypeScript coding assessment covering async patterns, ' +
      'generics, and React hooks."'
    );
  }

  // ── Too short (single word or token) ─────────────────────────────
  const words = prompt.split(/\s+/).filter((w) => w.length > 0);

  if (prompt.length < MIN_LENGTH) {
    return (
      `Prompt must be at least ${MIN_LENGTH} characters. ` +
      'Please provide a meaningful description of the assessment you want to generate.'
    );
  }

  if (words.length < MIN_WORD_COUNT) {
    return (
      'Prompt is too short. Please describe the role, skills, or competencies ' +
      'you want to assess. Provide at least a sentence or two.'
    );
  }

  // ── Missing assessment-related keywords ──────────────────────────
  const assessmentKeywords = [
    'test', 'assess', 'assessment', 'exam', 'quiz', 'evaluate',
    'generate', 'create', 'build', 'design', 'problem',
    'coding', 'programming', 'developer', 'engineer', 'architect',
    'typescript', 'javascript', 'python', 'java', 'rust', 'go', 'c#',
    'react', 'angular', 'vue', 'node', 'express', 'next', 'nestjs',
    'frontend', 'backend', 'fullstack', 'full-stack', 'devops',
    'senior', 'junior', 'lead', 'principal', 'staff',
    'competency', 'skill', 'proficiency', 'knowledge', 'ability',
    'algorithm', 'data structure', 'system design', 'architecture',
    'database', 'sql', 'nosql', 'mongodb', 'postgres',
    'api', 'rest', 'graphql', 'grpc',
    'cloud', 'aws', 'gcp', 'azure', 'docker', 'kubernetes',
  ];

  const promptLower = prompt.toLowerCase();
  const hasAssessmentIntent = assessmentKeywords.some((kw) =>
    promptLower.includes(kw)
  );

  if (!hasAssessmentIntent) {
    return (
      'Your prompt does not appear to describe an assessment or test scenario. ' +
      'Please include details like the target role, skills to assess, problem ' +
      'types, or difficulty level. For example:\n' +
      '"Create a Python coding test for mid-level backend engineers focusing on ' +
      'async I/O, database queries, and REST API design."'
    );
  }

  return null; // Prompt passes all validations
}

export { generateRouter };
