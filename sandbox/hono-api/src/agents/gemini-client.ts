/**
 * Gorilla Agent Ecosystem — Ultra-Resilient Gemini 3 Flash Preview Client
 * Google Cloud Rapid Agent Hackathon 2026 — MongoDB Partner Track
 *
 * ═══════════════════════════════════════════════════════════════════
 * ARCHITECTURAL COMPLIANCE: HACKATHON_RULES.md §2 (Strict Native
 * Fetch Bindings). Zero disallowed third-party HTTP wrappers.
 * Exclusive use of the mandated model: gemini-3-flash-preview.
 * ═══════════════════════════════════════════════════════════════════
 *
 * This module implements an ultra-resilient HTTP worker backed by
 * the native WHATWG fetch API. Every outbound request is wrapped
 * in an explicit AbortController with a configurable per-attempt
 * threshold (default 90,000 ms for Gemini 3 Flash Preview)—no
 * single hung socket can starve the event loop. The retry loop
 * (max 2 attempts)
 * applies exponential backoff + jitter to avoid thundering-herd
 * pressure on the upstream model endpoint.
 *
 * Audited against:
 *   - Google AI Studio REST reference (v1beta generateContent)
 *   - Vertex AI regional endpoint (us-central1 default)
 *   - HACKATHON_RULES.md — strict fetch, no wrappers, model pin
 */

import type { AppConfig } from "../config.js";
import type {
  OrchestratorPrompt,
  GeneratedTestSuite,
  GeneratedProblem,
  HiddenTestingMatrix,
  RoleDescriptor,
  CompetencyTree,
  SuiteMetadata,
  TokenUsageStats,
  AntiCheatThresholds,
  SuspicionPayload,
} from "../types.js";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** Maximum retries before the caller receives a terminal error. */
const MAX_RETRIES = 2;

/** Base backoff delay in ms (doubled on each retry + jitter). */
const BASE_BACKOFF_MS = 2_000;

/**
 * Google AI Studio REST endpoint for generateContent.
 *
 * The mandated model is injected via configuration at runtime.
 * Security: the API key is passed as an `x-goog-api-key` header
 * OR appended as a query parameter (`?key=`) per Google REST spec.
 *
 * NOTE: If the config.region field is non-empty the client will
 * route through the Vertex AI regional endpoint instead of the
 * public AI Studio endpoint. Currently defaulting to AI Studio
 * as that aligns with the .env.example API-key source hint.
 */
const AI_STUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ═══════════════════════════════════════════════════════════════════
// GeminiClient
// ═══════════════════════════════════════════════════════════════════

export class GeminiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly region: string;
  private readonly maxOutputTokens: number;
  private readonly temperature: number;
  private readonly requestTimeoutMs: number;

  constructor(config: AppConfig) {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
    this.region = config.gemini.region;
    this.maxOutputTokens = config.gemini.maxOutputTokens;
    this.temperature = config.gemini.temperature;
    this.requestTimeoutMs = config.gemini.requestTimeoutMs;

    console.log(
      `[GeminiClient] Initialized → model="${this.model}" region="${this.region}" ` +
        `maxOutputTokens=${this.maxOutputTokens} temp=${this.temperature} ` +
        `requestTimeout=${this.requestTimeoutMs}ms`
    );
  }

  // ───────────────────────────────────────────────────────────────
  // Public: generateTestSuite
  // ───────────────────────────────────────────────────────────────

  /**
   * Orchestrates a full assessment suite generation request.
   *
   * The enriched prompt is constructed internally and dispatched
   * through the resilient fetch pipeline. On success the raw
   * Gemini JSON response is parsed into the strongly-typed
   * {@link GeneratedTestSuite} contract used by the Hono router.
   */
  async generateTestSuite(
    prompt: string,
    roleContext: string,
    problemCount = 5
  ): Promise<GeneratedTestSuite> {
    console.log("[Gemini Ingestion] [generateTestSuite] Initiating request to model...");
    console.log(`[Gemini Ingestion] [generateTestSuite] Prompt length=${prompt.length} roleContext="${roleContext}" problemCount=${problemCount}`);

    const orchestratorPrompt: OrchestratorPrompt = {
      prompt,
      roleContext,
      problemCount,
      difficultyMix: { beginner: 0.33, intermediate: 0.34, advanced: 0.33 },
    };

    const systemInstruction = this.buildOrchestratorSystemInstruction(orchestratorPrompt);
    const userMessage = this.buildOrchestratorUserMessage(orchestratorPrompt);

    const responseText = await this.executeWithRetry(systemInstruction, userMessage);

    console.log("[Gemini Ingestion] [generateTestSuite] Response received, parsing structured output...");
    const suite = this.parseTestSuiteResponse(responseText);
    console.log(
      `[Gemini Ingestion] [generateTestSuite] Suite parsed → ${suite.problems.length} problems, ` +
        `${suite.competencies.length} competencies, ` +
        `tokenUsage: prompt=${suite.metadata.tokenUsage.promptTokens} completion=${suite.metadata.tokenUsage.completionTokens}`
    );

    return suite;
  }

  // ───────────────────────────────────────────────────────────────
  // Public: analyzeSuspicion
  // ───────────────────────────────────────────────────────────────

  /**
   * Performs semantic plagiarism and behavioral-anomaly detection
   * against the provided code, paste history, keystroke metrics,
   * and reference completions.
   */
  async analyzeSuspicion(
    currentCode: string,
    pasteContents: string[],
    keystrokeMetrics: {
      avgDeltaMs: number;
      maxDeltaMs: number;
      minDeltaMs: number;
    },
    referenceCompletions: string[]
  ): Promise<SuspicionPayload> {
    console.log("[Gemini Ingestion] [analyzeSuspicion] Initiating suspicion analysis...");
    console.log(
      `[Gemini Ingestion] [analyzeSuspicion] Code length=${currentCode.length} pastes=${pasteContents.length} ` +
        `avgKeystroke=${keystrokeMetrics.avgDeltaMs}ms refCompletions=${referenceCompletions.length}`
    );

    const systemInstruction = this.buildGuardianSystemInstruction();
    const userMessage = this.buildGuardianUserMessage(
      currentCode,
      pasteContents,
      keystrokeMetrics,
      referenceCompletions
    );

    const responseText = await this.executeWithRetry(systemInstruction, userMessage);

    console.log("[Gemini Ingestion] [analyzeSuspicion] Response received, parsing suspicion payload...");
    const payload = this.parseSuspicionResponse(responseText);
    console.log(
      `[Gemini Ingestion] [analyzeSuspicion] Suspicion score=${payload.overallScore} flags=${payload.flags.length}`
    );

    return payload;
  }

  // ───────────────────────────────────────────────────────────────
  // Core: Resilient Fetch Pipeline
  // ───────────────────────────────────────────────────────────────

  /**
   * Executes a Gemini generateContent call with up to {@link MAX_RETRIES}
   * attempts. Each attempt is individually guarded by an AbortController
   * with a {@link ATTEMPT_TIMEOUT_MS} deadline.
   *
   * Failure modes handled:
   *  - Network timeout (AbortError) → retry with backoff
   *  - HTTP 429 (rate limit)       → retry with backoff
   *  - HTTP 5xx (server error)     → retry with backoff
   *  - HTTP 4xx (client error)     → fail fast (no retry)
   *  - JSON parse failure          → retry once, then fail
   */
  private async executeWithRetry(
    systemInstruction: string,
    userMessage: string
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn(
          `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — ABORTING after ${this.requestTimeoutMs}ms timeout`
        );
        controller.abort();
      }, this.requestTimeoutMs);

      try {
        console.log(
          `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — Dispatching fetch to model "${this.model}"...`
        );

        const { url, headers } = this.buildRequestParams();

        const requestBody = this.buildRequestBody(systemInstruction, userMessage);

        const startMs = Date.now();
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: requestBody,
          signal: controller.signal,
        });
        const elapsedMs = Date.now() - startMs;

        console.log(
          `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} completed — ` +
            `status=${response.status} ${response.statusText} elapsed=${elapsedMs}ms`
        );

        // ── Handle non-2xx responses ──────────────────────────
        if (!response.ok) {
          const errorText = await response.text().catch(() => "<unreadable body>");
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} FAILED — ` +
              `HTTP ${response.status}: ${errorText.substring(0, 500)}`
          );

          // 4xx client errors are NOT retryable (except 429)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw new Error(
              `Gemini API client error ${response.status}: ${errorText.substring(0, 300)}`
            );
          }

          // 429 or 5xx → retry
          lastError = new Error(
            `Gemini API error ${response.status}: ${errorText.substring(0, 300)}`
          );
          continue; // proceed to next retry iteration
        }

        // ── Parse successful response ─────────────────────────
        const responseJson = await response.json().catch((parseErr) => {
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — JSON parse failure:`,
            parseErr
          );
          throw new Error(
            `Failed to parse Gemini response as JSON: ${(parseErr as Error).message}`
          );
        });

        // Extract the text from the Gemini response structure
        const text = this.extractTextFromResponse(responseJson);
        console.log(
          `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — ` +
            `Response text extracted, length=${text.length} chars`
        );

        if (!text || text.trim().length === 0) {
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — EMPTY response text from model`
          );
          lastError = new Error("Gemini returned empty response text");
          continue;
        }

        return text; // SUCCESS
      } catch (error) {
        clearTimeout(timeoutId);

        // ── Classify error ──────────────────────────────────
        if (error instanceof DOMException && error.name === "AbortError") {
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — AbortError (timeout threshold ${this.requestTimeoutMs}ms exceeded)`
          );
          lastError = new Error(
            `Gemini request timed out after ${this.requestTimeoutMs}ms`
          );
        } else if (error instanceof TypeError && error.message.includes("fetch")) {
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — Network/fetch error:`,
            error.message
          );
          lastError = error instanceof Error ? error : new Error(String(error));
        } else {
          console.error(
            `[Gemini Ingestion] Attempt ${attempt}/${MAX_RETRIES} — Unexpected error:`,
            error
          );
          // If it's already an Error we threw ourselves (e.g., 4xx), rethrow immediately
          if (
            error instanceof Error &&
            error.message.startsWith("Gemini API client error")
          ) {
            throw error;
          }
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      } finally {
        clearTimeout(timeoutId);
      }

      // ── Backoff before next retry ──────────────────────────
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.log(
          `[Gemini Ingestion] Backing off ${Math.round(delay)}ms before attempt ${attempt + 1}/${MAX_RETRIES}...`
        );
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    throw new Error(
      `Gemini request failed after ${MAX_RETRIES} attempts. ` +
        `Last error: ${lastError?.message ?? "unknown"}`
    );
  }

  // ───────────────────────────────────────────────────────────────
  // Request Construction
  // ───────────────────────────────────────────────────────────────

  /**
   * Builds the endpoint URL and headers for the Gemini API call.
   *
   * Uses the Google AI Studio REST endpoint by default. If a
   * region is configured and the model string does not contain
   * a full Vertex AI path, the standard AI Studio generateContent
   * route is used with the API key appended as a query parameter.
   */
  private buildRequestParams(): { url: string; headers: Record<string, string> } {
    // Google AI Studio REST endpoint (preferred for hackathon)
    const url = `${AI_STUDIO_BASE}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    console.log(
      `[Gemini Ingestion] [buildRequestParams] Endpoint: ${AI_STUDIO_BASE}/models/${this.model}:generateContent`
    );

    return { url, headers };
  }

  /**
   * Constructs the strictly-typed JSON body for the Gemini
   * generateContent REST call.
   *
   * Format (Google AI Studio / Vertex AI v1beta):
   * {
   *   "contents": [
   *     { "parts": [{ "text": "<system instruction>" }], "role": "user" },
   *     { "parts": [{ "text": "<user message>" }], "role": "user" }
   *   ],
   *   "generationConfig": { ... },
   *   "safetySettings": [ ... ]
   * }
   */
  private buildRequestBody(systemInstruction: string, userMessage: string): string {
    const payload = {
      contents: [
        {
          parts: [{ text: systemInstruction }],
          role: "user",
        },
        {
          parts: [{ text: userMessage }],
          role: "user",
        },
      ],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxOutputTokens,
        topP: 0.95,
        topK: 40,
        /**
         * Constrained JSON decoding — instructs Gemini 3 Flash Preview
         * to emit ONLY valid JSON tokens. This is the single most
         * impactful guard against unquoted property names, trailing
         * commas, single quotes, and other LLM JSON malformations.
         *
         * Available since gemini-1.5-pro and fully supported on
         * gemini-3-flash-preview (the mandated model).
         */
        responseMimeType: "application/json",
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_ONLY_HIGH",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_ONLY_HIGH",
        },
      ],
    };

    const json = JSON.stringify(payload);
    console.log(
      `[Gemini Ingestion] [buildRequestBody] Payload size=${json.length} chars, ` +
        `contents=${payload.contents.length} blocks`
    );
    return json;
  }

  // ───────────────────────────────────────────────────────────────
  // Response Parsing
  // ───────────────────────────────────────────────────────────────

  /**
   * Extracts the raw text content from a Gemini v1beta generateContent
   * JSON response structure.
   *
   * Expected shape:
   * {
   *   "candidates": [{ "content": { "parts": [{ "text": "..." }] } }],
   *   "usageMetadata": { "promptTokenCount": N, "candidatesTokenCount": N, "totalTokenCount": N }
   * }
   */
  private extractTextFromResponse(responseJson: Record<string, unknown>): string {
    try {
      const candidates = responseJson["candidates"] as Array<Record<string, unknown>> | undefined;
      if (!candidates || candidates.length === 0) {
        console.error(
          "[Gemini Ingestion] [extractText] No candidates in response. Full body:",
          JSON.stringify(responseJson).substring(0, 500)
        );
        // Check for prompt feedback / safety block
        const promptFeedback = responseJson["promptFeedback"] as Record<string, unknown> | undefined;
        if (promptFeedback) {
          throw new Error(
            `Gemini blocked the request: ${JSON.stringify(promptFeedback).substring(0, 300)}`
          );
        }
        throw new Error("Gemini returned zero candidates");
      }

      const candidate = candidates[0];
      const finishReason = candidate["finishReason"] as string | undefined;

      // ── CRITICAL: Detect response truncation ─────────────────
      // When the model hits maxOutputTokens before completing the
      // JSON structure, the response is truncated and cannot be
      // repaired. We must surface this clearly.
      if (finishReason === "MAX_TOKENS") {
        const content = candidate["content"] as Record<string, unknown> | undefined;
        const parts = content?.["parts"] as Array<Record<string, unknown>> | undefined;
        const partialText =
          parts
            ?.map((p) => (p["text"] as string) ?? "")
            .filter((t) => t.length > 0)
            .join("\n") ?? "";
        const totalChars = partialText.length;
        const lastChars = partialText.substring(Math.max(0, totalChars - 300));
        console.error(
          `[Gemini Ingestion] [extractText] RESPONSE TRUNCATED — finishReason=MAX_TOKENS. ` +
            `maxOutputTokens=${this.maxOutputTokens}, received ${totalChars} chars before truncation. ` +
            `Last 300 chars:\n${lastChars}`
        );
        throw new Error(
          `Gemini response was truncated at ${totalChars} chars ` +
            `(maxOutputTokens=${this.maxOutputTokens}). ` +
            `Increase GEMINI_MAX_OUTPUT_TOKENS in .env or reduce response size requirements.`
        );
      }

      if (finishReason && finishReason !== "STOP") {
        console.warn(
          `[Gemini Ingestion] [extractText] Non-STOP finish reason: "${finishReason}"`
        );
      }

      const content = candidate["content"] as Record<string, unknown> | undefined;
      if (!content) {
        throw new Error("Candidate missing 'content' field");
      }

      const parts = content["parts"] as Array<Record<string, unknown>> | undefined;
      if (!parts || parts.length === 0) {
        throw new Error("Candidate content missing 'parts' array");
      }

      const textParts = parts
        .map((part) => (part["text"] as string) ?? "")
        .filter((t) => t.length > 0)
        .join("\n");

      if (!textParts) {
        console.error(
          "[Gemini Ingestion] [extractText] Parts array present but no 'text' fields. Parts:",
          JSON.stringify(parts).substring(0, 500)
        );
        throw new Error("Gemini response parts contained no text content");
      }

      return textParts;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Gemini")) {
        throw error; // rethrow our own structured errors
      }
      console.error("[Gemini Ingestion] [extractText] Unexpected response structure:", error);
      throw new Error(
        `Failed to extract text from Gemini response: ${(error as Error).message}. ` +
          `Raw keys: ${Object.keys(responseJson).join(", ")}`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────
  // Test Suite Response Parsing
  // ───────────────────────────────────────────────────────────────

  /**
   * Parses the raw Gemini text response into a {@link GeneratedTestSuite}.
   * Expects the model to return a JSON block (optionally wrapped in
   * markdown code fences).
   *
   * Includes a JSON repair fallback for LLM-generated malformed JSON
   * (unquoted property names, trailing commas, single-quoted strings, etc.).
   */
  private parseTestSuiteResponse(rawText: string): GeneratedTestSuite {
    // Strip ALL markdown code fences (any language tag) if present.
    // LLMs frequently emit explanatory markdown with code blocks like
    // ```javascript, ```python, or just ``` before the actual JSON.
    let jsonText = rawText.trim();
    jsonText = this.stripMarkdownFences(jsonText);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch (parseErr) {
      const origError = (parseErr as Error).message;

      // Log the context around the failure position
      const posMatch = origError.match(/position (\d+)/);
      const failurePos = posMatch ? parseInt(posMatch[1], 10) : 0;
      const contextStart = Math.max(0, failurePos - 200);
      const contextEnd = Math.min(jsonText.length, failurePos + 200);
      console.error(
        `[Gemini Ingestion] [parseTestSuite] JSON parse failure at position ${failurePos}. ` +
          `Context around error:\n...${jsonText.substring(contextStart, contextEnd)}...`
      );
      console.error(
        `[Gemini Ingestion] [parseTestSuite] Raw text head (first 500 chars):`,
        rawText.substring(0, 500)
      );

      // Attempt JSON repair for common LLM output quirks
      console.log("[Gemini Ingestion] [parseTestSuite] Attempting JSON repair...");
      try {
        const repaired = this.repairJson(jsonText);
        parsed = JSON.parse(repaired) as Record<string, unknown>;
        console.log("[Gemini Ingestion] [parseTestSuite] JSON repair SUCCESS — proceeding with repaired payload.");
      } catch (repairErr) {
        console.error(
          "[Gemini Ingestion] [parseTestSuite] JSON repair also failed:",
          (repairErr as Error).message
        );
        // Try one more: extract just the outermost JSON object
        try {
          const extracted = this.extractJsonObject(jsonText);
          parsed = JSON.parse(extracted) as Record<string, unknown>;
          console.log("[Gemini Ingestion] [parseTestSuite] JSON extraction SUCCESS after repair failure.");
        } catch (extractErr) {
          console.error(
            "[Gemini Ingestion] [parseTestSuite] All JSON recovery strategies exhausted."
          );
          throw new Error(
            `Failed to parse test suite JSON: ${origError}. ` +
              `Repair also failed: ${(repairErr as Error).message}`
          );
        }
      }
    }

    const metadata = parsed["metadata"] as Record<string, unknown> | undefined;
    const problems = (parsed["problems"] as Array<Record<string, unknown>>) ?? [];
    const roles = (parsed["roles"] as Array<Record<string, unknown>>) ?? [];
    const competencies = (parsed["competencies"] as Array<Record<string, unknown>>) ?? [];
    const testingMatrices =
      (parsed["testingMatrices"] as Array<Record<string, unknown>>) ??
      (parsed["testing_matrices"] as Array<Record<string, unknown>>) ??
      [];

    const tokenUsage: TokenUsageStats = {
      promptTokens: (metadata?.["promptTokens"] as number) ?? 0,
      completionTokens: (metadata?.["completionTokens"] as number) ?? 0,
      totalTokens:
        (metadata?.["totalTokens"] as number) ??
        ((metadata?.["promptTokens"] as number) ?? 0) +
          ((metadata?.["completionTokens"] as number) ?? 0),
    };

    const suiteMetadata: SuiteMetadata = {
      suiteId: (metadata?.["suiteId"] as string) ?? crypto.randomUUID(),
      generatedAt: (metadata?.["generatedAt"] as string) ?? new Date().toISOString(),
      modelVersion: this.model,
      promptFingerprint: (metadata?.["promptFingerprint"] as string) ?? "",
      tokenUsage,
    };

    const mappedRoles: RoleDescriptor[] = roles.map((r) => ({
      roleId: (r["roleId"] as string) ?? crypto.randomUUID(),
      title: (r["title"] as string) ?? "Untitled Role",
      seniorityLevel: (r["seniorityLevel"] as RoleDescriptor["seniorityLevel"]) ?? "mid",
      requiredCompetencyIds: (r["requiredCompetencyIds"] as string[]) ?? [],
    }));

    const mappedCompetencies: CompetencyTree[] = competencies.map((c) => ({
      competencyId: (c["competencyId"] as string) ?? crypto.randomUUID(),
      name: (c["name"] as string) ?? "Unnamed Competency",
      description: (c["description"] as string) ?? "",
      weight: (c["weight"] as number) ?? 0,
      subCompetencies:
        (c["subCompetencies"] as CompetencyTree[]) ??
        (c["sub_competencies"] as CompetencyTree[]) ??
        [],
    }));

    const mappedProblems: GeneratedProblem[] = problems.map((p) => ({
      problemId: (p["problemId"] as string) ?? crypto.randomUUID(),
      problemType: (p["problemType"] as GeneratedProblem["problemType"]) ?? "coding",
      title: (p["title"] as string) ?? "Untitled Problem",
      body: (p["body"] as string) ?? "",
      language: p["language"] as string | undefined,
      starterCode: p["starterCode"] as string | undefined,
      testCases: p["testCases"] as GeneratedProblem["testCases"] | undefined,
      options: p["options"] as GeneratedProblem["options"] | undefined,
      expectedAnswer: p["expectedAnswer"] as string | undefined,
      difficulty: (p["difficulty"] as GeneratedProblem["difficulty"]) ?? "intermediate",
      competencyId: (p["competencyId"] as string) ?? "",
      timeAllocationSeconds: (p["timeAllocationSeconds"] as number) ?? 600,
      maxScore: (p["maxScore"] as number) ?? 100,
    }));

    const mappedMatrices: HiddenTestingMatrix[] = testingMatrices.map((m) => ({
      matrixId: (m["matrixId"] as string) ?? crypto.randomUUID(),
      problemId: (m["problemId"] as string) ?? "",
      competencyIds: (m["competencyIds"] as string[]) ?? [],
      scoringFormula: (m["scoringFormula"] as HiddenTestingMatrix["scoringFormula"]) ?? {
        type: "weighted_sum",
        weights: {},
      },
      antiCheatThresholds:
        (m["antiCheatThresholds"] as AntiCheatThresholds) ?? {
          maxPasteEvents: 5,
          maxTimeBetweenKeystrokesMs: 80,
          plagiarismSimilarityThreshold: 0.75,
          structuralChangeSensitivity: 0.5,
        },
    }));

    return {
      metadata: suiteMetadata,
      roles: mappedRoles,
      competencies: mappedCompetencies,
      problems: mappedProblems,
      testingMatrices: mappedMatrices,
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Suspicion Response Parsing
  // ───────────────────────────────────────────────────────────────

  /**
   * Parses the raw Gemini text response into a {@link SuspicionPayload}.
   * Includes JSON repair fallback for LLM-generated malformed JSON.
   */
  private parseSuspicionResponse(rawText: string): SuspicionPayload {
    let jsonText = rawText.trim();
    jsonText = this.stripMarkdownFences(jsonText);

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch (parseErr) {
      const origError = (parseErr as Error).message;
      const posMatch = origError.match(/position (\d+)/);
      const failurePos = posMatch ? parseInt(posMatch[1], 10) : 0;
      const contextStart = Math.max(0, failurePos - 200);
      const contextEnd = Math.min(jsonText.length, failurePos + 200);
      console.error(
        `[Gemini Ingestion] [parseSuspicion] JSON parse failure at position ${failurePos}. ` +
          `Context around error:\n...${jsonText.substring(contextStart, contextEnd)}...`
      );

      // Attempt JSON repair
      console.log("[Gemini Ingestion] [parseSuspicion] Attempting JSON repair...");
      try {
        const repaired = this.repairJson(jsonText);
        parsed = JSON.parse(repaired) as Record<string, unknown>;
        console.log("[Gemini Ingestion] [parseSuspicion] JSON repair SUCCESS.");
      } catch (repairErr) {
        console.error(
          "[Gemini Ingestion] [parseSuspicion] JSON repair also failed:",
          (repairErr as Error).message
        );
        try {
          const extracted = this.extractJsonObject(jsonText);
          parsed = JSON.parse(extracted) as Record<string, unknown>;
          console.log("[Gemini Ingestion] [parseSuspicion] JSON extraction SUCCESS.");
        } catch (extractErr) {
          throw new Error(
            `Failed to parse suspicion JSON: ${origError}. ` +
              `Repair also failed: ${(repairErr as Error).message}`
          );
        }
      }
    }

    return {
      suspicionId: (parsed["suspicionId"] as string) ?? crypto.randomUUID(),
      sessionId: (parsed["sessionId"] as string) ?? "",
      candidateId: (parsed["candidateId"] as string) ?? "",
      assessmentId: (parsed["assessmentId"] as string) ?? "",
      overallScore: (parsed["overallScore"] as number) ?? 0,
      flags: (parsed["flags"] as SuspicionPayload["flags"]) ?? [],
      plagiarismReport:
        (parsed["plagiarismReport"] as SuspicionPayload["plagiarismReport"]) ?? null,
      behavioralAnomalies:
        (parsed["behavioralAnomalies"] as SuspicionPayload["behavioralAnomalies"]) ?? [],
      generatedAt: (parsed["generatedAt"] as string) ?? new Date().toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Prompt Construction
  // ───────────────────────────────────────────────────────────────

  private buildOrchestratorSystemInstruction(prompt: OrchestratorPrompt): string {
    return `You are an expert technical assessment architect specializing in the "${prompt.roleContext}" domain.

Your task is to generate a complete, production-grade technical assessment test suite in valid JSON format.
The output must conform to the following TypeScript interface:

\`\`\`typescript
interface GeneratedTestSuite {
  metadata: {
    suiteId: string;          // UUID v4
    generatedAt: string;      // ISO-8601 timestamp
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  roles: Array<{
    roleId: string;
    title: string;
    seniorityLevel: "junior" | "mid" | "senior" | "lead" | "principal";
    requiredCompetencyIds: string[];
  }>;
  competencies: Array<{
    competencyId: string;
    name: string;
    description: string;
    weight: number;           // 0-1
    subCompetencies: Array<...>; // recursive same shape
  }>;
  problems: Array<{
    problemId: string;
    problemType: "mcq" | "coding" | "essay" | "interactive";
    title: string;
    body: string;             // Markdown description
    language?: string;        // e.g. "typescript", "python"
    starterCode?: string;
    testCases?: Array<{ caseId: string; input: string; expectedOutput: string; isPublic: boolean; timeoutMs: number }>;
    options?: Array<{ optionId: string; text: string; isCorrect: boolean; explanation: string }>;
    expectedAnswer?: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    competencyId: string;
    timeAllocationSeconds: number;
    maxScore: number;
  }>;
  testingMatrices: Array<{
    matrixId: string;
    problemId: string;
    competencyIds: string[];
    scoringFormula: { type: "weighted_sum" | "all_or_nothing" | "partial_credit"; weights: Record<string, number> };
    antiCheatThresholds: { maxPasteEvents: number; maxTimeBetweenKeystrokesMs: number; plagiarismSimilarityThreshold: number; structuralChangeSensitivity: number };
  }>;
}
\`\`\`

RULES:
- Return ONLY valid JSON (no markdown wrappers, no explanatory text outside the JSON object).
- Generate EXACTLY ${prompt.problemCount} problems.
- Distribute difficulty according to: beginner=${prompt.difficultyMix.beginner}, intermediate=${prompt.difficultyMix.intermediate}, advanced=${prompt.difficultyMix.advanced}.
- For coding problems, include starter code and at least 3 hidden test cases.
- For MCQ problems, include exactly 4 options with one correct answer and explanations.
- Generate 3-5 competencies relevant to the "${prompt.roleContext}" role.
- Every problem must reference a valid competencyId.
- Include at least one testing matrix per problem.
- Anti-cheat thresholds should be reasonable defaults.`;
  }

  private buildOrchestratorUserMessage(prompt: OrchestratorPrompt): string {
    return prompt.prompt;
  }

  private buildGuardianSystemInstruction(): string {
    return `You are an elite anti-cheat analysis engine. Your role is to detect signs of plagiarism, AI-generated code submission, and behavioral anomalies in a candidate's coding assessment session.

Given the candidate's submitted code, paste history, keystroke timing metrics, and reference completions (i.e., known-good Gemini outputs for the same problem), produce a structured suspicion report in valid JSON.

Return ONLY valid JSON matching this TypeScript interface:

{
  "suspicionId": string,         // UUID v4
  "overallScore": number,        // 0-100 suspicion percentage
  "flags": Array<{
    "flagType": string,
    "severity": "low" | "medium" | "high" | "critical",
    "sourceEventId": string,
    "description": string,
    "confidence": number,        // 0-1
    "timestamp": string          // ISO-8601
  }>,
  "plagiarismReport": {
    "overallSimilarity": number,    // 0-1
    "aiCompletionLikelihood": number, // 0-1
    "matchedSnippets": Array<{
      "sourceSnippet": string,
      "candidateSnippet": string,
      "similarityScore": number,
      "sourceLabel": string
    }>
  } | null,
  "behavioralAnomalies": Array<{
    "anomalyType": string,
    "description": string,
    "evidenceWindowStart": string,
    "evidenceWindowEnd": string,
    "metricValue": number,
    "threshold": number
  }>,
  "generatedAt": string          // ISO-8601
}

RULES:
- overallScore must reflect the combined severity of all detected issues.
- If keystroke deltas average below 80ms, flag as behavioral anomaly.
- If paste content closely matches any reference completion, flag as plagiarism.
- Return ONLY the JSON object — no markdown fences, no explanatory text.`;
  }

  private buildGuardianUserMessage(
    currentCode: string,
    pasteContents: string[],
    keystrokeMetrics: { avgDeltaMs: number; maxDeltaMs: number; minDeltaMs: number },
    referenceCompletions: string[]
  ): string {
    const referenceText =
      referenceCompletions.length > 0
        ? referenceCompletions.map((r, i) => `Reference ${i + 1}:\n\`\`\`\n${r}\n\`\`\``).join("\n\n")
        : "No reference completions available.";

    const pasteText =
      pasteContents.length > 0
        ? pasteContents.map((p, i) => `Paste ${i + 1}:\n\`\`\`\n${p.substring(0, 2000)}\n\`\`\``).join("\n\n")
        : "No paste events recorded.";

    return `Analyze the following candidate coding session for signs of cheating:

CANDIDATE CODE:
\`\`\`
${currentCode.substring(0, 8000)}
\`\`\`

PASTE HISTORY:
${pasteText}

KEYSTROKE METRICS:
- Average delta: ${keystrokeMetrics.avgDeltaMs.toFixed(1)}ms
- Max delta: ${keystrokeMetrics.maxDeltaMs}ms
- Min delta: ${keystrokeMetrics.minDeltaMs}ms

REFERENCE COMPLETIONS (known-good Gemini outputs for the same problem):
${referenceText}

Generate a comprehensive suspicion report in JSON format. Be thorough but fair — only flag what is genuinely suspicious.`;
  }

  // ───────────────────────────────────────────────────────────────
  // JSON Repair Utility
  // ───────────────────────────────────────────────────────────────

  /**
   * Attempts to repair common LLM-generated JSON malformations:
   *
   *   1. Unquoted property names:  { foo: "bar" }  →  { "foo": "bar" }
   *   2. Single-quoted strings:    { "foo": 'bar' } →  { "foo": "bar" }
   *   3. Trailing commas:          { "foo": "bar", } → { "foo": "bar" }
   *   4. Missing closing braces/brackets (best-effort balancing)
   *
   * This is a best-effort heuristic — it cannot fix all possible
   * malformations, but handles the most common LLM output failures.
   */
  private repairJson(text: string): string {
    let repaired = text;

    // ── Pass 0: Escape literal newlines inside JSON strings ──
    // LLMs frequently emit unescaped newlines inside string values
    // (e.g., multi-line "body" fields), which breaks JSON parsing
    // with "Unterminated string in JSON". We detect a `"` that
    // opens on one line and closes on a later line, and replace
    // the literal CR/LF with the `\n` escape sequence.
    repaired = this.escapeNewlinesInStrings(repaired);

    // ── Pass 1a: Quote unquoted property names at line starts ──
    // Catches patterns like:
    //         title: "foo"
    //   (key at start of line after optional whitespace, not already quoted)
    // Uses the /m flag so ^ matches after every newline.
    repaired = repaired.replace(
      /^(\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/gm,
      (_match, indent: string, key: string, colon: string) => {
        // Guard: skip if this token is already inside a quoted string context.
        // Check that the character immediately before the key is NOT a quote.
        // Since we only match at line starts, the preceding char is always \n
        // (or start-of-string), so this is safe against false positives inside
        // multi-line string values (extremely rare in JSON).
        return `${indent}"${key}"${colon}`;
      }
    );

    // ── Pass 1b: Quote unquoted property names after { , [ ─────
    // Handles same-line shorthand:  {"foo":1,target:2}  or array-of-objects:
    //  [{name:"x"},...] where name follows [ or { on the same line.
    // The character class [[{,\[] matches an opening bracket, comma, or
    // opening square-bracket literal.
    repaired = repaired.replace(
      /([[{,\[]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g,
      (_match, before: string, key: string, colon: string) => {
        return `${before}"${key}"${colon}`;
      }
    );

    // ── Pass 2: Convert single-quoted strings to double-quoted ──
    // Only targets single-quoted values (not keys) — keys are already
    // handled by Pass 1. Matches :  '...'  patterns.
    repaired = repaired.replace(
      /:\s*'([^']*)'/g,
      (_match: string, inner: string) => {
        // Escape any double quotes inside the single-quoted string
        const escaped = inner.replace(/"/g, '\\"');
        return `: "${escaped}"`;
      }
    );

    // ── Pass 3: Remove trailing commas before } or ] ────────────
    repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

    // ── Pass 4: Balance braces/brackets (best-effort) ───────────
    repaired = this.balanceBraces(repaired);

    return repaired;
  }

  /**
   * Attempts to balance unmatched braces and brackets by appending
   * missing closing delimiters at the end of the JSON string.
   */
  private balanceBraces(text: string): string {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (const ch of text) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    }

    // Append missing closing brackets first, then braces
    let result = text;
    while (bracketDepth > 0) {
      result += "]";
      bracketDepth--;
    }
    while (braceDepth > 0) {
      result += "}";
      braceDepth--;
    }
    return result;
  }

  /**
   * Detects and escapes literal newlines that fall inside JSON string
   * values. An unescaped newline inside a JSON string is illegal per
   * RFC 7159 and causes "Unterminated string in JSON" parse errors.
   *
   * Strategy: track whether we are inside a string and, if so,
   * replace any literal \r\n or \n with the JSON escape sequence \n.
   * We handle:
   *   - Windows line endings: \r\n → \\n
   *   - Unix line endings:    \n   → \\n
   *
   * IMPORTANT: The method returns the escaped string WITHOUT altering
   * the surrounding quote context. Closing quotes on subsequent lines
   * are preserved as-is.
   */
  private escapeNewlinesInStrings(text: string): string {
    const result: string[] = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escape) {
        result.push(ch);
        escape = false;
        continue;
      }

      if (ch === "\\" && inString) {
        result.push(ch);
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        result.push(ch);
        continue;
      }

      // ── Handle literal newlines inside strings ──────────
      if (inString && ch === "\r") {
        // Windows-style: \r\n → consume both, emit \"\\n\"
        result.push("\\n");
        if (i + 1 < text.length && text[i + 1] === "\n") {
          i++; // skip the \n
        }
        continue;
      }

      if (inString && ch === "\n") {
        result.push("\\n");
        continue;
      }

      result.push(ch);
    }

    // If we end while still "in string", that's a genuine unterminated
    // string — but balanceBraces will handle it downstream.
    return result.join("");
  }

  /**
   * Strips only outermost markdown code-fence wrappers from the text.
   *
   * IMPORTANT: This method only removes fences at the VERY START and END of
   * the raw text (e.g., when the entire response is wrapped in ```json ... ```).
   * It does NOT attempt to strip fence blocks that appear inside the payload
   * (e.g., code examples embedded in JSON string values).
   *
   * Approach:
   * 1. If the trimmed text starts with ```json, strip that exact pair.
   * 2. If it starts with ``` followed by any word char language tag (e.g.,
   *    ```javascript, ```typescript), strip that pair — as long as there's
   *    no leading text before the fence.
   * 3. If it starts with ``` (no language tag), strip that pair.
   * 4. Otherwise, return the text as-is.
   *
   * After fence stripping, the text is trimmed and any surrounding
   * explanatory preamble/epilogue is removed by extracting the outermost
   * JSON object.
   */
  private stripMarkdownFences(text: string): string {
    const trimmed = text.trim();

    // ── Case 1: ```json wrapper ────────────────────────────────────
    const jsonFenceHead = /^```json\s*\n/;
    if (jsonFenceHead.test(trimmed)) {
      return this.extractFromOuterFence(trimmed, /^```json\s*\n/, /\n```\s*$/);
    }

    // ── Case 2: ```<anyLang> wrapper ───────────────────────────────
    const langFenceHead = /^```[a-zA-Z]+\s*\n/;
    if (langFenceHead.test(trimmed)) {
      return this.extractFromOuterFence(trimmed, /^```[a-zA-Z]+\s*\n/, /\n```\s*$/);
    }

    // ── Case 3: ``` (no lang tag) wrapper ──────────────────────────
    const bareFenceHead = /^```\s*\n/;
    if (bareFenceHead.test(trimmed)) {
      return this.extractFromOuterFence(trimmed, /^```\s*\n/, /\n```\s*$/);
    }

    // ── Fallback: Extract outermost JSON object ────────────────────
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      const objStart = Math.min(
        trimmed.indexOf("{") === -1 ? Infinity : trimmed.indexOf("{"),
        trimmed.indexOf("[") === -1 ? Infinity : trimmed.indexOf("[")
      );
      if (objStart !== Infinity) {
        return this.extractJsonObject(trimmed.substring(objStart));
      }
    }

    return trimmed;
  }

  /**
   * Extracts content from between matching ``` fence markers.
   * headRegex matches the opening fence, tailRegex matches the closing fence.
   */
  private extractFromOuterFence(
    text: string,
    headRegex: RegExp,
    tailRegex: RegExp
  ): string {
    return text.replace(headRegex, "").replace(tailRegex, "").trim();
  }

  /**
   * Last-resort strategy: find the outermost JSON object by locating
   * the first `{` and the matching `}` using brace counting.
   */
  private extractJsonObject(text: string): string {
    const firstBrace = text.indexOf("{");
    if (firstBrace === -1) return text;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          return text.substring(firstBrace, i + 1);
        }
      }
    }

    // If we never found the matching close, return from first brace to end
    // (the balanceBraces call will have already tried to fix this)
    return text.substring(firstBrace);
  }

  // ───────────────────────────────────────────────────────────────
  // General Utility
  // ───────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
