/**
 * Environment configuration for the Cerberus AI Hono API.
 * Uses dotenv for local development; Cloud Run injects env vars in production.
 *
 * ═══════════════════════════════════════════════════════════════════
 * GEMINI API — Primary Backend (Free Tier)
 * ═══════════════════════════════════════════════════════════════════
 *
 * All Gemini model calls go through the @google/genai SDK.
 * Supports both Vertex AI (GCP_PROJECT_ID + GCP_LOCATION + ADC)
 * and Gemini API (GEMINI_API_KEY) backends.
 * Precedence: GEMINI_API_KEY takes priority if set.
 *
 * Free API key: https://aistudio.google.com/apikey
 * Local ADC setup: gcloud auth application-default login
 * Cloud Run: ADC is auto-injected via the metadata server.
 */

import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ═══════════════════════════════════════════════════════════════════
// ADC Pre-Warming — eliminates cold-start metadata server race
// ═══════════════════════════════════════════════════════════════════
//
// On Cloud Run, the first request after container boot can race
// against the GCP metadata server's IAM token endpoint. Pre-fetching
// the access token during startup ensures the handshake completes
// before any traffic arrives.

let _googleAuth: typeof import("google-auth-library").GoogleAuth | null = null;

async function loadGoogleAuth() {
  if (_googleAuth) return _googleAuth;
  const ga = await import("google-auth-library");
  _googleAuth = ga.GoogleAuth;
  return _googleAuth;
}

export async function warmUpADC(): Promise<void> {
  try {
    const GoogleAuth = await loadGoogleAuth();
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const token = await auth.getAccessToken();
    if (token) {
      console.log("[config] ADC token pre-warmed — cold start race avoided");
    } else {
      console.warn("[config] ADC warm-up returned empty token — will rely on request-time retries");
    }
  } catch (err) {
    console.warn(
      "[config] ADC warm-up failed — will rely on request-time retries:",
      (err as Error).message
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Application Default Credentials (ADC) Auto-Discovery
// ═══════════════════════════════════════════════════════════════════
//
// The Vertex AI SDK looks for credentials at the path set in
// GOOGLE_APPLICATION_CREDENTIALS. If that env var is not set,
// we walk the filesystem looking for the standard ADC file.
// On Cloud Run the metadata server provides auth — this block
// is a no-op in production.

function discoverApplicationDefaultCredentials(): string | null {
  if (process.env["GOOGLE_APPLICATION_CREDENTIALS"]) return null;

  const candidates = [
    // Standard Google Cloud SDK location on Windows
    resolve(process.env["APPDATA"] ?? "", "gcloud", "application_default_credentials.json"),
    // Standard Google Cloud SDK location on Linux/macOS
    resolve(process.env["HOME"] ?? "", ".config", "gcloud", "application_default_credentials.json"),
    // Project root (monorepo layout: hono-api is inside sandbox/)
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "application_default_credentials.json"),
    // Inside hono-api directory itself
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "application_default_credentials.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      console.log(`[config] ADC auto-discovered → ${candidate}`);
      return candidate;
    }
  }

  return null;
}

const adcPath = discoverApplicationDefaultCredentials();
if (adcPath) {
  process.env["GOOGLE_APPLICATION_CREDENTIALS"] = adcPath;
}

// ═══════════════════════════════════════════════════════════════════
// Config Types
// ═══════════════════════════════════════════════════════════════════

export interface AppConfig {
  port: number;
  gemini: GeminiConfig;
  mcp: MCPConfig;
  security: SecurityConfig;
}

export interface GeminiConfig {
  /** Gemini API key (aistudio.google.com). Takes priority over Vertex AI if set. */
  apiKey: string;
  /** GCP project ID (required for Vertex AI; optional if apiKey is set). */
  projectId: string;
  /** GCP region (e.g. "us-central1"). */
  location: string;
  /** Model name (e.g. "gemini-3-flash-preview"). */
  model: string;
  /** Maximum output tokens per response. */
  maxOutputTokens: number;
  /** Temperature (0-2). Lower = more deterministic. */
  temperature: number;
  /** Per-attempt timeout in ms (default 90_000 = 90s). */
  requestTimeoutMs: number;
}

export interface MCPConfig {
  /** MCP server URL (MongoDB track). */
  serverEndpoint: string;
  apiKey: string;
  timeoutMs: number;
}

export interface SecurityConfig {
  /** Session expiry in seconds. */
  sessionTTLSeconds: number;
  /** Max allowed paste events before auto-flagging. */
  maxPasteEventsPerSession: number;
  /** Min keystroke interval considered human (ms). */
  minHumanKeystrokeMs: number;
  /** Semantic similarity threshold for plagiarism. */
  plagiarismThreshold: number;
}

// ═══════════════════════════════════════════════════════════════════
// Config Loader
// ═══════════════════════════════════════════════════════════════════

export function loadConfig(): AppConfig {
  const port = parseInt(process.env["PORT"] ?? "8080", 10);

  const apiKey = process.env["GEMINI_API_KEY"] ?? "";
  const projectId = process.env["GCP_PROJECT_ID"] ?? "";
  const location = process.env["GCP_LOCATION"] ?? "us-central1";

  if (!apiKey && !projectId) {
    console.error(
      "[config] FATAL: Neither GEMINI_API_KEY nor GCP_PROJECT_ID is set. " +
        "Set GEMINI_API_KEY for Gemini API (aistudio.google.com) or " +
        "GCP_PROJECT_ID for Vertex AI."
    );
    process.exitCode = 1;
  } else if (apiKey) {
    console.log(
      `[config] Gemini API → key=${apiKey.substring(0, 8)}... model="${process.env["GEMINI_MODEL"] ?? "gemini-3-flash-preview"}"`
    );
  } else {
    console.log(
      `[config] Vertex AI → project="${projectId}" location="${location}"`
    );
  }

  const gemini: GeminiConfig = {
    apiKey,
    projectId,
    location,
    model: process.env["GEMINI_MODEL"] ?? "gemini-3-flash-preview",
    maxOutputTokens: parseInt(
      process.env["GEMINI_MAX_OUTPUT_TOKENS"] ?? "65536",
      10
    ),
    temperature: parseFloat(process.env["GEMINI_TEMPERATURE"] ?? "0.2"),
    requestTimeoutMs: parseInt(
      process.env["GEMINI_REQUEST_TIMEOUT_MS"] ?? "90000",
      10
    ),
  };

  const mcp: MCPConfig = {
    serverEndpoint:
      process.env["MCP_SERVER_ENDPOINT"] ?? "http://localhost:3001",
    apiKey: process.env["MCP_API_KEY"] ?? "",
    timeoutMs: parseInt(process.env["MCP_TIMEOUT_MS"] ?? "10000", 10),
  };

  const security: SecurityConfig = {
    sessionTTLSeconds: parseInt(
      process.env["SESSION_TTL_SECONDS"] ?? "7200",
      10
    ),
    maxPasteEventsPerSession: parseInt(
      process.env["MAX_PASTE_EVENTS"] ?? "5",
      10
    ),
    minHumanKeystrokeMs: parseInt(
      process.env["MIN_HUMAN_KEYSTROKE_MS"] ?? "80",
      10
    ),
    plagiarismThreshold: parseFloat(
      process.env["PLAGIARISM_THRESHOLD"] ?? "0.75"
    ),
  };

  return { port, gemini, mcp, security };
}