# 🔒 Cerberus FinSec — Compliance Dashboard

Flutter-based analytical compliance dashboard for the Cerberus FinSec insider threat
& data exfiltration guardian platform. Part of the **Google Cloud Financial Services
Track** — Rapid Agent Hackathon 2026.

---

## Table of Contents

- [Purpose](#-purpose)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Run the Dashboard](#run-the-dashboard)
- [Key Features](#-key-features)
  - [Compliance Matrix Generation](#compliance-matrix-generation)
  - [Live Insider Threat Monitoring](#live-insider-threat-monitoring)
  - [Identity Setup](#identity-setup)
- [State Management](#-state-management)
- [API Integration](#-api-integration)

---

## 🎯 Purpose

The Flutter frontend serves as the **compliance operator's control panel** for
monitoring live employee sessions, generating compliance matrices, reviewing risk
assessment reports, and visualizing behavioral anomaly timelines in real-time.

## 🏗 Architecture

```
lib/
├── main.dart                    # App entry point, Provider setup
├── app.dart                     # MaterialApp + routing configuration
├── models/                      # Data classes (fromJson/toJson)
│   ├── health_model.dart
│   ├── generate_model.dart      # ComplianceMatrix, MatrixMetadata, ThreatVector
│   ├── guardian_model.dart      # MicroEvent, RiskAssessmentPayload, RiskFlag
│   └── identity_model.dart      # IdentityPayload, IdentityResponse
├── providers/                   # ChangeNotifier state management
│   ├── health_provider.dart
│   ├── generate_provider.dart   # Matrix generation + cancel/resume
│   ├── guardian_provider.dart   # Micro-event ingestion + risk streaming
│   ├── review_provider.dart     # Session review aggregation
│   ├── theme_provider.dart
│   └── identity_provider.dart   # Employee identity + department
├── screens/
│   ├── dashboard_screen.dart    # Main compliance monitoring hub
│   └── identity_setup_screen.dart # Employee registration form
├── services/
│   └── api_service.dart         # HTTP client (Hono API + MCP adapter)
├── theme/
│   └── app_theme.dart           # Cerberus FinSec branding & dark theme
└── widgets/
    ├── generate_panel.dart       # ComplianceMatrix bottom sheet + deploy dialog
    ├── code_workspace_panel.dart # Live terminal workspace monitor
    └── security_metrics_panel.dart # Risk gauge + behavioral flag timeline
```

## 🚀 Getting Started

### Prerequisites

- **Flutter SDK** ≥ 3.24
- **Running Hono API** on `http://localhost:8080` (or configured backend URL)
- **Running MCP Server** on `http://localhost:3001`

### Run the Dashboard

```bash
cd sandbox/frontend
flutter pub get
flutter run -d chrome  # Or use your preferred device
```

The dashboard connects to the Hono API backend. Configure the API base URL in
`lib/services/api_service.dart` if not running on `localhost:8080`.

## 🔧 Key Features

### Compliance Matrix Generation
The `generate_panel.dart` widget provides a bottom sheet (`ComplianceSheet`) for:
- Configuring compliance domain, target system, and threat vector count
- Real-time generation progress with cancel/resume support
- Post-generation deploy dialog to activate an `ActiveSession`

### Live Insider Threat Monitoring
The `security_metrics_panel.dart` widget displays:
- Color-coded risk severity gauge (low → critical)
- Real-time behavioral anomaly timeline
- Expandable risk flag cards with confidence scores

### Identity Setup
The `identity_setup_screen.dart` allows operators to register employee personas with:
- Display name, employee ID, and role
- Automatic session token attachment via `X-Session-Token` header

## 📦 State Management

Uses **Provider** (`ChangeNotifier`) for reactive state management:
- `GenerateProvider` — matrix generation lifecycle (loading, result, error, cancelled)
- `GuardianProvider` — real-time micro-event stream processing
- `ReviewProvider` — aggregated session review data
- `IdentityProvider` — employee identity registration and persistence
- `ThemeProvider` — dark/light mode toggle
- `HealthProvider` — backend connectivity status

## 🔗 API Integration

All HTTP calls route through `ApiService` (`lib/services/api_service.dart`):
- `POST /api/v1/generate` — Compliance matrix generation
- `POST /api/v1/generate/cancel` — Cancel in-flight generation
- `POST /api/v1/guardian/ingest` — Micro-event telemetry ingestion (batched events)
- `POST /api/v1/guardian/deploy` — Deploy active monitoring session
- `GET /api/v1/guardian/sessions/:id` — Live session risk state
- `GET /api/v1/sessions` — List all sessions
- `GET /api/v1/sessions/:id` — Fetch session audit review
- `POST /api/v1/identity/set` — Register employee identity
- `GET /api/v1/identity/me` — Get current identity

Each request includes `X-Generation-Request-Id` (UUID v4) for correlation
and `X-Session-Token` for identity context.

Ingest payloads use batched `MicroEvent[]` with valid `eventType` values:
`KEYSTROKE`, `PASTE_TRIGGER`, `CODE_DELTA`, `TAB_SWITCH`, `WINDOW_BLUR`,
`COPY_ATTEMPT`, `DEVELOPER_TOOLS_OPEN`, `FULLSCREEN_EXIT`, `EXTERNAL_APP_SWITCH`,
`SUBMIT`, `EDIT`, `PASTE`.

---

Built with Flutter + Dart for the Cerberus FinSec platform.