/**
 * Gemini 2.5 Flash Client — Native Google Cloud fetch bindings.
 *
 * Features:
 *   - Native global fetch() — zero SDK dependencies (HACKATHON_RULES §2 Mandate)
 *   - Jittered exponential backoff with retry circuit breaker
 *   - AbortController-based timeout enforcement per request
 *   - Production-grade error discrimination (4xx vs 5xx, rate-limit, timeout)
 *   - Structured JSON mode via `responseMimeType: "application/json"`
 *   - Token-usage tracking for cost observability
 *
 * @see https://ai.google.dev/api/rest/v1/models/generateContent
 */

import type { GeneratedTestSuite, SuspicionPayload } from "../types.js";
import type { AppConfig } from "../config.js";

// ─── Retry Configuration ───────────────────────────────────────────

const RETRY_CONFIG = {
  /** Maximum total attempts including the initial call */
  maxAttempts: 3,
  /** Base delay in ms before first retry (gets exponentially backed off) */
  baseDelayMs: 800,
  /** Multiplier applied on each subsequent retry */
  backoffMultiplier: 2,
  /** Jitter factor applied as ± percentage of the delay (0.15 = ±15%) */
  jitterFactor: 0.15,
  /** HTTP status codes eligible for retry */
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
  /** Per-request timeout in ms */
  requestTimeoutMs: 40_000, // Gemini Flash responses can be large; 40 s covers 8k tokens
} as const;

// ─── Error Types ──────────────────────────────────────────────────

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly attemptNumber: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export class GeminiTimeoutError extends GeminiError {
  constructor(attemptNumber: number) {
    super(
      `Gemini request timed out after ${RETRY_CONFIG.requestTimeoutMs}ms (attempt ${attemptNumber})`,
      0,
      true,
      attemptNumber,
    );
    this.name = "GeminiTimeoutError";
  }
}

export class GeminiRateLimitError extends GeminiError {
  constructor(retryAfter: string | null, attemptNumber: number) {
    super(
      `Gemini rate limit hit${retryAfter ? `; retry after ${retryAfter}` : ""} (attempt ${attemptNumber})`,
      429,
      true,
      attemptNumber,
    );
    this.name = "GeminiRateLimitError";
  }
}

export class GeminiMaxRetriesError extends GeminiError {
  constructor(innerMessage: string, attemptNumber: number) {
    super(
      `Gemini pipeline exhausted all ${RETRY_CONFIG.maxAttempts} retry attempts. Last error: ${innerMessage}`,
      0,
      false,
      attemptNumber,
    );
    this.name = "GeminiMaxRetriesError";
  }
}

// ─── Gemini REST API Types ───────────────────────────────────────

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
}

interface GeminiGenerateRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    responseMimeType?: "application/json";
  };
  systemInstruction?: {
    parts: { text: string }[];
  };
}

interface GeminiGenerateResponse {
  candidates?: {
    content: { parts: { text?: string }[] };
    finishReason: string;
    safetyRatings?: { category: string; probability: string }[];
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: { category: string; probability: string }[];
  };
}

interface GenerateResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ─── Utility ──────────────────────────────────────────────────────

function computeJitteredDelay(baseDelay: number): number {
  const factor = 1 - RETRY_CONFIG.jitterFactor + Math.random() * RETRY_CONFIG.jitterFactor * 2;
  return Math.round(baseDelay * factor);
}

function isRetryableStatus(status: number): boolean {
  // 5xx = transient server fault; 429 = rate limit
  return status >= 500 || status === 429;
}

// ─── Client ───────────────────────────────────────────────────────

export class GeminiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AppConfig) {
    this.apiKey = config.gemini.apiKey;
    this.model = config.gemini.model;
    // Correct Gemini REST endpoint — the AI snippet used googleapis.com (wrong)
    this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}`;
  }

  // ─── Core generateContent Pipeline (retry + circuit breaker) ────

  /**
   * Core low-level call to Gemini generateContent.
   * Features retry circuit-breaker, abort-controller timeout, and jittered backoff.
   */
  private async generate(
    systemInstruction: string,
    userPrompt: string,
    options?: { temperature?: number; maxOutputTokens?: number; jsonMode?: boolean },
  ): Promise<GenerateResult> {
    const url = `${this.baseUrl}:generateContent?key=${this.apiKey}`;

    const requestBody: GeminiGenerateRequest = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: options?.temperature ?? 0.2,
        maxOutputTokens: options?.maxOutputTokens ?? 8192,
        topP: 0.95,
        topK: 40,
        responseMimeType: options?.jsonMode === true ? "application/json" : undefined,
      },
    };

    const bodyJson = JSON.stringify(requestBody);
    let attempt = 0;
    let delay = RETRY_CONFIG.baseDelayMs;
    let lastError: GeminiError | null = null;

    while (attempt < RETRY_CONFIG.maxAttempts) {
      attempt++;

      try {
        // ── AbortController for strict timeout ──
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          RETRY_CONFIG.requestTimeoutMs,
        );

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyJson,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // ── Rate-limit handling ──
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const retryDelay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : delay * 2; // exponential backoff for 429
          lastError = new GeminiRateLimitError(retryAfter, attempt);

          if (attempt < RETRY_CONFIG.maxAttempts) {
            await sleep(retryDelay);
            delay *= RETRY_CONFIG.backoffMultiplier;
            continue;
          }
          break;
        }

        // ── Transient server errors (5xx) ──
        if (isRetryableStatus(response.status) && !response.ok) {
          lastError = new GeminiError(
            `Gemini API transient error [${response.status}]`,
            response.status,
            true,
            attempt,
          );

          if (attempt < RETRY_CONFIG.maxAttempts) {
            const jitteredDelay = computeJitteredDelay(delay);
            await sleep(jitteredDelay);
            delay *= RETRY_CONFIG.backoffMultiplier;
            continue;
          }
          break;
        }

        // ── Hard client error (4xx non-429) ──
        if (!response.ok) {
          const errorBody = await response.text();
          lastError = new GeminiError(
            `Gemini API error [${response.status}]: ${errorBody.slice(0, 500)}`,
            response.status,
            false, // non-retryable
            attempt,
          );
          break;
        }

        // ── Success ──
        const data = (await response.json()) as GeminiGenerateResponse;

        // Safety block check
        if (data.promptFeedback?.blockReason) {
          lastError = new GeminiError(
            `Content blocked by safety filters: ${data.promptFeedback.blockReason}`,
            400,
            false,
            attempt,
          );
          break;
        }

        const candidate = data.candidates?.[0];
        if (!candidate?.content?.parts?.[0]?.text) {
          lastError = new GeminiError(
            `Gemini returned no content. Finish reason: ${candidate?.finishReason ?? "UNKNOWN"}`,
            200, // success status but empty body
            true, // retryable — model may have hit token limit
            attempt,
          );

          if (attempt < RETRY_CONFIG.maxAttempts) {
            await sleep(computeJitteredDelay(delay));
            delay *= RETRY_CONFIG.backoffMultiplier;
            continue;
          }
          break;
        }

        // Fully successful response
        return {
          text: candidate.content.parts[0].text,
          usage: {
            promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
            completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
          },
        };
      } catch (caught: unknown) {
        // ── AbortController timeout ──
        if (isAbortError(caught)) {
          lastError = new GeminiTimeoutError(attempt);
          if (attempt < RETRY_CONFIG.maxAttempts) {
            const jitteredDelay = computeJitteredDelay(delay * 2); // longer delay for timeouts
            await sleep(jitteredDelay);
            delay *= RETRY_CONFIG.backoffMultiplier;
            continue;
          }
          break;
        }

        // ── Generic network error ──
        const message = caught instanceof Error ? caught.message : String(caught);
        lastError = new GeminiError(
          `Network error: ${message}`,
          0,
          true, // network failures are retryable
          attempt,
        );

        if (attempt < RETRY_CONFIG.maxAttempts) {
          await sleep(computeJitteredDelay(delay));
          delay *= RETRY_CONFIG.backoffMultiplier;
          continue;
        }
        break;
      }
    }

    // ── All retries exhausted ──
    if (lastError) {
      if (lastError.retryable) {
        throw new GeminiMaxRetriesError(lastError.message, RETRY_CONFIG.maxAttempts);
      }
      throw lastError;
    }

    throw new GeminiMaxRetriesError("Unknown failure after max retries", RETRY_CONFIG.maxAttempts);
  }

  // ─── Agent-Specific Methods ──────────────────────────────────────

  /**
   * Orchestrator Agent: Generates a full assessment test suite from a single prompt.
   *
   * FEATURE 1 — AUTONOMOUS TEST SUITE GENERATOR
   */
  async generateTestSuite(prompt: string, roleContext: string): Promise<GeneratedTestSuite> {
    const systemInstruction = ORCHESTRATOR_SYSTEM_PROMPT;

    const userPrompt = [
      `Create a complete assessment test suite for the following context:`,
      ``,
      `ROLE CONTEXT: ${roleContext}`,
      `USER PROMPT: ${prompt}`,
      ``,
      `Generate exactly the requested number of problems across the difficulty distribution specified.`,
      `Every problem must be solvable, self-contained, and production-grade. Include hidden test cases`,
      `for all coding problems and explicit anti-cheat thresholds in the testing matrices.`,
      ``,
      `Your response must be valid JSON matching the GeneratedTestSuite schema exactly.`,
      `Do NOT include any markdown fences or commentary outside the JSON object.`,
    ].join("\n");

    const result = await this.generate(systemInstruction, userPrompt, {
      temperature: 0.3,
      maxOutputTokens: 8192,
      jsonMode: true,
    });

    const suite = JSON.parse(result.text) as GeneratedTestSuite;

    // Enrich metadata with actual run stats
    suite.metadata.modelVersion = this.model;
    suite.metadata.generatedAt = new Date().toISOString();
    suite.metadata.tokenUsage = result.usage;

    return suite;
  }

  /**
   * Intent Guardian Agent: Analyzes micro-events for cheating/plagiarism suspicion.
   * Uses Gemini reasoning to detect semantic similarity against AI completions,
   * variable-name obfuscation, leetspeak transformations, and paste anomalies.
   *
   * FEATURE 2 — REAL-TIME INTENT & PLAGIARISM GUARDIAN
   */
  async analyzeSuspicion(
    submittedCode: string,
    pasteHistory: string[],
    keystrokeMetrics: { avgDeltaMs: number; maxDeltaMs: number; minDeltaMs: number },
    referenceCompletions: string[],
  ): Promise<SuspicionPayload> {
    const systemInstruction = INTENT_GUARDIAN_SYSTEM_PROMPT;

    const pasteSection =
      pasteHistory.length > 0
        ? pasteHistory.map((p, i) => `Paste ${i + 1} (${p.length} chars): ${p.slice(0, 800)}`).join("\n\n")
        : "(No paste events recorded)";

    const referenceSection =
      referenceCompletions.length > 0
        ? referenceCompletions
            .map((r, i) => `Reference AI Completion ${i + 1}: ${r.slice(0, 1200)}`)
            .join("\n\n")
        : "(No reference completions cached — performing contextual analysis only)";

    const userPrompt = [
      `Analyze the following candidate assessment session for cheating indicators:`,
      ``,
      `--- SUBMITTED CODE ---`,
      submittedCode,
      ``,
      `--- PASTE HISTORY ---`,
      pasteSection,
      ``,
      `--- KEYSTROKE METRICS ---`,
      `Average delta between keystrokes: ${keystrokeMetrics.avgDeltaMs}ms`,
      `Max delta: ${keystrokeMetrics.maxDeltaMs}ms`,
      `Min delta: ${keystrokeMetrics.minDeltaMs}ms`,
      ``,
      `--- REFERENCE AI COMPLETIONS (Gemini output for same problem) ---`,
      referenceSection,
      ``,
      `Evaluate:`,
      `1. Does the submitted code show structural similarity to any AI reference completion? Score 0-1.`,
      `2. Are paste events consistent with lookup cheating?`,
      `3. Are keystroke intervals consistent with human typing or copy-paste injection?`,
      `4. Does the code use obfuscation techniques (variable renaming, leetspeak, comment stripping)?`,
      `5. Generate a comprehensive suspicion payload.`,
      ``,
      `Return valid JSON matching the SuspicionPayload schema. No markdown fences.`,
    ].join("\n");

    const result = await this.generate(systemInstruction, userPrompt, {
      temperature: 0.1, // lowest randomness for deterministic security analysis
      maxOutputTokens: 4096,
      jsonMode: true,
    });

    return JSON.parse(result.text) as SuspicionPayload;
  }
}

// ─── Agent System Prompts (Production-Grade) ───────────────────────

const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Gorilla Orchestrator Agent, an expert assessment architect running on Google Cloud Agent Builder.
Your purpose is to transform a single natural-language prompt into a complete, production-grade test suite.

You MUST output valid JSON conforming to this exact schema:

{
  "metadata": {
    "suiteId": "<uuid-v4>",
    "generatedAt": "<ISO-8601>",
    "modelVersion": "gemini-2.5-flash",
    "promptFingerprint": "<sha256>",
    "tokenUsage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 }
  },
  "roles": [
    {
      "roleId": "<string>",
      "title": "<string>",
      "seniorityLevel": "junior|mid|senior|lead|principal",
      "requiredCompetencyIds": ["<competencyId>"]
    }
  ],
  "competencies": [
    {
      "competencyId": "<string>",
      "name": "<string>",
      "description": "<string>",
      "weight": <0-1>,
      "subCompetencies": []
    }
  ],
  "problems": [
    {
      "problemId": "<string>",
      "problemType": "mcq|coding|essay|interactive",
      "title": "<string>",
      "body": "<string>",
      "language": "<typescript|python|javascript|go|rust>",
      "starterCode": "<string or null>",
      "testCases": [
        {
          "caseId": "<string>",
          "input": "<string>",
          "expectedOutput": "<string>",
          "isPublic": false,
          "timeoutMs": 5000
        }
      ],
      "options": [
        {
          "optionId": "<string>",
          "text": "<string>",
          "isCorrect": true|false,
          "explanation": "<string>"
        }
      ],
      "expectedAnswer": "<model solution or correct answer>",
      "difficulty": "beginner|intermediate|advanced",
      "competencyId": "<string>",
      "timeAllocationSeconds": <integer>,
      "maxScore": <integer>
    }
  ],
  "testingMatrices": [
    {
      "matrixId": "<string>",
      "problemId": "<string>",
      "competencyIds": ["<competencyId>"],
      "scoringFormula": {
        "type": "weighted_sum|all_or_nothing|partial_credit",
        "weights": { "<competencyId>": <0-1> }
      },
      "antiCheatThresholds": {
        "maxPasteEvents": 3,
        "maxTimeBetweenKeystrokesMs": 5000,
        "plagiarismSimilarityThreshold": 0.75,
        "structuralChangeSensitivity": 0.6
      }
    }
  ]
}

RULES:
- Generate exactly the number of problems requested in the user prompt.
- Distribute across difficulties as specified.
- Coding problems MUST include at least 3 hidden test cases.
- MCQ problems MUST include 4 options with exactly one correct.
- Every problem must map to at least one competency.
- Every testing matrix must contain explicit anti-cheat thresholds.
- Use realistic, professional problem descriptions — not toy examples.
- All IDs must be valid UUIDv4 strings.`;

const INTENT_GUARDIAN_SYSTEM_PROMPT = `You are the Gorilla Intent Guardian Agent, an expert security auditor running on Google Cloud.
Your purpose is to analyze candidate assessment micro-events and detect cheating behavior, plagiarism,
or AI-generated code submissions. Pay special attention to obfuscation techniques: variable renaming,
leetspeak transformations (e.g., "l0g1n" for "login"), comment stripping, and whitespace normalization.

Output valid JSON matching this schema:

{
  "suspicionId": "<uuid-v4>",
  "sessionId": "<provided>",
  "candidateId": "<provided>",
  "assessmentId": "<provided>",
  "overallScore": <0-100>,
  "flags": [
    {
      "flagType": "<PASTE_ABUSE|KEYSTROKE_ANOMALY|PLAGIARISM|AI_MATCH|TAB_SWITCH|FULLSCREEN_EXIT|OBFUSCATION>",
      "severity": "low|medium|high|critical",
      "sourceEventId": "<string>",
      "description": "<human readable>",
      "confidence": <0-1>,
      "timestamp": "<ISO-8601>"
    }
  ],
  "plagiarismReport": {
    "overallSimilarity": <0-1>,
    "matchedSnippets": [
      {
        "sourceSnippet": "<string>",
        "candidateSnippet": "<string>",
        "similarityScore": <0-1>,
        "sourceLabel": "<string>"
      }
    ],
    "aiCompletionLikelihood": <0-1>
  },
  "behavioralAnomalies": [
    {
      "anomalyType": "<string>",
      "description": "<string>",
      "evidenceWindowStart": "<ISO-8601>",
      "evidenceWindowEnd": "<ISO-8601>",
      "metricValue": <number>,
      "threshold": <number>
    }
  ],
  "generatedAt": "<ISO-8601>"
}

ANALYSIS RULES:
- Compare the candidate's submitted code against each reference AI completion.
- If structural similarity > 0.75, flag as PLAGIARISM with confidence proportional to similarity.
- If variable names differ but structure is nearly identical, flag as OBFUSCATION with confidence 0.85-0.95.
- If leetspeak patterns detected in identifiers/comments, flag as OBFUSCATION.
- If keystroke intervals consistently < 50ms, flag as KEYSTROKE_ANOMALY (bot/injection).
- If paste events exceed 3 in a session, escalate severity based on paste content size.
- If total keystroke count is suspiciously low relative to code volume, raise anomaly.
- If the code matches AI completions near-identically but with variable renames, score similarity 0.85-0.95 (obfuscation detected).
- Compute an evidence-backed overall suspicion score from 0-100.`;

// ─── Utility: AbortError type guard ───────────────────────────────

/**
 * Detects AbortError across runtime environments.
 * In DOM: `error instanceof DOMException && error.name === "AbortError"`
 * In Node 20+: `error.name === "AbortError"`
 * In Deno: `error instanceof DOMException && error.name === "AbortError"`
 */
function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  if (error instanceof Error) {
    return error.name === "AbortError";
  }
  return false;
}

// ─── Utility: non-blocking sleep ──────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}