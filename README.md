# 🔒 Cerberus FinSec — Insider Threat & Data Exfiltration Guardian

**Google Cloud Rapid Agent Hackathon 2026** — *Google Cloud Financial Services Track*

Cerberus FinSec replaces legacy financial compliance audit platforms with a fully autonomous,
Google Cloud-native insider threat detection engine. Built on **Google Cloud Agent Builder**
with **Hono** as the API runtime layer, **TypeScript**, **Gemini 3 Flash**, and
**Model Context Protocol (MCP)** for the Financial Services track with MongoDB Atlas grounding.

> **💡 Note for Judges**: The complete application source code, Docker
> configuration, and detailed technical documentation live in the
> [`/sandbox/`](sandbox/) directory. This root README serves as the
> submission entry point overview. If the Cloud Run container is cold-starting
> from sleep, please allow **10–15 seconds** for the initial environment to
> spin up. Subsequent requests will be fast.

**Platform Stack**: Google Cloud Agent Builder · Gemini 3 Flash · Hono API ·
TypeScript · Model Context Protocol (MCP) · MongoDB Atlas · Flutter

---

## Table of Contents

- [How Cerberus FinSec Uses Google Cloud Agent Builder](#-how-cerberus-finsec-uses-google-cloud-agent-builder)
- [Three Core Agents](#-three-core-agents)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Install Dependencies](#1-install-dependencies)
  - [Configure Environment](#2-configure-environment)
  - [Set Up MongoDB Indexes](#3-set-up-mongodb-indexes-required-for-performance)
  - [Build & Run Locally](#4-build--run-locally)
  - [Run Flutter Compliance Dashboard](#5-run-flutter-compliance-dashboard)
  - [Deploy to Cloud Run](#6-deploy-to-cloud-run)
- [API Endpoints](#-api-endpoints)
  - [`POST /api/v1/generate` — Compliance Matrix Generator](#post-apiv1generate--compliance-matrix-generator-agent-builder-webhook)
  - [`POST /api/v1/guardian/ingest` — Insider Threat Guardian](#post-apiv1guardianingest--insider-threat--data-exfiltration-guardian)
  - [`GET /api/v1/sessions` — List All Sessions](#get-apiv1sessions--list-all-sessions-dashboard-drawer)
  - [`GET /api/v1/sessions/:id` — Audit Review Log](#get-apiv1sessionsid--audit-review-log)
  - [`GET /health` — Health Check](#get-health--health-check)
  - [Identity Endpoints](#-identity-endpoints-personalization-layer)
- [MongoDB MCP Tools](#%EF%B8%8F-mongodb-mcp-tools--9-tools-via-http-adapter)
- [Vertex AI Setup for Judges & Cloners](#-vertex-ai-setup-for-judges--cloners)
- [Security — Credential Handling](#-security--credential-handling)
- [Agent Design Philosophy](#-agent-design-philosophy)
- [Hackathon Compliance Checklist](#-hackathon-compliance-checklist)
- [Flutter Compliance Dashboard](#-flutter-compliance-dashboard)
- [License](#-license)
- [Submission Assets](#-submission-assets)

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

## 🎯 Three Core Agents

| # | Agent | Capability | Technology |
|---|-------|-----------|------------|
| 1 | **CISO Orchestrator** | Converts a single text prompt into a structured JSON compliance matrix with metadata, target systems, regulatory mandates, threat vectors, and penetration scenarios | Hono + Gemini 3 Flash |
| 2 | **Insider Threat Guardian** | Processes micro-events (paste triggers, keystroke anomalies, tab switches, code deltas) in streaming fashion, assigns live risk payloads; auto-creates sessions if missing | Gemini Reasoning + MCP MongoDB streaming |
| 3 | **Compliance Dashboard** | Split-panel Flutter UI — left: terminal workspace monitor, right: scrollable security timeline with risk scores and behavioral flags; session drawer populated via `GET /api/v1/sessions` | Flutter Material 3 + Provider + SSE |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      FLUTTER COMPLIANCE DASHBOARD                    │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  Terminal Workspace   │  │  Security Timeline + Risk Gauge      │ │
│  │  (Left Panel)         │  │  (Right Panel)                       │ │
│  │  - Live code monitor  │  │  - Color-coded risk severity         │ │
│  │  - Anomaly detection  │  │  - Expandable behavioral flags       │ │
│  └──────────┬───────────┘  └──────────────┬───────────────────────┘ │
└─────────────┼─────────────────────────────┼─────────────────────────┘
              │ HTTP/SSE                    │
              ▼                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     HONO API LAYER (Cloud Run)                       │
│  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │ POST /api/v1     │ │ POST /api/v1     │ │ GET /api/v1         │  │
│  │   /generate      │ │   /guardian      │ │   /sessions         │  │
│  │                  │ │   /ingest        │ │   /sessions/:id     │  │
│  │   Compliance      │ │ POST /guardian   │ │                     │  │
│  │   Matrix Gen      │ │   /deploy        │ │   Audit Trail       │  │
│  │                  │ │                  │ │   + Analytics       │  │
│  │  Google Cloud     │ │  Insider Threat  │ │                     │  │
│  │  Agent Builder    │ │  Guardian        │ │                     │  │
│  │  Webhook Target   │ │                  │ │                     │  │
│  └───────┬──────────┘ └───────┬──────────┘ └──────────┬──────────┘  │
│          │                    │                        │             │
│          ▼                    ▼                        ▼             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │            GEMINI 3 FLASH — COMPLIANCE & SECURITY LAYER        │  │
│  │  • CISO Orchestrator — compliance matrix generation           │  │
│  │  • Insider Threat Guardian — keystroke + paste + tab anomaly  │  │
│  │  • 90s timeout + exponential backoff for reliable generation  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ MCP (Model Context Protocol)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│               MCP SERVER — MONGODB ATLAS GROUNDING                    │
│  • Sessions Collection    • Micro-Events Collection                  │
│  • Risk Reports           • 9 registered MCP tools                   │
│  • HTTP adapter for Cloud Run sidecar deployment                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
Google-Cloud-Hackathon/
├── .github/
│   └── HACKATHON_RULES.md            # Official compliance directive
├── .gitignore                         # Blocks **/.env and node_modules
├── LICENSE                            # Apache 2.0 (OSI-approved)
├── README.md                          # ← THIS FILE (submission entry point)
├── package.json                       # npm workspace: hono-api + mcp-server
└── sandbox/                           # ← ALL APPLICATION CODE
    ├── README.md                      # Detailed technical documentation
    ├── CURL_COMMANDS.md              # Smoke-test curl commands
    ├── package.json                   # Sandbox-local npm config
    ├── Dockerfile                     # Multi-stage Cloud Run container
    ├── entrypoint.sh                  # Concurrent Hono + MCP launcher
    ├── start-services.js              # Node.js dev process manager (production build)
    ├── dev-services.js                # Auto-reload dev mode (tsx watch)
    ├── test-all-10.ps1               # Full integration test suite (PowerShell)
    ├── test-telemetry.ps1            # Telemetry & observability smoke tests
    ├── hono-api/                      # Hono TypeScript API (Cloud Run)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example               # Copy to .env and configure
    │   └── src/
    │       ├── index.ts               # Entry point, Hono app bootstrap
    │       ├── config.ts              # Environment config loader (env-only)
    │       ├── types.ts               # Shared TypeScript contracts (FinSec domain)
    │       ├── agents/
    │       │   └── gemini-client.ts   # Vertex AI SDK Gemini 3 Flash client (ADC)
    │       └── routes/
    │           ├── health.ts          # GET /health
    │           ├── generate.ts        # POST /api/v1/generate (compliance matrices)
    │           ├── guardian.ts        # POST /api/v1/guardian/ingest · POST /api/v1/guardian/deploy
    │           ├── review.ts          # GET /api/v1/sessions · GET /api/v1/sessions/:id
    │           └── identity.ts        # POST /api/v1/identity/set · GET /api/v1/identity/me
    ├── mcp-server/                    # MCP Server (MongoDB Atlas Grounding)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example               # Copy to .env and configure
    │   └── src/
    │       ├── server.ts              # StdioServerTransport MCP server
    │       ├── mongo-client.ts        # MongoDB native driver + MongoStore
    │       └── http-adapter.ts        # HTTP wrapper for Cloud Run sidecar
    └── frontend/                      # Flutter Compliance Dashboard
        ├── README.md                  # Frontend-specific docs
        ├── pubspec.yaml
        └── lib/
            ├── main.dart
            ├── app.dart
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
- **Google Cloud Project** with [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) enabled
- **Application Default Credentials (ADC)** — authenticate via `gcloud auth application-default login`
- **GCP Project ID + Location** → set `GCP_PROJECT_ID` and `GCP_LOCATION` in `.env`
- **MongoDB Atlas** connection string → set as `MONGODB_URI`
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
# Edit sandbox/hono-api/.env with your GCP_PROJECT_ID, GCP_LOCATION, and MONGODB_URI
# Edit sandbox/mcp-server/.env with your MONGODB_URI
```

See `.env.example` for all available options including `GCP_LOCATION`
(default: `global`), `GEMINI_REQUEST_TIMEOUT_MS` (default 90s), and data exfiltration
thresholds.

> **🔐 Authentication**: No API key is required. Cerberus FinSec authenticates via
> **Application Default Credentials (ADC)**. Run `gcloud auth application-default login`
> once on your machine. On Cloud Run, ADC is auto-injected by the GCP metadata
> server. See the [Vertex AI Setup Guide](#-vertex-ai-setup-for-judges--cloners)
> below for one-shot configuration.

### 3. Set Up MongoDB Indexes (Required for Performance)

**⚠️ Without these indexes, aggregation queries against large session datasets
will time out and cause the frontend to freeze.**

Connect to your MongoDB Atlas cluster via `mongosh` or Compass and run:

```javascript
// Switch to your database
use cerberus_finsec;

// Index for session lookups by employee
db.sessions.createIndex(
  { employeeId: 1 },
  { name: "idx_sessions_employeeId" }
);

// Compound index for session review aggregation
db.sessions.createIndex(
  { sessionId: 1, createdAt: -1 },
  { name: "idx_sessions_sessionId_createdAt" }
);

// Index on micro-events for timeline queries
db.micro_events.createIndex(
  { sessionId: 1, timestamp: 1 },
  { name: "idx_microevents_session_timestamp" }
);

// Index for suspicion report lookups
db.suspicion_reports.createIndex(
  { sessionId: 1, generatedAt: -1 },
  { name: "idx_suspicion_session_generated" }
);

// Text index for semantic code similarity searches (optional but recommended)
db.sessions.createIndex(
  { currentCode: "text" },
  { name: "idx_sessions_code_text" }
);

// Verify indexes were created
db.sessions.getIndexes();
db.micro_events.getIndexes();
db.suspicion_reports.getIndexes();
```

> **Note**: The MCP server also runs `ensureIndexes()` automatically on startup
> to create the core indexes if they don't exist.

### 4. Build & Run Locally

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

### 5. Run Flutter Compliance Dashboard

```bash
cd sandbox/frontend
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8080
```

### 6. Deploy to Cloud Run

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-finsec-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated
```

> **⚠️ Cold Start Notice for Judges**: Cloud Run containers enter a suspended
> state after periods of inactivity. The first request after sleep triggers a
> cold start which may take **10–15 seconds** while the Hono API and MCP
> server initialize. The Flutter frontend will automatically retry and
> connect. Subsequent requests are served at full speed.

---

## 🔧 API Endpoints

### `POST /api/v1/generate` — Compliance Matrix Generator (Agent Builder Webhook)

Accepts a text prompt and returns a structured JSON compliance matrix via the
CISO Orchestrator Agent running on Gemini 3 Flash (`gemini-3-flash-preview`).
Generates target system profiles, regulatory mandate maps, threat vectors, and
penetration scenarios. Authenticated via Application Default Credentials with
3-retry exponential backoff. Supports explicit system targeting and severity
distribution tuning.

```json
// Request
{
  "prompt": "Generate a compliance audit matrix for a high-frequency trading desk covering FINRA and SOX mandates...",
  "roleContext": "core-trading-ledger",
  "problemCount": 5
}

// Response: GeneratedComplianceMatrix { matrixMetadata, targetSystems[], regulatoryMandates[], threatVectors[], penetrationScenarios[] }
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompt` | `string` | ✅ Yes | — | Natural-language description of the compliance domain |
| `roleContext` | `string` | No | `"mid-level developer"` | Target system context (e.g. "core-trading-ledger", "swift-gateway") |
| `problemCount` | `number` | No | `5` | Number of threat vectors to generate (1–10) |

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

### `POST /api/v1/guardian/ingest` — Insider Threat & Data Exfiltration Guardian

Ingests batched behavioral micro-events and runs Gemini-powered insider threat
analysis using keystroke anomaly detection, paste content similarity scoring,
and behavioral pattern matching. Auto-creates a session if the referenced
`sessionId` does not exist. Returns an `anomalyRiskIndex` (0-100) and triggers
`alertTriggered: true` when the score exceeds 50.

```json
// Request
{
  "events": [
    {
      "eventId": "evt-001",
      "sessionId": "sess-abc123",
      "employeeId": "emp-xyz789",
      "auditId": "audit-001",
      "eventType": "PASTE_TRIGGER",
      "timestamp": "2026-06-02T10:00:00.000Z",
      "payload": { "pasteContent": "function exfiltrateData() { ... }" }
    }
  ]
}

// Response: IngestMicroEventResponse { processedCount, riskPayload, alertTriggered, anomalyRiskIndex }
```

Valid `eventType` values: `KEYSTROKE`, `PASTE_TRIGGER`, `CODE_DELTA`,
`TAB_SWITCH`, `WINDOW_BLUR`, `COPY_ATTEMPT`, `DEVELOPER_TOOLS_OPEN`,
`FULLSCREEN_EXIT`, `EXTERNAL_APP_SWITCH`, `SUBMIT`, `EDIT`, `PASTE`.

### `GET /api/v1/sessions` — List All Sessions (Dashboard Drawer)

Returns an enriched summary list of all sessions with event counts,
paste/tab-switch metrics, suspicion scores, and peak risk scores. Used by the
Flutter compliance dashboard drawer to populate the session list.

```json
// Response
{
  "success": true,
  "data": [
    {
      "sessionId": "ses-clean-001",
      "employeeId": "emp-xyz",
      "auditId": "audit-001",
      "complianceId": "audit-001",
      "lastEventTimestamp": "2026-06-02T23:40:00.000Z",
      "eventCount": 12,
      "suspicionScore": 45
    }
  ]
}
```

### `GET /api/v1/sessions/:id` — Audit Review Log

Returns the full session review including terminal workspace content, timeline
(built from micro-events with severity labeling), and risk assessment reports
from MongoDB via the MCP sidecar.

### `GET /health` — Health Check

```json
{ "status": "ok", "timestamp": "2026-06-02T..." }
```

### 🔐 Identity Endpoints (Personalization Layer)

A lightweight, password-free identity system for persona-based compliance
demos. Identity is ephemeral — stored in-memory, reset on server restart.
Production deployments integrate with Google Cloud Identity Platform.

#### `POST /api/v1/identity/set` — Register Identity

Sets the current session identity. Returns a `sessionToken` UUID that is
automatically attached to all subsequent API calls via `X-Session-Token` header.

```json
// Request
{
  "displayName": "Alice Chen",
  "employeeId": "EMP-001",
  "role": "Senior Trading Desk Operator"
}

// Response
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

## 🗄️ MongoDB MCP Tools — 9 Tools via HTTP Adapter

The MCP HTTP adapter (`mcp-server/src/http-adapter.ts`) exposes **9 tools**
via `POST /tools/:toolName`. All database operations route through the
`MongoStore` class (`mongo-client.ts`) using the MongoDB Node.js native driver
with Atlas connection pooling.

| Tool | Operation | Purpose |
|------|-----------|---------|
| `store_compliance_matrix` | INSERT | Persist generated compliance matrix |
| `get_compliance_matrix` | FIND | Retrieve a compliance matrix by suiteId |
| `create_session` | INSERT | Initialize employee monitoring session |
| `ingest_micro_events` | INSERT MANY | Batch-ingest behavioral event array |
| `store_suspicion_report` | INSERT | Store Gemini threat analysis report |
| `get_session_review` | AGGREGATE | Full review log (session + events + reports) |
| `get_employee_report` | AGGREGATE | Aggregate suspicion reports for an employee |
| `list_sessions` | FIND | List all sessions (supports drawer population) |
| `health_check` | PING | MongoDB connectivity test |

All operations use the MongoDB Node.js native driver with Atlas connection pooling.

---

## 🔐 Vertex AI Setup for Judges & Cloners

Cerberus FinSec uses **Google Cloud Vertex AI** with **Application Default
Credentials (ADC)** — no API keys required. Follow these one-shot steps:

### 1. Prerequisites

- A Google Cloud project with the **Vertex AI API** enabled → [Enable API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
- The `gcloud` CLI installed → [Install gcloud](https://cloud.google.com/sdk/docs/install)

### 2. Authenticate Locally

```bash
gcloud auth application-default login
```

This creates an ADC file at one of:
- **Windows**: `%APPDATA%/gcloud/application_default_credentials.json`
- **Linux/macOS**: `~/.config/gcloud/application_default_credentials.json`

The app auto-discovers this file on startup. No manual path configuration
needed.

### 3. Configure Environment

```bash
cd sandbox
cp hono-api/.env.example hono-api/.env
cp mcp-server/.env.example mcp-server/.env
```

Edit `hono-api/.env` with your values:

```env
# REQUIRED: Your GCP project ID
GCP_PROJECT_ID=webscraping-464710

# Vertex AI regional endpoint — use "global" for Gemini 3 Flash Preview
GCP_LOCATION=global

# Model (hackathon-mandated)
GEMINI_MODEL=gemini-3-flash-preview
```

> 💡 **Why `global`?** The `gemini-3-flash-preview` model resolves reliably on
> the Vertex AI `global` endpoint across all GCP billing accounts. Regional
> endpoints (`us-central1`, etc.) may return 404s during preview phases. The
> app includes an automatic fallback to `gemini-2.5-flash` as a safeguard.

### 4. Verify Setup

```bash
cd sandbox/hono-api
node -e "
const{G}=require('@google/genai');
async function t(){
  const a=new G({vertexai:true,project:'YOUR_PROJECT_ID',location:'global'});
  const r=await a.models.generateContent({model:'gemini-3-flash-preview',
    contents:[{role:'user',parts:[{text:'Say: OK'}]}],
    config:{maxOutputTokens:10,temperature:0}});
  console.log(r.candidates[0].content.parts[0].text.trim());
};t();
"
# Expected output: "OK"
```

### 5. Cloud Run (Production)

No additional setup needed. Cloud Run automatically injects ADC via the
GCP metadata server. Just deploy with:

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-finsec-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated \
  --set-env-vars=GCP_PROJECT_ID=$PROJECT_ID,GCP_LOCATION=global
```

---

## 🔒 Security — Credential Handling

All project IDs, connection strings, and configuration values are read
**exclusively from environment variables** via `process.env`. No hardcoded
credentials exist in any source file:

| Variable | Purpose | Required |
|----------|---------|----------|
| `GCP_PROJECT_ID` | Vertex AI project identification | ✅ Yes |
| `GCP_LOCATION` | Vertex AI regional endpoint | ✅ Yes |
| `MONGODB_URI` | MongoDB Atlas connection string | ✅ Yes |
| `MCP_SERVER_ENDPOINT` | Internal MCP server URL | No |

The `.env.example` files contain only placeholder values. `.env` is listed
in `.gitignore`:

```gitignore
# In .gitignore (already configured)
**/.env
```

**Verification**: Running `git log -p --all -- '*.env' | grep -i 'api.key\|GEMINI_API_KEY'`
should return zero results. The repository history contains no committed secrets.

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

## 🎨 Flutter Compliance Dashboard

- **Material 3** design with full **dark/light theme** support
- **Split-panel dashboard**: left = terminal workspace monitor, right = security metrics timeline
- **Provider** state management across health, generation, guardian, review, and identity flows
- Reactive **risk severity gauge** with color-coded indicators
- SSE-powered live security event streaming
- **Identity setup screen** — personalized employee persona selection for compliance demo sessions

---

---

## 📄 License

Apache 2.0 — See [LICENSE](LICENSE) for full legal text.

---

## 🎥 Submission Assets

- **Repository**: [https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon](https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon)
- **Application Code**: [`sandbox/`](sandbox/) directory
- **Demo Video**: Provided in the submission deliverables
- **Live App**: Deployed via Google Cloud Run

---

Built for the **Google Cloud Rapid Agent Hackathon 2026** — Financial Services Track