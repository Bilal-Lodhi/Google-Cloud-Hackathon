/**
 * Environment configuration for the Gorilla Agent Hono API.
 * All values sourced from Cloud Run environment variables (no .env in production).
 */

export interface AppConfig {
  port: number;
  gemini: GeminiConfig;
  mcp: MCPConfig;
  security: SecurityConfig;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  region: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface MCPConfig {
  serverEndpoint: string;   // MCP server URL (MongoDB track)
  apiKey: string;
  timeoutMs: number;
}

export interface SecurityConfig {
  /** Session expiry in seconds */
  sessionTTLSeconds: number;
  /** Max allowed paste events before auto-flagging */
  maxPasteEventsPerSession: number;
  /** Min keystroke interval considered human (ms) */
  minHumanKeystrokeMs: number;
  /** Semantic similarity threshold for plagiarism */
  plagiarismThreshold: number;
}

export function loadConfig(): AppConfig {
  const port = parseInt(process.env["PORT"] ?? "8080", 10);

  const gemini: GeminiConfig = {
    apiKey: process.env["GEMINI_API_KEY"] ?? "",
    model: process.env["GEMINI_MODEL"] ?? "gemini-2.5-flash",
    region: process.env["GEMINI_REGION"] ?? "us-central1",
    maxOutputTokens: parseInt(process.env["GEMINI_MAX_OUTPUT_TOKENS"] ?? "8192", 10),
    temperature: parseFloat(process.env["GEMINI_TEMPERATURE"] ?? "0.2"),
  };

  const mcp: MCPConfig = {
    serverEndpoint: process.env["MCP_SERVER_ENDPOINT"] ?? "http://localhost:3001",
    apiKey: process.env["MCP_API_KEY"] ?? "",
    timeoutMs: parseInt(process.env["MCP_TIMEOUT_MS"] ?? "10000", 10),
  };

  const security: SecurityConfig = {
    sessionTTLSeconds: parseInt(process.env["SESSION_TTL_SECONDS"] ?? "7200", 10),
    maxPasteEventsPerSession: parseInt(process.env["MAX_PASTE_EVENTS"] ?? "5", 10),
    minHumanKeystrokeMs: parseInt(process.env["MIN_HUMAN_KEYSTROKE_MS"] ?? "80", 10),
    plagiarismThreshold: parseFloat(process.env["PLAGIARISM_THRESHOLD"] ?? "0.75"),
  };

  return { port, gemini, mcp, security };
}