# 🔒 Cerberus FinSec — Insider Threat & Data Exfiltration Guardian

**Google Cloud Rapid Agent Hackathon 2026** — *Google Cloud Financial Services Track*

Cerberus FinSec replaces legacy financial compliance audit platforms with a fully autonomous,
Google Cloud-native insider threat detection engine. Built on **Google Cloud Agent Builder**
with **Hono** as the API runtime layer, **TypeScript**, **Gemini 3 Flash**, and
**Model Context Protocol (MCP)** for the Financial Services track with MongoDB Atlas grounding.

---

## 🔗 How Cerberus FinSec Uses Google Cloud Agent Builder

Cerberus FinSec runs on **Google Cloud Agent Builder** as its orchestration
platform. The Hono API layer serves as the **hosting runtime for Agent Builder
webhook extensions** — each agent endpoint (`/generate`, `/guardian/ingest`,
`/guardian/deploy`) acts as an Agent Builder tool target. The flow works as follows:

1. **Agent Builder manages orchestration**: Compliance matrix generation requests
   are routed through Agent Builder's conversation engine, which handles
   multi-turn state management and context threading.
2. **Hono acts as the tool-execution runtime**: When Agent Builder invokes a
   tool (e.g., `generate_compliance_matrix`), the webhook hits the corresponding
   Hono endpoint, which calls Gemini 3 Flash via the `@google/genai` Vertex AI
   SDK (authenticated with Application Default Credentials) and returns
   structured JSON output. Exponential backoff with 3 retries ensures
   reliable large-matrix generation.
3. **MCP Server provides the grounding layer**: All session data, employee
   telemetry, and risk assessment payloads are persisted to MongoDB Atlas through
   the Model Context Protocol server, which Agent Builder can query for
   conversational context.
4. **Gemini 3 Flash handles inference**: All model inference runs on the
   mandated `gemini-3-flash-preview` model through Google Cloud's Vertex AI
   SDK (`@google/genai` with `vertexai: true`) with ADC authentication.

This architecture satisfies the hackathon's three core platform requirements
simultaneously: Google Cloud Agent Builder (orchestration), Gemini 3 (model
via enterprise Vertex AI), and MCP with MongoDB (grounding).

---

## Table of Contents

- [How Cerberus FinSec Uses Google Cloud Agent Builder](#-how-cerberus-finsec-uses-google-cloud-agent-builder)
- [Architecture Overview](#-architecture-overview)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Install Dependencies](#1-install-dependencies)
  - [Configure Environment](#2-configure-environment)
  - [Build & Run Locally](#3-build--run-locally)
  - [Deploy to Cloud Run](#4-deploy-to-cloud-run)
- [API Endpoints](#-api-endpoints)
  - [`POST /api/v1/generate` — Compliance Matrix Generator](#post-apiv1generate--compliance-matrix-generator)
  - [`POST /api/v1/guardian/ingest` — Insider Threat Guardian](#post-apiv1guardianingest--insider-threat--data-exfiltration-guardian)
  - [`GET /api/v1/guardian/sessions/:sessionId` — Live Session Risk](#get-apiv1guardiansessionssessionid--live-session-risk)
  - [`GET /api/v1/sessions` — List All Sessions](#get-apiv1sessions--list-all-sessions-dashboard-drawer)
  - [`GET /api/v1/sessions/:sessionId` — Audit Review Log](#get-apiv1sessionssessionid--audit-review-log)
  - [`GET /health` — Health Check](#get-health--health-check)
  - [Identity Endpoints](#-identity-endpoints-personalization-layer)
- [Input Validation & Resilience](#-input-validation--resilience)
- [Session Persistence & Post-Restart Recovery](#-session-persistence--post-restart-recovery)
- [MongoDB MCP Tools](#%EF%B8%8F-mongodb-mcp-tools--9-tools-via-http-adapter)
- [Agent Design Philosophy](#-agent-design-philosophy)
- [Hackathon Compliance Checklist](#-hackathon-compliance-checklist)
- [Telemetry & Testing](#-telemetry--testing)

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      FLUTTER COMPLIANCE DASHBOARD                       │
│  ┌──────────────────────┐  ┌─────────────────────────────────────────┐ │
│  │  Terminal Workspace   │  │  Security Timeline + Risk Gauge         │ │
│  │  (Left Panel)         │  │  (Right Panel)                          │ │
│  │  - Live code monitor  │  │  - SSE-powered live updates             │ │
│  │  - Anomaly detection    │  │  - Color-coded risk severity           │ │
│  └──────────────────────┘  │  - Expandable behavioral flags           │ │
│                             └─────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP/SSE
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     HONO API LAYER (Cloud Run)                          │
│  ┌─────────────────┐ ┌──────────────────┐ ┌────────────────────────┐   │
│  │ POST /generate  │ │ POST /guardian   │ │ GET /sessions          │   │
│  │  Compliance      │ │  /ingest         │ │ GET /sessions/:id      │   │
│  │  Matrix Gen      │ │ POST /guardian   │ │                        │   │
│  │                  │ │  /deploy         │ │                        │   │
│  └───────┬─────────┘ └───────┬──────────┘ └───────────┬────────────┘   │
│          │                   │                        │                │
│          ▼                   ▼                        ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  GEMINI AGENT PIPELINE                            │  │
│  │  ┌────────────────────┐  ┌──────────────────────────────────┐    │  │
│  │  │ CISO Orchestrator   │  │ Insider Threat Guardian           │    │  │
│  │  │ (gemini-3-flash)    │  │ (gemini-3-flash reasoning)        │    │  │
│  │  │                    │  │                                   │    │  │
│  │  │ • Prompt → Matrix  │  │ • Paste trigger detection         │    │  │
│  │  │ • JSON contract    │  │ • Keystroke anomaly analysis      │    │  │
│  │  │ • Regulatory map   │  │ • Tab switch / window blur        │    │  │
│  │  │ • Penetration      │  │ • Code similarity scoring         │    │  │
│  │  │   scenarios        │  │ • Auto-creates audit sessions     │    │  │
│  │  │ • 90s timeout      │  │                                   │    │  │
│  │  └────────────────────┘  └──────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ MCP (Model Context Protocol)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               MCP SERVER — MONGODB ATLAS GROUNDING                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Sessions     │  │ Micro-Events  │  │ Risk Reports  │                  │
│  │ Collection   │  │ Collection   │  │ Collection   │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
│                                                                         │
│  Exposes 9 MCP tools via HTTP adapter:                                  │
│  • store_compliance_matrix / get_compliance_matrix                      │
│  • create_session (monitored employee session)                          │
│  • ingest_micro_events (batch behavioral telemetry)                     │
│  • store_suspicion_report (threat analysis)                             │
│  • get_session_review / get_employee_report / list_sessions             │
│  • health_check                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
Google-Cloud-Hackathon/
├── .gitignore                       # Blocks **/.env and node_modules
├── LICENSE                          # Apache 2.0 (OSI-approved)
├── package.json                     # npm workspace: hono-api + mcp-server
└── sandbox/
    ├── README.md                    # ← THIS FILE
    ├── CURL_COMMANDS.md            # Smoke-test curl commands
    ├── package.json                # Workspace scripts
    ├── Dockerfile                  # Multi-stage Cloud Run container
    ├── entrypoint.sh               # Concurrent Hono + MCP launcher
    ├── start-services.js           # Node.js dev process manager (production builds)
    ├── dev-services.js             # Auto-reload dev mode (tsx watch)
    ├── test-all-10.ps1             # Full integration test suite (PowerShell)
    ├── test-telemetry.ps1          # Telemetry & observability smoke tests
    ├── hono-api/                   # Hono TypeScript API (Cloud Run)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example            # Copy to .env and configure
    │   └── src/
    │       ├── index.ts            # Entry point, Hono app bootstrap
    │       ├── config.ts           # Environment config loader
    │       ├── types.ts            # Shared TypeScript contracts (FinSec domain)
    │       ├── agents/
    │       │   └── gemini-client.ts # Vertex AI SDK Gemini 3 Flash client (ADC)
    │       └── routes/
    │           ├── health.ts       # GET /health
    │           ├── generate.ts     # POST /api/v1/generate (compliance matrices)
    │           ├── guardian.ts     # POST /api/v1/guardian/ingest · POST /api/v1/guardian/deploy
    │           ├── review.ts       # GET /api/v1/sessions · GET /api/v1/sessions/:id
    │           └── identity.ts     # POST /api/v1/identity/set · GET /api/v1/identity/me
    ├── mcp-server/                 # MCP Server (MongoDB Atlas Grounding)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example            # Copy to .env and configure
    │   └── src/
    │       ├── server.ts           # StdioServerTransport MCP server
    │       ├── mongo-client.ts      # MongoDB native driver + MongoStore
    │       └── http-adapter.ts     # HTTP wrapper for Cloud Run sidecar
    └── frontend/                   # Flutter Compliance Dashboard
        ├── README.md               # Frontend-specific docs
        ├── pubspec.yaml
        └── lib/
            ├── main.dart           # App entry point
            ├── app.dart            # MaterialApp + routing
            ├── models/
            │   ├── health_model.dart
            │   ├── generate_model.dart
            │   ├── guardian_model.dart
            │   └── identity_model.dart
            ├── providers/
            │   ├── health_provider.dart
            │   ├── generate_provider.dart
            │   ├── guardian_provider.dart
            │   ├── review_provider.dart
            │   ├── theme_provider.dart
            │   └── identity_provider.dart
            ├── screens/
            │   ├── dashboard_screen.dart
            │   └── identity_setup_screen.dart
            ├── services/
            │   └── api_service.dart
            ├── theme/
            │   └── app_theme.dart
            └── widgets/
                ├── generate_panel.dart     # Compliance Matrix bottom sheet
                ├── code_workspace_panel.dart
                └── security_metrics_panel.dart
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22
- **Google Cloud Project** with Vertex AI API enabled (project ID: `webscraping-464710`)
- **Application Default Credentials** configured (`gcloud auth application-default login`)
- **MongoDB Atlas** connection string (set as `MONGODB_URI`)
- **Flutter SDK** ≥ 3.24 (for the compliance dashboard)

### 1. Install Dependencies

```bash
cd Google-Cloud-Hackathon
npm install
```

### 2. Configure Environment

```bash
cp sandbox/hono-api/.env.example sandbox/hono-api/.env
cp sandbox/mcp-server/.env.example sandbox/mcp-server/.env
# Edit both .env files with your GCP_PROJECT_ID, GCP_LOCATION, and MONGODB_URI
```

Key configuration options in `.env.example`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_PROJECT_ID` | `webscraping-464710` | Google Cloud project ID for Vertex AI |
| `GCP_LOCATION` | `global` | Vertex AI endpoint — use `global` for Gemini 3 Flash Preview |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Model to use for all inference |
| `GEMINI_MAX_OUTPUT_TOKENS` | `65536` | Max tokens for Gemini responses (prevent truncation on large matrices) |
| `GEMINI_TEMPERATURE` | `0.2` | Determinism control (lower = more deterministic) |
| `MCP_SERVER_ENDPOINT` | `http://localhost:3001` | MCP server URL |
| `SESSION_TTL_SECONDS` | `7200` | Session expiry (2 hours) |
| `MAX_PASTE_EVENTS` | `5` | Max paste events before auto-flagging |
| `DATA_EXFILTRATION_THRESHOLD` | `0.75` | Semantic similarity threshold for exfiltration detection |

### 3. Build & Run Locally

```bash
# Build TypeScript
npm run build -w sandbox/hono-api
npm run build -w sandbox/mcp-server

# Option A: Production mode (compiled JS)
node sandbox/start-services.js

# Option B: Auto-reload dev mode (tsx watch — no build needed)
node sandbox/dev-services.js
```

- Hono API → `http://localhost:8080`
- MCP Server HTTP Adapter → `http://localhost:3001`

### 4. Deploy to Cloud Run

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-finsec-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated
```

---

## 🔧 API Endpoints

### `POST /api/v1/generate` — Compliance Matrix Generator

Accepts a text prompt and returns a structured JSON compliance matrix via the
CISO Orchestrator Agent running on Gemini 3 Flash (`gemini-3-flash-preview`).
Generates target system profiles, regulatory mandate maps, threat vectors, and
penetration scenarios. Authenticated via Application Default Credentials with
3-retry exponential backoff. Supports explicit system targeting and severity
distribution tuning.

**Request:**
```json
{
  "prompt": "Generate a compliance audit matrix for a high-frequency trading desk covering FINRA and SOX mandates...",
  "roleContext": "core-trading-ledger",
  "problemCount": 5
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | `string` | ✅ Yes | — | Natural-language description of the compliance domain |
| `roleContext` | `string` | No | `"mid-level developer"` | Target system context (e.g. "core-trading-ledger", "swift-gateway") |
| `problemCount` | `number` | No | `5` | Number of threat vectors to generate (1–10) |

**Response:** Complete `GeneratedComplianceMatrix` object with `MatrixMetadata`,
`TargetSystem[]`, `RegulatoryMandate[]`, `ThreatVector[]`, and `PenetrationScenario[]`.
See `types.ts` for full schema.

#### Gemini-First Semantic Intake Classifier

Every prompt is routed through a two-stage Gemini classifier
(`classifyComplianceIntent`) before generation:

- **Stage 1 — Meaningfulness**: Gemini determines if the input is coherent
  language (rejecting gibberish, single words, greetings, keyboard mashing)
- **Stage 2 — Compliance Relevance**: Validates the input describes a compliance
  audit/threat matrix generation request, detecting the domain and audit type
- Returns a verdict with `confidence` score, `detectedDomain`, and
  `detectedComplianceType`
- Robust JSON response parsing with a three-tier fallback chain: direct parse
  → `repairJson()` → `extractJsonObject()`
- Every response includes a `pipeline` diagnostics field exposing the
  classifier's decision, enabling full observability

#### Cancel & Resume Generation

Long-running compliance matrix generation can be cancelled mid-flight. A **Cancel Generation**
button appears in the Flutter UI while Gemini is generating. Tapping it shows a
confirmation dialog; on confirmation, the client sends a cancellation signal via
`POST /api/v1/generate/cancel` with the `X-Generation-Request-Id` header.

- **Cancel flow**: The Hono API registers an `AbortController` per request ID.
  When a cancel request arrives, the controller aborts the in-flight Gemini
  Vertex AI call, the stream terminates, and the server returns a `cancelled: true`
  response. The UI transitions to a cancelled state with a **Resume Generation**
  button.
- **Resume flow**: Tapping Resume re-initiates generation with the exact same
  prompt, system context, and threat vector count — but under a fresh request ID.
  The client increments an internal `_generationSeq` counter to prevent stale
  cancelled responses from clobbering the new request's loading state.
- **Request correlation**: A UUID v4 `X-Generation-Request-Id` header is
  generated client-side before the API call and sent with the request. The
  server uses this ID to register the abort controller, ensuring the cancel
  button targets the correct in-flight Gemini call.

#### Deploy Session (`POST /api/v1/guardian/deploy`)

Once a compliance matrix is generated, it can be deployed as an active monitoring
session via the deploy endpoint. This creates an `ActiveSession` in the in-memory
registry and persists to MongoDB Atlas via the MCP sidecar.

**Request:**
```json
{
  "employeeUid": "op-trader-001",
  "sessionId": "active-ledger-audit",
  "matrixId": "matrix-abc123",
  "targetSystem": "Core Trading Ledger"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "active-ledger-audit",
  "employeeId": "op-trader-001",
  "deployedAt": "2026-06-02T12:00:00.000Z",
  "mongoDocumentId": "...",
  "mcpCorrelationId": "..."
}
```

### `POST /api/v1/guardian/ingest` — Insider Threat & Data Exfiltration Guardian

Ingests batched behavioral micro-events and runs Gemini-powered insider threat
analysis using keystroke anomaly detection, paste content similarity scoring,
and behavioral pattern matching. Auto-creates a session if the referenced
`sessionId` does not exist. Returns an `anomalyRiskIndex` (0-100) and triggers
`alertTriggered: true` when the score exceeds 50.

**Request:**
```json
{
  "events": [
    {
      "eventId": "evt-001",
      "sessionId": "sess-abc123",
      "employeeId": "emp-xyz789",
      "auditId": "audit-001",
      "vectorId": "vec-001",
      "eventType": "PASTE_TRIGGER",
      "timestamp": "2026-06-02T10:00:00.000Z",
      "payload": {
        "pasteContent": "function exfiltrateData() { ... }"
      },
      "clientMetadata": {
        "userAgent": "Mozilla/5.0",
        "ipAddress": "127.0.0.1",
        "screenResolution": "1920x1080",
        "platform": "web",
        "language": "en-US"
      }
    }
  ]
}
```

**Response:** Returns `IngestMicroEventResponse` with `processedCount`,
`riskPayload` (a `RiskAssessmentPayload` containing `overallRiskScore`,
`flags`, `behavioralAnomalies`, and `exfiltrationReport`),
`alertTriggered`, and `anomalyRiskIndex`.

Valid `eventType` values: `KEYSTROKE`, `PASTE_TRIGGER`, `CODE_DELTA`,
`TAB_SWITCH`, `WINDOW_BLUR`, `COPY_ATTEMPT`, `DEVELOPER_TOOLS_OPEN`,
`FULLSCREEN_EXIT`, `EXTERNAL_APP_SWITCH`, `SUBMIT`, `EDIT`, `PASTE`.

### `GET /api/v1/guardian/sessions/:sessionId` — Live Session Risk

Returns the current in-memory session state from the Guardian store with live
risk metrics (event counts, paste/tab-switch/fullscreen-exit/copy-attempt
counts, current code, and latest risk assessment payload).

### `GET /api/v1/sessions` — List All Sessions (Dashboard Drawer)

Returns an enriched summary list of all sessions with event counts,
paste/tab-switch metrics, suspicion scores, and peak risk scores. Used by the
Flutter compliance dashboard drawer to populate the session list.

```json
{
  "success": true,
  "data": [
    {
      "sessionId": "ses-clean-001",
      "employeeId": "emp-xyz",
      "auditId": "audit-001",
      "complianceId": "audit-001",
      "status": "active",
      "eventCount": 12,
      "pasteCount": 2,
      "tabSwitchCount": 3,
      "suspicionScore": 45,
      "peakRiskScore": 45,
      "alertTriggered": false,
      "lastEventTimestamp": "2026-06-02T23:40:00.000Z",
      "targetSystem": "Core Trading Ledger",
      "createdAt": "2026-06-02T12:00:00.000Z",
      "startedAt": "2026-06-02T12:00:00.000Z"
    }
  ]
}
```

### `GET /api/v1/sessions/:sessionId` — Audit Review Log

Returns the full session review including terminal workspace content, timeline
(built from micro-events with severity labeling), and risk assessment reports
from MongoDB via the MCP sidecar.

### `GET /health` — Health Check

Returns `{ "status": "ok", "timestamp": "..." }`

### 🔐 Identity Endpoints (Personalization Layer)

A lightweight, password-free identity system for persona-based compliance
demos. Identity is ephemeral — stored in-memory, reset on server restart.
Production deployments integrate with Google Cloud Identity Platform.

#### `POST /api/v1/identity/set` — Register Identity

Sets the current session identity. Returns a `sessionToken` UUID that is
automatically attached to all subsequent API calls via `X-Session-Token` header.

**Request:**
```json
{
  "displayName": "Alice Chen",
  "employeeId": "EMP-001",
  "role": "Senior Trading Desk Operator"
}
```

**Response:**
```json
{
  "success": true,
  "identity": {
    "displayName": "Alice Chen",
    "employeeId": "EMP-001",
    "role": "Senior Trading Desk Operator"
  },
  "sessionToken": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### `GET /api/v1/identity/me` — Get Current Identity

Returns the currently registered identity for the session.

---

## 🛡️ Input Validation & Resilience

All API endpoints implement defense-in-depth input validation to guard against
malformed or unexpected request bodies. The following hardening measures are
applied uniformly across the Hono API layer:

### Request Body Type Guards

Every endpoint validates that `c.req.json()` returns a proper JSON object
before destructuring. Requests with `null`, primitives, or arrays as the
top-level body receive a structured **400 Bad Request** response with a
descriptive error message and a UUIDv4 `correlationId`. This prevents
unhandled `TypeError` crashes caused by property access on non-object values.

The following endpoints have validated body guards:
- **`POST /api/v1/generate`** — rejects non-object bodies; validates
  `prompt` and `roleContext` fields
- **`POST /api/v1/generate/cancel`** — rejects non-object bodies; validates
  `generationRequestId`
- **`POST /api/v1/guardian/ingest`** — rejects non-object bodies; validates
  `events` array
- **`POST /api/v1/guardian/deploy`** — rejects non-object bodies; validates
  `employeeUid`, `sessionId`, `matrixId`, `targetSystem`
- **`POST /api/v1/identity/set`** — rejects non-object bodies with a
  `try/catch` on `c.req.json()` parse; validates `displayName` and
  `employeeId`

### Non-Fatal Gemini Analysis Errors

The Guardian's Gemini-powered risk analysis (`guardian/ingest`) is wrapped in
a `try/catch` block. If Gemini analysis fails (network interruption, model
overload, transient Vertex AI error), the error is logged with a
`[Guardian Route] Gemini analysis FAILED (non-fatal)` message and the ingest
request completes gracefully without a risk payload. The session and events
are still persisted — the frontend simply won't display a live risk score
for that batch.

This ensures a single Gemini outage does not block the entire telemetry
ingestion pipeline.

### MCP Tool Name Consistency

The `persistRiskReport()` function in the Guardian route now calls
`store_suspicion_report` (matching the MCP server's registered tool name).
This fixes a previous HTTP 404 mismatch where the route called
`store_risk_report` which did not exist in the MCP tool registry.

### Field Normalization: `overallRiskScore`

All review endpoints (`GET /api/v1/sessions` and `GET /api/v1/sessions/:id`)
now reference the `overallRiskScore` field from suspicion reports, with a
backward-compatible fallback to the legacy `overallScore` field. This
normalization aligns the API contract with the `RiskAssessmentPayload` type.

### Session Creation Enrichment

The Guardian's `ensureMongoSession()` now passes enriched fields to the MCP
`create_session` tool:
- `candidateId` — mirrors `employeeId` for Atlas indexing
- `assessmentId` — mirrors `auditId` for Atlas indexing
- `status: "in_progress"` — explicit session lifecycle state

### Frontend Prompt Validation

The Flutter compliance dashboard's `GeneratePanel` now performs client-side
validation: an empty audit prompt triggers an inline error message ("Audit
prompt is required") with dedicated error border styling. The required field
indicator (`*`) is displayed next to the "Audit Prompt" label. The error
clears automatically when the user begins typing.

---

## 🔄 Session Persistence & Post-Restart Recovery

Deployed compliance sessions survive server restarts and Cloud Run cold starts
through a three-tier recovery pipeline:

### Tier 1 — In-Memory Fast Path

`GET /api/v1/guardian/sessions` first reads from the in-memory `activeSessions`
Map. When the server process is live and sessions have been deployed, this
returns sub-millisecond responses with enriched risk metrics (paste count, tab
switches, current risk score). This is the default path for active session
monitoring.

### Tier 2 — MongoDB Fallback via MCP

When the in-memory registry is empty (after server restart, Cloud Run scale-to-zero
wake, or container eviction), the Guardian route automatically falls through to
`list_sessions` — the MCP tool that queries MongoDB Atlas. Every previously deployed
session document is deserialized back into an `ActiveSession` and re-hydrated into
the `activeSessions` Map. This means:

- The Flutter dashboard drawer immediately shows all previously deployed sessions
- Subsequent micro-event ingest calls succeed because the session exists in-memory
- Session lifecycle state (`active`, `flagged`, `investigating`, `cleared`) is
  coerced with type-safe validation
- All enriched fields (`peakRiskScore`, `eventCount`, `pasteCount`, `tabSwitchCount`)
  are reconstructed from the MongoDB document

### Tier 3 — Flutter Client Fallback

The Flutter `ApiService.fetchSessions()` implements a parallel fallback chain:

1. **Primary**: `GET /api/v1/sessions` (MongoDB-backed review endpoint, durable
   across restarts) with a 15-second timeout
2. **Fallback**: If the review endpoint returns empty data or times out, the
   client calls `GET /api/v1/guardian/sessions` (the in-memory/MongoDB hybrid
   endpoint described above)

This ensures the session drawer populates even when the MCP sidecar or MongoDB
Atlas is unreachable — as long as in-memory sessions exist.

### Flutter Dashboard UX

The session drawer now displays the **employee UID** as the primary list label
(bold, weight 600) with the **session ID**, **event count**, and **status**
as the subtitle. This makes it easier for compliance officers to identify which
employee each session belongs to at a glance.

---

## 🗄️ MongoDB MCP Tools — 9 Tools via HTTP Adapter

The MCP HTTP adapter (`mcp-server/src/http-adapter.ts`) exposes **9 tools**
via `POST /tools/:toolName`. All database operations route through the
`MongoStore` class (`mongo-client.ts`) using the MongoDB Node.js native driver
with Atlas connection pooling.

### Tool 1: `store_compliance_matrix` / `get_compliance_matrix`
**Purpose:** Persist and retrieve generated compliance matrix documents.
**Store parameters:** `{ suite: GeneratedComplianceMatrix }`
**Get parameters:** `{ suiteId: string }`

### Tool 2: `create_session`
**Purpose:** Initialize an audited employee monitoring session in MongoDB.
Persist session metadata to Atlas and return the generated document ID.
**Parameters:** `{ sessionId, employeeId, complianceId, threatVectorId?, ...extraMeta }`
**Returns:** `{ success: true, mongoDocumentId: string }`

### Tool 3: `ingest_micro_events`
**Purpose:** Batch ingest behavioral micro-events (keystrokes, paste triggers,
tab switches, window blur, copy attempts, fullscreen exits, etc.) from the
compliance dashboard into the session timeline.
**Parameters:** `{ events: MicroEvent[] }`
**Returns:** `{ success: true, processedCount: number }`

### Tool 4: `store_suspicion_report`
**Purpose:** Persist a Gemini-generated threat analysis (suspicion report)
against a session after the Guardian completes its real-time analysis.
**Parameters:** `{ report: RiskAssessmentPayload }`
**Returns:** `{ success: true, mongoDocumentId: string }`

### Tool 5: `get_session_review`
**Purpose:** Fetch the complete analytical review data for a session including
all events, suspicion flags, and submitted code from MongoDB.
**Parameters:** `{ sessionId: string }`
**Returns:** `{ success, session, events, suspicionReports }`

### Tool 6: `get_employee_report`
**Purpose:** Aggregate all suspicion reports for a specific employee
across all sessions.
**Parameters:** `{ employeeId: string }`
**Returns:** `{ success: true, reports }`

### Tool 7: `list_sessions`
**Purpose:** List all sessions with summary fields. Used by the Flutter drawer.
**Parameters:** none
**Returns:** `{ success: true, data: SessionSummary[] }`

### Tool 8: `health_check`
**Purpose:** MongoDB connectivity health check with Atlas ping.
**Returns:** `{ connected: boolean, healthy: boolean, timestamp: string }`

### Auto-Indexing

The `MongoStore` class runs `ensureIndexes()` automatically on startup,
creating core indexes for `sessions`, `micro_events`, `suspicion_reports`,
and `compliance_matrices` collections if they don't already exist.

---

## 🧠 Agent Design Philosophy

### CISO Orchestrator Agent (Compliance Matrix Generation)

The Orchestrator transforms unstructured natural-language audit requirements into
fully-structured, production-grade compliance matrices. It enforces:

- **Target system definition**: Maps abstract financial systems to concrete risk profiles
- **Regulatory mandate mapping**: Weighted sub-scores per compliance area (AML, SOX, GDPR, FINRA)
- **Threat vector construction**: Each vector includes exploit scenarios, detection
  rules, and expected remediation steps
- **Penetration scenario modeling**: Anti-exfiltration measures baked into the
  evaluation (token injection patterns, transfer interception, privilege escalation)

### Insider Threat Guardian Agent (Security)

The Guardian operates as a streaming telemetry event processor:

1. **Paste Trigger Detection**: Intercepts paste events (Ctrl+V) and analyzes pasted
   content for AI-generated code or external data injection patterns using Gemini's
   semantic similarity engine against known reference completions.
2. **Keystroke Anomaly Analysis**: Measures inter-keystroke timing deltas to detect
   non-human typing patterns (instant paste with minimal deltas, burst pastes, or
   copy-paste with obfuscated paste masking).
3. **Tab Switch & Window Blur Monitoring**: Detects external resource lookups and
   browser/IDE tab switches that may indicate unauthorized consultation of external
   tools, AI assistants, or data sources during monitored sessions.
4. **Code Similarity Scoring**: Uses Gemini embeddings to compare employee submitted
   code against Gemini-generated reference completions, computing semantic similarity
   scores to flag AI-generated or externally sourced content.
5. **Composite Risk Scoring**: Combines paste frequency, keystroke timing patterns,
   tab/window switches, and code similarity metrics into a weighted 0-100 risk index
   that triggers alerts when exceeding the configurable threshold.

---

## 📋 Hackathon Compliance Checklist

| Rule | Status | Evidence |
|------|--------|----------|
| **Originality Mandate** | ✅ PASS | All code in `sandbox/` is 100% new; no legacy Express/Flutter code reused |
| **Legacy Code Ban** | ✅ PASS | Zero imports from `../../backend/src` or `../../frontend` |
| **Repository Isolation Rule** | ✅ PASS | All work within `Google-Cloud-Hackathon/sandbox/` — fresh directory |
| **Orchestration Platform** | ✅ PASS | Google Cloud Agent Builder runtime with Gemini 3 Flash model inference |
| **Connectivity Rule (MCP)** | ✅ PASS | MongoDB Atlas MCP server with 9 registered tools via HTTP adapter |
| **No Competing AI Platforms** | ✅ PASS | Zero OpenAI, Anthropic, or AWS Bedrock dependencies |
| **Google Native Routing** | ✅ PASS | All model calls use `@google/genai` SDK with `vertexai: true` (ADC) |
| **Open Source License** | ✅ PASS | Apache 2.0 LICENSE file at repo root |
| **Production-grade** | ✅ PASS | Dockerfile, health checks, non-root user, Cloud Run ready |
| **MongoDB Indexes** | ✅ PASS | Automatic `ensureIndexes()` on MCP startup + documented manual indexes |
| **Financial Services Track** | ✅ PASS | Insider threat detection, data exfiltration guardian, compliance matrix generation |
| **Telemetry & Observability** | ✅ PASS | Enterprise-hardened logging at every pipeline milestone, `test-telemetry.ps1` smoke tests |

---

## ⚡ Telemetry & Testing

Two PowerShell test suites validate the full pipeline:

### `test-telemetry.ps1`
Deep observability smoke tests — validates structured JSON error responses (400),
MCP timeout isolation, in-memory session fallback, and health endpoint connectivity.

### `test-all-10.ps1`  
Full integration test suite — exercises all 10 core pipeline scenarios including
compliance matrix generation, micro-event ingestion, guardian analysis, session
deployment, identity registration, and review endpoint aggregation.

---

Built with ❤️ for the Google Cloud Rapid Agent Hackathon 2026 — Financial Services Track.