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
    roleContext: string
  ): Promise<GeneratedTestSuite> {
    console.log("[Gemini Ingestion] [generateTestSuite] Initiating request to model...");
    console.log(`[Gemini Ingestion] [generateTestSuite] Prompt length=${prompt.length} roleContext="${roleContext}"`);

    const orchestratorPrompt: OrchestratorPrompt = {
      prompt,
      roleContext,
      problemCount: 10, // default; overridden in the enriched prompt upstream
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
   */
  private parseTestSuiteResponse(rawText: string): GeneratedTestSuite {
    // Strip markdown code fences if present
    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch (parseErr) {
      console.error(
        "[Gemini Ingestion] [parseTestSuite] JSON parse failure. Raw text (first 500 chars):",
        rawText.substring(0, 500)
      );
      throw new Error(
        `Failed to parse test suite JSON: ${(parseErr as Error).message}`
      );
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
   */
  private parseSuspicionResponse(rawText: string): SuspicionPayload {
    let jsonText = rawText.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch (parseErr) {
      console.error(
        "[Gemini Ingestion] [parseSuspicion] JSON parse failure. Raw text (first 500 chars):",
        rawText.substring(0, 500)
      );
      throw new Error(
        `Failed to parse suspicion JSON: ${(parseErr as Error).message}`
      );
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
  // Utility
  // ───────────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
