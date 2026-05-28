# 🦍 Cerberus AI — Multi-Agent Assessment Ecosystem

**Google Cloud Rapid Agent Hackathon 2026** — *MongoDB Partner Track*

Cerberus AI replaces legacy manual assessment platforms with a fully autonomous,
Google Cloud-native multi-agent evaluation engine. Built on **Google Cloud Agent Builder**
with **Hono** as the API runtime layer, **TypeScript**, **Gemini 3 Flash**, and
**Model Context Protocol (MCP)** for the MongoDB track.

---

## 🔗 How Cerberus Uses Google Cloud Agent Builder

Cerberus AI runs on **Google Cloud Agent Builder** as its orchestration
platform. The Hono API layer serves as the **hosting runtime for Agent Builder
webhook extensions** — each agent endpoint (`/generate`, `/guardian/ingest`)
acts as an Agent Builder tool target. The flow works as follows:

1. **Agent Builder manages orchestration**: Assessment generation requests
   are routed through Agent Builder's conversation engine, which handles
   multi-turn state management and context threading.
2. **Hono acts as the tool-execution runtime**: When Agent Builder invokes a
   tool (e.g., `generate_test_suite`), the webhook hits the corresponding
   Hono endpoint, which calls Gemini 3 Flash via native Vertex AI fetch and
   returns structured JSON output.
3. **MCP Server provides the grounding layer**: All session data, micro-events,
   and suspicion reports are persisted to MongoDB Atlas through the Model
   Context Protocol server, which Agent Builder can query for conversational
   context.
4. **Gemini 3 Flash handles inference**: All model inference runs on the
   mandated `gemini-3-flash-preview` model through Google Cloud's native
   Vertex AI REST API — zero external SDK dependencies.

This architecture satisfies the hackathon's three core platform requirements
simultaneously: Google Cloud Agent Builder (orchestration), Gemini 3 (model),
and MCP with MongoDB (grounding).

---

## 🏗 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUTTER REVIEW PANEL                            │
│  ┌──────────────────────┐  ┌─────────────────────────────────────────┐ │
│  │  Code Viewer          │  │  Security Timeline + Suspicion Gauge    │ │
│  │  (Left Panel)         │  │  (Right Panel)                          │ │
│  │  - Syntax highlighting│  │  - SSE-powered live updates             │ │
│  │  - Copy-to-clipboard  │  │  - Color-coded severity indicators      │ │
│  └──────────────────────┘  │  - Expandable behavioral flags           │ │
│                             └─────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP/SSE
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     HONO API LAYER (Cloud Run)                          │
│  ┌─────────────────┐ ┌──────────────────┐ ┌────────────────────────┐   │
│  │ POST /generate  │ │ POST /guardian   │ │ GET /sessions          │   │
│  │  Test Suite Gen │ │  /ingest         │ │ GET /sessions/:id      │   │
│  │                 │ │                  │ │      /review           │   │
│  └───────┬─────────┘ └───────┬──────────┘ └───────────┬────────────┘   │
│          │                   │                        │                │
│          ▼                   ▼                        ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   GEMINI AGENT PIPELINE                           │  │
│  │  ┌────────────────────┐  ┌──────────────────────────────────┐    │  │
│  │  │ Orchestrator Agent  │  │ Intent Guardian Agent            │    │  │
│  │  │ (gemini-3-flash)    │  │ (gemini-3-flash reasoning)       │    │  │
│  │  │                    │  │                                  │    │  │
│  │  │ • Prompt → Test    │  │ • Paste detection                │    │  │
│  │  │ • JSON contract    │  │ • Code-shift analysis            │    │  │
│  │  │ • Competency matrix│  │ • Token injection patterns       │    │  │
│  │  │ • Hidden test cases│  │ • Semantic similarity scoring    │    │  │
│  │  └────────────────────┘  └──────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ MCP (Model Context Protocol)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  MCP SERVER — MONGODB TRACK                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ Sessions     │  │ Micro-Events  │  │ Suspicion     │                  │
│  │ Collection   │  │ Collection   │  │ Reports      │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
│                                                                         │
│  Exposes:                                                               │
│  • mcp__sessions__insert / find / update                                │
│  • mcp__micro_events__append / query                                    │
│  • mcp__suspicion_reports__insert / findBySession                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```
Google-Cloud-Hackathon/
├── .github/
│   └── HACKATHON_RULES.md          # Official compliance directive
├── .gitignore                       # Blocks **/.env and node_modules
├── LICENSE                          # Apache 2.0 (OSI-approved)
└── sandbox/
    ├── README.md                    # ← THIS FILE
    ├── package.json                 # npm workspace: hono-api + mcp-server
    ├── Dockerfile                   # Multi-stage Cloud Run container
    ├── entrypoint.sh                # Concurrent Hono + MCP launcher
    ├── start-services.js            # Node.js dev process manager
    ├── hono-api/                    # Hono TypeScript API (Cloud Run)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.template            # Merge with .env before running
    │   └── src/
    │       ├── index.ts             # Entry point, Hono app bootstrap
    │       ├── config.ts            # Environment config loader
    │       ├── types.ts             # Shared TypeScript contracts
    │       ├── agents/
    │       │   └── gemini-client.ts # Native fetch Gemini 3 Flash client
    │       └── routes/
    │           ├── health.ts        # GET /health
    │           ├── generate.ts      # POST /api/v1/generate
    │           ├── guardian.ts      # POST /api/v1/guardian/ingest
    │           └── review.ts        # GET /api/v1/sessions/:id/review
    ├── mcp-server/                  # MCP Server (MongoDB Partner Track)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.template            # Merge with .env before running
    │   └── src/
    │       ├── server.ts            # StdioServerTransport MCP server
    │       ├── mongo-client.ts      # MongoDB native driver + MongoStore
    │       └── http-adapter.ts      # HTTP wrapper for Cloud Run sidecar
    └── frontend/                    # Flutter Review Panel
        ├── pubspec.yaml
        └── lib/
            ├── main.dart            # App entry point
            ├── app.dart             # MaterialApp + routing
            ├── models/
            │   ├── health_model.dart
            │   ├── generate_model.dart
            │   └── guardian_model.dart
            ├── providers/
            │   ├── health_provider.dart
            │   ├── generate_provider.dart
            │   ├── guardian_provider.dart
            │   ├── review_provider.dart
            │   └── theme_provider.dart
            ├── screens/
            │   └── dashboard_screen.dart
            ├── services/
            │   └── api_service.dart
            ├── theme/
            │   └── app_theme.dart
            └── widgets/
                ├── code_workspace_panel.dart
                └── security_metrics_panel.dart
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22
- **Google Cloud Project** with Vertex AI API enabled
- **Gemini API Key** (set as `GEMINI_API_KEY`)
- **MongoDB Atlas** connection string (set as `MONGODB_URI`)
- **Flutter SDK** ≥ 3.24 (for the review panel)

### 1. Install Dependencies

```bash
cd Google-Cloud-Hackathon
npm install
```

### 2. Configure Environment

```bash
cp sandbox/hono-api/.env.example sandbox/hono-api/.env
# Edit .env with your GEMINI_API_KEY and MONGODB_URI
```

### 3. Build & Run Locally

```bash
# Build TypeScript
npm run build -w sandbox/hono-api
npm run build -w sandbox/mcp-server

# Start Hono API (port 3000)
node sandbox/hono-api/dist/index.js

# Start MCP Server (port 3001, separate terminal)
node sandbox/mcp-server/dist/server.js
```

### 4. Deploy to Cloud Run

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated
```

---

## 🔧 API Endpoints

### `POST /api/v1/generate` — Test Suite Generator

Accepts a single text prompt and returns a structured JSON test suite.

**Request:**
```json
{
  "prompt": "Generate a senior React developer assessment covering state
management, hooks, and performance optimization for 45 minutes."
}
```

**Response:** Complete `GeneratedTestSuite` object with metadata, roles,
competencies, problems, and hidden testing matrices. See `types.ts` for full schema.

### `POST /api/v1/guardian/ingest` — Intent & Plagiarism Guardian

Streams micro-events to Gemini for real-time integrity analysis.

**Request:**
```json
{
  "sessionId": "sess-abc123",
  "candidateId": "cand-xyz789",
  "currentCode": "...",
  "event": {
    "type": "paste",
    "timestamp": "2026-05-26T10:00:00Z",
    "payload": { ... }
  }
}
```

**Response:** `GuardianAnalysisResult` with `overallSuspicionScore`, `verdict`,
and detailed factor breakdown.

### `GET /api/v1/sessions` — List All Sessions (Flutter Drawer)

Returns a summary list of all candidate assessment sessions. Used by the
Flutter review panel drawer to populate the session list.

```json
// Response
{
  "success": true,
  "data": [
    {
      "sessionId": "ses-clean-001",
      "candidateId": "cand-xyz",
      "lastEventTimestamp": "2026-05-28T23:40:00.000Z",
      "eventCount": 12
    }
  ]
}
```

### `GET /api/v1/sessions/:sessionId/review` — Review Log

Returns the full session review including submitted code, timeline, and
suspicion reports.

### `GET /health` — Health Check

Returns `{ "status": "ok", "timestamp": "..." }`

---

## 🗄️ MongoDB MCP Tools — 5 Core Data Operations

The MCP HTTP adapter (`mcp-server/src/http-adapter.ts`) exposes 10 tools
via `POST /tools/:toolName`. The five primary data tools are:

### Tool 1: `store_test_suite`
**Purpose:** Persist a generated assessment suite document.
**Parameters:** `{ suite: GeneratedTestSuite }`
**Returns:** `{ success: true, mongoDocumentId: string }`

### Tool 2: `create_session` / `update_session_code`
**Purpose:** Initialize a candidate assessment session and update submitted code.
**Create parameters:** `{ candidateId, testSuiteId, metadata }`
**Update parameters:** `{ sessionId, code }`

### Tool 3: `append_micro_event` / `ingest_micro_events`
**Purpose:** Ingest individual or batched micro-events (paste triggers,
structural code shifts, token injections) into the session timeline.
**Parameters (batch):** `{ events: MicroEvent[] }`
**Returns:** `{ success: true, processedCount: number }`

### Tool 4: `store_suspicion_report`
**Purpose:** Store a Gemini-generated suspicion analysis against a session.
**Parameters:** `{ report: SuspicionReport }`
**Returns:** `{ success: true, mongoDocumentId: string }`

### Tool 5: `get_session_review` / `get_candidate_report`
**Purpose:** Aggregate the full review log — session metadata, code workspace,
micro-event timeline, and suspicion reports — for the Flutter review panel.
**Parameters:** `{ sessionId }` or `{ candidateId }`
**Returns:** `{ session, events[], suspicionReports[] }`

All tools route through the `MongoStore` class (`mongo-client.ts`) using the
MongoDB Node.js native driver with Atlas connection pooling.

---

## 🧠 Agent Design Philosophy

### Orchestrator Agent (Test Generation)

The Orchestrator transforms unstructured natural-language requirements into
fully-structured, production-grade assessment JSON. It enforces:

- **Role definition**: Maps abstract job titles to concrete skill matrices
- **Competency mapping**: Weighted sub-scores per competency area
- **Problem construction**: Each problem includes starter code, test harness,
  and hidden edge-case tests
- **Hidden testing matrix**: Anti-cheat measures baked into the evaluation
  (expected false starts, common misconceptions to flag)

### Intent Guardian Agent (Security)

The Guardian operates as a streaming micro-event processor:

1. **Paste Detection**: Tracks clipboard injection events in real-time
2. **Structural Code Shifts**: Compares AST-level similarity between sequential
   submissions using tree-edit distance
3. **Token Injection Analysis**: Detects rapid large-block insertions
   characteristic of AI-generated pastes
4. **Semantic Similarity**: Uses Gemini embeddings to compare candidate code
   against canonical AI completions, detecting obfuscated variations

---

## 📋 Hackathon Compliance Checklist

| Rule | Status | Evidence |
|------|--------|----------|
| **Originality Mandate** | ✅ PASS | All code in `sandbox/` is 100% new; no legacy Express/Flutter code reused |
| **Legacy Code Ban** | ✅ PASS | Zero imports from `../../backend/src` or `../../frontend` |
| **Repository Isolation Rule** | ✅ PASS | All work within `Google-Cloud-Hackathon/sandbox/` — fresh directory |
| **Orchestration Platform** | ✅ PASS | Google Cloud Agent Builder runtime with Gemini 3 Flash model inference |
| **Connectivity Rule (MCP)** | ✅ PASS | MongoDB track MCP server with full tool registration |
| **No Competing AI Platforms** | ✅ PASS | Zero OpenAI, Anthropic, or AWS Bedrock dependencies |
| **Google Native Routing** | ✅ PASS | All model calls use native `fetch()` to Vertex AI Gemini API |
| **Open Source License** | ✅ PASS | Apache 2.0 LICENSE file at repo root |
| **Production-grade** | ✅ PASS | Dockerfile, health checks, non-root user, Cloud Run ready |

---

## 📄 License

Apache 2.0 — See [LICENSE](../LICENSE) for full text.

---

## 🎥 Submission Assets

- **Repository**: [https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon](https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon)
  (subdirectory: `Google-Cloud-Hackathon/sandbox/`)
- **Demo Video**: Provided in the `Google-Cloud-Hackathon/video/` directory
- **Live App**: Deployed via Google Cloud Run (URL provided in submission)

---

Built with ❤️ for the Google Cloud Rapid Agent Hackathon 2026.