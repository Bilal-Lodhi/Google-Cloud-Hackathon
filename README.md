# 🦍 Cerberus AI — Multi-Agent Assessment Ecosystem

**Google Cloud Rapid Agent Hackathon 2026** — *MongoDB Partner Track*

Cerberus AI is a fully autonomous, Google Cloud-native multi-agent evaluation
engine that replaces manual assessment platforms with AI-driven test
generation, real-time plagiarism detection, and interactive analytical review
panels.

> **💡 Note for Judges**: The complete application source code, Docker
> configuration, and detailed technical documentation live in the
> [`/sandbox/`](sandbox/) directory. This root README serves as the
> submission entry point overview. If the Cloud Run container is cold-starting
> from sleep, please allow **10–15 seconds** for the initial environment to
> spin up. Subsequent requests will be fast.

**Platform Stack**: Google Cloud Agent Builder · Gemini 3 Flash · Hono API ·
TypeScript · Model Context Protocol (MCP) · MongoDB Atlas · Flutter

---

## 🔗 How Cerberus Uses Google Cloud Agent Builder

Cerberus AI runs on **Google Cloud Agent Builder** as its orchestration
platform. The Hono API layer serves as the **hosting runtime for Agent Builder
webhook extensions** — each agent endpoint (`/generate`, `/guardian/ingest`)
acts as an Agent Builder tool target.

### Why Hono Performs Model Inference Inside Webhooks

Rather than duplicating Agent Builder's native conversational loops, the Hono
API uses Gemini 3 Flash as a **deterministic stream validator and security
enforcement layer**:

1. **Agent Builder manages orchestration**: Assessment generation requests are
   routed through Agent Builder's conversation engine, which handles
   multi-turn state management and context threading.
2. **Hono acts as the security validation runtime**: When Agent Builder invokes
   a tool (e.g., `generate_test_suite`), the webhook hits the Hono endpoint.
   Hono calls Gemini 3 Flash to validate JSON structural contracts, enforce
   anti-cheat payload schemas, and sanitize outputs before they are persisted.
   This is an **isolated security layer**, not a replacement for Agent
   Builder's primary conversational loops.
3. **MCP Server provides the grounding layer**: All session data, micro-events,
   and suspicion reports are persisted to MongoDB Atlas through the Model
   Context Protocol server, which Agent Builder can query for conversational
   context.
4. **Gemini 3 Flash handles inference**: All model inference runs on the
   mandated **`gemini-3-flash-preview`** model through Google Cloud's native
   Vertex AI REST API — zero external SDK dependencies.

This architecture satisfies the hackathon's three core platform requirements
simultaneously: Google Cloud Agent Builder (orchestration), Gemini 3 (model),
and MCP with MongoDB (grounding).

---

## 🎯 Three Core Agents

| # | Agent | Capability | Technology |
|---|-------|-----------|------------|
| 1 | **Autonomous Test Suite Generator** | Converts a single text prompt into a structured JSON assessment with metadata, competency matrices, coding problems, and hidden anti-cheat test cases | Hono + Gemini 3 Flash Orchestrator |
| 2 | **Real-Time Intent & Plagiarism Guardian** | Processes micro-events (paste triggers, code shifts, token injections) in streaming fashion, assigns live suspicion payloads | Gemini Reasoning + MCP MongoDB streaming |
| 3 | **Interactive Analytical Review Log** | Split-panel Flutter UI — left: candidate code workspace, right: scrollable security timeline with suspicion scores and behavioral flags | Flutter Material 3 + Provider + SSE |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      FLUTTER REVIEW PANEL                            │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐ │
│  │  Code Viewer (Left)   │  │  Security Timeline + Suspicion Gauge │ │
│  │  - Syntax highlight   │  │  (Right)                             │ │
│  │  - Copy-to-clipboard  │  │  - Color-coded severity indicators   │ │
│  └──────────┬───────────┘  │  - Expandable behavioral flags        │ │
│             │              └──────────────┬───────────────────────┘ │
└─────────────┼─────────────────────────────┼─────────────────────────┘
              │ HTTP/SSE                    │
              ▼                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     HONO API LAYER (Cloud Run)                       │
│  ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────────┐  │
│  │ POST /api/v1     │ │ POST /api/v1     │ │ GET /api/v1         │  │
│  │   /generate      │ │   /guardian      │ │   /sessions/:id     │  │
│  │                  │ │   /ingest        │ │   /review           │  │
│  │  Google Cloud    │ │                  │ │                     │  │
│  │  Agent Builder   │ │  Security        │ │  Audit Trail        │  │
│  │  Webhook Target  │ │  Validation      │ │  + Analytics        │  │
│  └───────┬──────────┘ └───────┬──────────┘ └──────────┬──────────┘  │
│          │                    │                        │             │
│          ▼                    ▼                        ▼             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │            GEMINI 3 FLASH — SECURITY & VALIDATION LAYER        │  │
│  │  • Orchestrator Agent — JSON contract validation + transforms │  │
│  │  • Intent Guardian Agent — semantic similarity + paste detect │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ MCP (Model Context Protocol)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  MCP SERVER — MONGODB ATLAS TRACK                     │
│  • Sessions Collection    • Micro-Events Collection                  │
│  • Suspicion Reports      • 10 registered MCP tools                  │
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
    ├── package.json                   # Sandbox-local npm config
    ├── Dockerfile                     # Multi-stage Cloud Run container
    ├── entrypoint.sh                  # Concurrent Hono + MCP launcher
    ├── start-services.js              # Node.js dev process manager
    ├── hono-api/                      # Hono TypeScript API (Cloud Run)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example               # Copy to .env and configure
    │   └── src/
    │       ├── index.ts               # Entry point, Hono app bootstrap
    │       ├── config.ts              # Environment config loader (env-only)
    │       ├── types.ts               # Shared TypeScript contracts
    │       ├── agents/
    │       │   └── gemini-client.ts   # Native fetch to Gemini 3 Flash
    │       └── routes/
    │           ├── health.ts          # GET /health
    │           ├── generate.ts        # POST /api/v1/generate
    │           ├── guardian.ts        # POST /api/v1/guardian/ingest
    │           └── review.ts          # GET /api/v1/sessions/:id/review
    ├── mcp-server/                    # MCP Server (MongoDB Partner Track)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── .env.example               # Copy to .env and configure
    │   └── src/
    │       ├── server.ts              # StdioServerTransport MCP server
    │       ├── mongo-client.ts        # MongoDB native driver + MongoStore
    │       └── http-adapter.ts        # HTTP wrapper for Cloud Run sidecar
    └── frontend/                      # Flutter Review Panel
        ├── pubspec.yaml
        └── lib/
            ├── main.dart
            ├── app.dart
            ├── models/
            ├── providers/
            ├── screens/
            ├── services/
            ├── theme/
            └── widgets/
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 22
- **Google Cloud Project** with [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) enabled
- **Gemini API Key** → set as `GEMINI_API_KEY`
- **MongoDB Atlas** connection string → set as `MONGODB_URI`
- **Flutter SDK** ≥ 3.24 (for the review panel)

### 1. Install Dependencies

```bash
cd sandbox
npm install
```

### 2. Configure Environment

```bash
cp hono-api/.env.example hono-api/.env
cp mcp-server/.env.example mcp-server/.env
# Edit both .env files with your GEMINI_API_KEY and MONGODB_URI
```

### 3. Set Up MongoDB Indexes (Required for Performance)

**⚠️ Without these indexes, aggregation queries against large session datasets
will time out and cause the frontend to freeze.**

Connect to your MongoDB Atlas cluster via `mongosh` or Compass and run:

```javascript
// Switch to your database
use gorilla_agents;

// Index for session lookups by candidate
db.sessions.createIndex(
  { candidateId: 1 },
  { name: "idx_sessions_candidateId" }
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

### 4. Build & Run Locally

```bash
# Build TypeScript
npm run build -w sandbox/hono-api
npm run build -w sandbox/mcp-server

# Start both services concurrently
node start-services.js
```

- Hono API → `http://localhost:3000`
- MCP Server HTTP Adapter → `http://localhost:3001`

### 5. Run Flutter Review Panel

```bash
cd frontend
flutter pub get
flutter run -d chrome  # or your preferred platform
```

### 6. Deploy to Cloud Run

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated
```

> **⚠️ Cold Start Notice for Judges**: Cloud Run containers enter a suspended
> state after periods of inactivity. The first request after sleep triggers a
> cold start which may take **10–15 seconds** while the Hono API and MCP
> server initialize. The Flutter frontend will automatically retry and
> connect. Subsequent requests are served at full speed.

---

## 🔧 API Endpoints

### `POST /api/v1/generate` — Test Suite Generator (Agent Builder Webhook)

Accepts a single text prompt and returns a structured JSON test suite via the
Orchestrator Agent running on Gemini 3 Flash.

```json
// Request
{
  "prompt": "Generate a senior React developer assessment covering state management, hooks, and performance optimization for 45 minutes."
}

// Response: GeneratedTestSuite { metadata, roles, competencies, problems[], hiddenTestMatrices }
```

### `POST /api/v1/guardian/ingest` — Intent & Plagiarism Guardian

Streams micro-events to Gemini 3 Flash for real-time integrity analysis.

```json
// Request
{
  "sessionId": "sess-abc",
  "candidateId": "cand-xyz",
  "currentCode": "...",
  "event": { "type": "paste", "timestamp": "...", "payload": {} }
}

// Response: GuardianAnalysisResult { overallSuspicionScore, verdict, factors[] }
```

### `GET /api/v1/sessions/:sessionId/review` — Review Log

Returns the full session review with submitted code, timeline of micro-events,
and suspicion reports for the review panel.

### `GET /health` — Health Check

```json
{ "status": "ok", "timestamp": "2026-05-26T..." }
```

---

## 🗄️ MongoDB MCP Tools (MongoDB Partner Track)

The MCP HTTP adapter exposes **10 tools** via `POST /tools/:toolName`. Core data operations:

| Tool | Operation | Purpose |
|------|-----------|---------|
| `store_test_suite` | INSERT | Persist generated assessment suite |
| `create_session` | INSERT | Initialize candidate assessment session |
| `update_session_code` | UPDATE | Update submitted code workspace |
| `append_micro_event` | INSERT | Stream single micro-event to timeline |
| `ingest_micro_events` | INSERT MANY | Batch-ingest event array |
| `store_suspicion_report` | INSERT | Store Gemini suspicion analysis |
| `get_session_review` | AGGREGATE | Full review log (session + events + reports) |
| `get_candidate_report` | AGGREGATE | Full candidate evaluation data |
| `query_sessions` | FIND | Filter sessions by candidate/test |
| `health_check` | PING | MongoDB connectivity test |

All operations use the MongoDB Node.js native driver with Atlas connection pooling.

---

## 🔒 Security — API Key & Environment Handling

All API keys, project IDs, and connection strings are read **exclusively from
environment variables** via `process.env`. No hardcoded credentials exist in
any source file:

- `GEMINI_API_KEY` — Vertex AI Gemini 3 Flash authentication
- `MONGODB_URI` — MongoDB Atlas connection string
- `MCP_API_KEY` — Internal MCP server authentication

The `.env.example` files contain only placeholder dummy values. Ensure
`.env` is listed in `.gitignore` before committing:

```gitignore
# In .gitignore (already configured)
**/.env
```

**Verification**: Running `git log -p --all -- '*.env' | grep -i 'api.key\|GEMINI_API_KEY'`
should return zero results. The repository history contains no committed secrets.

---

## 🧠 Agent Design Philosophy

### Orchestrator Agent (Test Generation)

Transforms unstructured natural-language prompts into production-grade JSON:
- **Role definition** → concrete skill matrices
- **Competency mapping** → weighted sub-scores per area
- **Problem construction** → starter code + test harness + hidden edge-case tests
- **Hidden testing matrix** → anti-cheat measures baked into evaluation

### Intent Guardian Agent (Security)

Streaming micro-event processor:
1. **Paste Detection** — clipboard injection tracking
2. **Structural Code Shifts** — AST tree-edit distance between submissions
3. **Token Injection Analysis** — large-block insertions characteristic of AI paste
4. **Semantic Similarity** — Gemini embeddings vs canonical AI completions

---

## 📋 Hackathon Compliance Checklist

| Rule | Status | Evidence |
|------|--------|----------|
| **Originality Mandate** | ✅ PASS | 100% new code in `sandbox/`; no legacy Express/Flutter reused |
| **Legacy Code Ban** | ✅ PASS | Zero imports from external legacy codebases |
| **Repository Isolation Rule** | ✅ PASS | Fresh Git history — all original work within hackathon window (May 5 – June 11, 2026) |
| **Orchestration Platform** | ✅ PASS | Google Cloud Agent Builder for orchestration; Hono API as security/validation webhook runtime |
| **Gemini Model** | ✅ PASS | Exclusive use of `gemini-3-flash-preview` via Google Cloud Vertex AI native fetch |
| **Connectivity Rule (MCP)** | ✅ PASS | MongoDB track MCP server with 10 registered tools |
| **No Competing AI Platforms** | ✅ PASS | Zero OpenAI, Anthropic, AWS Bedrock, or external AI dependencies |
| **Google Native Routing** | ✅ PASS | All model calls use native `fetch()` to Vertex AI Gemini API (no third-party SDKs) |
| **Open Source License** | ✅ PASS | Apache 2.0 LICENSE file at repository root |
| **Production-grade** | ✅ PASS | Dockerfile, health checks, non-root user, Cloud Run ready |
| **MongoDB Indexes** | ✅ PASS | Documented `createIndex()` commands for all session/event/report collections |

---

## 🎨 Flutter Review Panel

- **Material 3** design with full **dark/light theme** support
- **Split-panel dashboard**: left = code workspace viewer, right = security metrics timeline
- **Provider** state management across health, generation, guardian, and review flows
- Reactive **suspicion gauge** with color-coded severity indicators
- SSE-powered live security event streaming

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

Built for the **Google Cloud Rapid Agent Hackathon 2026**