# 🦍 Cerberus AI — Multi-Agent Assessment Ecosystem

**Google Cloud Rapid Agent Hackathon 2026** — *MongoDB Partner Track*

Cerberus AI replaces legacy manual assessment platforms with a fully autonomous,
Google Cloud-native multi-agent evaluation engine. Built with **Hono**,
**TypeScript**, **Gemini 2.5 Flash**, and **Model Context Protocol (MCP)** for
the MongoDB track.

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
│  │ POST /generate  │ │ POST /guardian   │ │ GET /sessions/:id      │   │
│  │  Test Suite Gen │ │  /ingest         │ │      /review           │   │
│  └───────┬─────────┘ └───────┬──────────┘ └───────────┬────────────┘   │
│          │                   │                        │                │
│          ▼                   ▼                        ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                   GEMINI AGENT PIPELINE                           │  │
│  │  ┌────────────────────┐  ┌──────────────────────────────────┐    │  │
│  │  │ Orchestrator Agent  │  │ Intent Guardian Agent            │    │  │
│  │  │ (gemini-2.5-flash)  │  │ (gemini-2.5-flash reasoning)     │    │  │
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
├── LICENSE                          # Apache 2.0 (OSI-approved)
├── package.json                     # Root npm workspace config
└── sandbox/
    ├── README.md                    # ← THIS FILE
    ├── Dockerfile                   # Cloud Run production container
    ├── hono-api/                    # Hono TypeScript API (Cloud Run)
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts             # Entry point, Hono app bootstrap
    │       ├── config.ts            # Environment config loader
    │       ├── types.ts             # Shared TypeScript contracts
    │       ├── agents/
    │       │   └── gemini-client.ts # Native fetch Gemini 2.5 Flash client
    │       └── routes/
    │           ├── health.ts        # GET /health
    │           ├── generate.ts      # POST /api/v1/generate
    │           ├── guardian.ts      # POST /api/v1/guardian/ingest
    │           └── review.ts        # GET /api/v1/sessions/:id/review
    ├── mcp-server/                  # MCP Server (MongoDB Partner Track)
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── server.ts            # MCP server bootstrap + tool registration
    │       └── mongo-client.ts      # MongoDB native driver wrapper
    └── flutter-review-panel/        # Flutter Frontend
        └── lib/
            ├── review_panel.dart    # Main split-panel layout widget
            ├── models/
            │   └── review_models.dart
            ├── services/
            │   └── review_service.dart
            └── widgets/
                ├── code_viewer.dart
                ├── security_timeline.dart
                ├── suspicion_gauge.dart
                └── behavioral_flags_list.dart
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

### `GET /api/v1/sessions/:sessionId/review` — Review Log

Returns the full session review including submitted code, timeline, and
suspicion reports.

### `GET /health` — Health Check

Returns `{ "status": "ok", "timestamp": "..." }`

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
| **Orchestration Platform** | ✅ PASS | Exclusive use of Google Cloud Agent Builder + Gemini 2.5 Flash |
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

- **Repository**: [github.com/Bilal-Lodhi/testgorilla-clone](https://github.com/Bilal-Lodhi/testgorilla-clone)
  (subdirectory: `Google-Cloud-Hackathon/sandbox/`)
- **Demo Video**: Provided in the `Google-Cloud-Hackathon/video/` directory
- **Live App**: Deployed via Google Cloud Run (URL provided in submission)

---

Built with ❤️ for the Google Cloud Rapid Agent Hackathon 2026.