# 🦍 Cerberus AI — Multi-Agent Assessment Ecosystem

**Google Cloud Rapid Agent Hackathon 2026** — *MongoDB Partner Track*

Cerberus AI is a fully autonomous, Google Cloud-native multi-agent evaluation engine that replaces manual assessment platforms with AI-driven test generation, real-time plagiarism detection, and interactive analytical review panels.

Built with **Hono** · **TypeScript** · **Gemini 2.5 Flash** · **Model Context Protocol (MCP)** · **Flutter**

---

## 🎯 Three Core Agents

| # | Agent | Capability | Technology |
|---|-------|-----------|------------|
| 1 | **Autonomous Test Suite Generator** | Converts a single text prompt into a structured JSON assessment with metadata, competency matrices, coding problems, and hidden anti-cheat test cases | Hono + Gemini 2.5 Flash Orchestrator |
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
│  └───────┬──────────┘ └───────┬──────────┘ └──────────┬──────────┘  │
│          │                    │                        │             │
│          ▼                    ▼                        ▼             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   GEMINI AGENT PIPELINE                        │  │
│  │  • Orchestrator Agent — prompt → test suite JSON contract     │  │
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
.
├── .github/
│   └── HACKATHON_RULES.md          # Official compliance directive
├── .gitignore                       # Blocks **/.env, *.md (whitelist only)
├── LICENSE                          # Apache 2.0 (OSI-approved)
├── README.md                        # ← THIS FILE
└── sandbox/
    ├── package.json                 # npm workspace: hono-api + mcp-server
    ├── Dockerfile                   # Multi-stage Cloud Run container
    ├── entrypoint.sh                # Concurrent Hono + MCP launcher
    ├── start-services.js            # Node.js dev process manager
    ├── hono-api/                    # Hono TypeScript API (port 3000)
    │   ├── src/
    │   │   ├── index.ts             # Entry point & app bootstrap
    │   │   ├── config.ts            # Environment loader
    │   │   ├── types.ts             # Shared TypeScript contracts
    │   │   ├── agents/
    │   │   │   └── gemini-client.ts # Native fetch Gemini 2.5 Flash
    │   │   └── routes/
    │   │       ├── health.ts        # GET /health
    │   │       ├── generate.ts      # POST /api/v1/generate
    │   │       ├── guardian.ts      # POST /api/v1/guardian/ingest
    │   │       └── review.ts        # GET /api/v1/sessions/:id/review
    │   └── .env.example
    ├── mcp-server/                  # MCP Server (MongoDB Track, port 3001)
    │   ├── src/
    │   │   ├── server.ts            # StdioServerTransport
    │   │   ├── mongo-client.ts      # MongoDB native driver + MongoStore
    │   │   └── http-adapter.ts      # HTTP wrapper for Cloud Run sidecar
    │   └── .env.example
    └── frontend/                    # Flutter Review Panel
        ├── pubspec.yaml
        └── lib/
            ├── main.dart
            ├── app.dart
            ├── models/
            ├── providers/
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

### 3. Build & Run Locally

```bash
# Build TypeScript
npm run build -w sandbox/hono-api
npm run build -w sandbox/mcp-server

# Start both services concurrently
node start-services.js
```

- Hono API → `http://localhost:3000`
- MCP Server HTTP Adapter → `http://localhost:3001`

### 4. Run Flutter Review Panel

```bash
cd frontend
flutter pub get
flutter run -d chrome  # or your preferred platform
```

### 5. Deploy to Cloud Run

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy cerberus-api --image=gcr.io/$PROJECT_ID/cerberus-api \
  --platform=managed --region=us-central1 --allow-unauthenticated
```

---

## 🔧 API Endpoints

### `POST /api/v1/generate` — Test Suite Generator

Accepts a single text prompt and returns a structured JSON test suite via the Orchestrator Agent.

```json
// Request
{ "prompt": "Generate a senior React developer assessment covering state management, hooks, and performance optimization for 45 minutes." }

// Response: GeneratedTestSuite { metadata, roles, competencies, problems[], hiddenTestMatrices }
```

### `POST /api/v1/guardian/ingest` — Intent & Plagiarism Guardian

Streams micro-events to Gemini for real-time integrity analysis.

```json
// Request
{ "sessionId": "sess-abc", "candidateId": "cand-xyz", "currentCode": "...", "event": { "type": "paste", "timestamp": "...", "payload": {} } }

// Response: GuardianAnalysisResult { overallSuspicionScore, verdict, factors[] }
```

### `GET /api/v1/sessions/:sessionId/review` — Review Log

Returns the full session review with submitted code, timeline of micro-events, and suspicion reports.

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

## 📋 Hackathon Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| **Originality Mandate** | ✅ PASS | 100% new code in `sandbox/`; no legacy Express/Flutter reused |
| **Legacy Code Ban** | ✅ PASS | Zero imports from external legacy codebases |
| **Repository Isolation Rule** | ✅ PASS | Fresh structure — all original work within hackathon window |
| **Orchestration Platform** | ✅ PASS | Exclusive Google Cloud Agent Builder + Gemini 2.5 Flash |
| **Connectivity Rule (MCP)** | ✅ PASS | MongoDB track MCP server with 10 registered tools |
| **No Competing AI Platforms** | ✅ PASS | Zero OpenAI, Anthropic, or AWS Bedrock dependencies |
| **Google Native Routing** | ✅ PASS | All model calls use native `fetch()` to Vertex AI Gemini API |
| **Open Source License** | ✅ PASS | Apache 2.0 LICENSE at repo root |
| **Production-grade** | ✅ PASS | Dockerfile, health checks, non-root user, Cloud Run ready |

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

## 🎨 Flutter Review Panel

- **Material 3** design with full **dark/light theme** support (`app_theme.dart` + `theme_provider.dart`)
- **Split-panel dashboard**: left = code workspace viewer, right = security metrics timeline
- **Provider** state management across health, generation, guardian, and review flows
- Reactive **suspicion gauge** with color-coded severity indicators
- SSE-powered live security event streaming

---

## 📄 License

Apache 2.0 — See [LICENSE](LICENSE) for full text.

---

## 🎥 Submission Assets

- **Repository**: [https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon](https://github.com/Bilal-Lodhi/Google-Cloud-Hackathon)
- **Demo Video**: Provided in the submission deliverables
- **Live App**: Deployed via Google Cloud Run

---

Built for the **Google Cloud Rapid Agent Hackathon 2026**