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
  - [Real-Time Risk Notification UI](#real-time-risk-notification-ui)
  - [Session Drawer Categorization & Refresh](#session-drawer-categorization--refresh)
  - [Close & Kill Session Controls](#close--kill-session-controls)
  - [Identity Setup](#identity-setup)
- [Input Validation & Resilience](#-input-validation--resilience)
- [Session Persistence & Post-Restart Recovery](#-session-persistence--post-restart-recovery)
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
    ├── security_metrics_panel.dart # Risk gauge + behavioral flag timeline
    └── risk_notification.dart     # Expandable risk banner + dialog (tabbed detail, paste snippets, behavioral context, keystroke metrics, animated gauge)
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

## 🛡️ Input Validation & Resilience

### Prompt Validation in GeneratePanel

The compliance matrix generation bottom sheet (`generate_panel.dart`) performs
client-side input validation before dispatching API requests:

- **Empty Prompt Guard**: If the audit prompt field is empty when the operator
  taps "Generate," an inline error message ("Audit prompt is required") is
  displayed directly below the text field with dedicated `errorBorder` and
  `focusedErrorBorder` styling using the Material 3 theme's `error` color.
- **Required Field Indicator**: The "Audit Prompt" label displays a red
  asterisk (`*`) suffix, clearly marking it as a mandatory field for
  operators.
- **Auto-Clearing Error**: The error text clears automatically as soon as the
  operator begins typing in the prompt field, providing a non-blocking UX
  that does not require a separate dismiss action.
- **Unchanged API-Level Guards**: The backend (`POST /api/v1/generate`)
  independently validates the `prompt` field and returns a structured 400
  error with `correlationId` if validation fails, ensuring defense-in-depth
  against both empty strings and non-object bodies.

### Target System Validation

A separate `_showErrorDialog` intercepts submissions where the target system
dropdown has not been selected, preventing the API from receiving `""` as
a system context value. This dialog must be explicitly dismissed before the
operator can retry.

---

## 🔄 Session Persistence & Post-Restart Recovery

The compliance dashboard maintains session state across server restarts and
Cloud Run cold starts through a client-side fallback chain in `ApiService`:

### Dual-Endpoint Fetch Strategy

`ApiService.fetchSessions()` uses a primary + fallback pattern for populating
the session drawer:

1. **Primary — `GET /api/v1/sessions`** (MongoDB-backed review endpoint):
   Queries the durable review endpoint with a 15-second timeout. This endpoint
   reads directly from MongoDB Atlas via the MCP sidecar, so data survives
   server restarts, Cloud Run scale-to-zero wake events, and container evictions.

2. **Fallback — `GET /api/v1/guardian/sessions`** (in-memory registry):
   If the review endpoint returns empty data or times out (e.g., MCP sidecar
   unreachable, MongoDB connectivity issues), the client automatically calls
   the Guardian's hybrid session endpoint. This endpoint first checks the
   in-memory `activeSessions` Map, and if empty, falls through to the MCP
   `list_sessions` MongoDB query — ensuring sessions are visible even when
   only the Hono API is reachable.

### Drawer UX Enhancement

The session drawer (`dashboard_screen.dart`) now displays:

- **Primary label**: `employeeId` (bold, `FontWeight.w600`) — the employee UID
  is shown as the main list item title, making it immediately clear which
  employee each session belongs to
- **Subtitle**: Session ID + event count + status (e.g., "active", "flagged")
  on two lines with `maxLines: 2` and `TextOverflow.ellipsis`

This replaces the previous behavior where `sessionId` was the primary label
and only the event count was shown as a single-line subtitle.

### Resilience Guarantees

- The dashboard drawer populates correctly after a server restart — sessions
  deploy one minute ago are still visible
- If MongoDB is unreachable but in-memory sessions exist, the fallback
  endpoint ensures the drawer is not empty
- `try/catch` on the primary fetch prevents network errors from crashing the
  drawer — the method silently falls through to the backup endpoint
- 15-second timeout prevents the UI from hanging on slow MongoDB queries

---

## 🔔 Real-Time Risk Notification UI

The compliance dashboard features a full risk notification system that surfaces
insider threat incidents in real-time, implemented in `risk_notification.dart`:

- **Integrated Risk Notification Banner**: A dismissible banner is embedded
  directly within `SecurityMetricsPanel`, appearing when `alertTriggered` is
  `true` or the `anomalyRiskIndex` reaches ≥ 45. Tap the permanent **DETAILS**
  `ElevatedButton.icon` to expand into the full incident dialog.
- **Expandable Incident Dialog**: Tabbed detail view with **Flags** and
  **Incident** tabs, collapsible paste snippet sections, code snapshot viewer,
  behavioral context grid, keystroke metrics display, and dimension score bars
  with color-coded severity levels.
- **Copy Report**: One-tap copy of the full risk assessment report to clipboard
  for compliance audit trails.
- **Animated Risk Gauge**: A custom animated gauge widget renders the composite
  risk score (0–100) with smooth interpolation and color transitions from green
  (safe) → yellow (elevated) → red (critical).
- **Full Incident Persistence**: Incidents survive browser refresh, process
  restart, and Cloud Run cold starts through MCP `store_suspicion_report` to
  MongoDB Atlas and post-restart rehydration via `GET /api/v1/sessions/:id`.
- **Auto-Surface on Alert**: `GuardianProvider` automatically surfaces the
  notification banner when `alertTriggered` flips `true` or the risk score
  crosses the configurable threshold.

---

## 📂 Session Drawer Categorization & Refresh

The session drawer (`dashboard_screen.dart`) organizes sessions into
collapsible category groups for efficient navigation in high-volume
compliance environments:

### Session Categories

Sessions are automatically sorted by lifecycle state:

| Category | Statuses | Indicator |
|----------|----------|-----------|
| **Active Sessions** | `active`, `in_progress` | Green dot |
| **Flagged Sessions** | `flagged` | Amber warning |
| **Under Investigation** | `investigating` | Blue info |
| **Closed Sessions** | `closed`, `cleared` | Grey neutral |

Each category group displays a count badge and can be independently expanded
or collapsed by the operator, reducing visual clutter.

### Drawer Refresh Button

A dedicated **refresh** `IconButton` in the drawer header triggers a full
re-fetch of session data through the dual-endpoint fallback chain:

1. Primary: `GET /api/v1/sessions` (MongoDB-backed, 15s timeout)
2. Fallback: `GET /api/v1/guardian/sessions` (in-memory registry)

An `isLoading` spinner in `ReviewProvider` provides visual feedback during
the refresh, and the drawer UI rebuilds reactively when new data arrives.

---

## 🛑 Close & Kill Session Controls

The dashboard provides two distinct session lifecycle controls accessible
from the session drawer and the code workspace toolbar:

### Close Session

Gracefully terminates an active monitoring session via
`POST /api/v1/guardian/sessions/:id/close`:
- Sets session status to `"closed"` in-memory and persists to MongoDB Atlas
- Preserves all historical data (events, suspicion reports, risk payloads)
- Session moves to the **Closed Sessions** category in the drawer

### Terminate Session

Permanently removes a session via `POST /api/v1/guardian/sessions/:id/terminate`:
- Removes the session from the in-memory registry
- **Irreversibly deletes** the session document and all associated micro-events
  from MongoDB Atlas
- A confirmation dialog with a warning appears before dispatch

### UI Integration

- **Close button** (grey, `close` icon) — visible on each session tile for
  sessions in `active` or `in_progress` status
- **Terminate button** (red, `delete_forever` icon) — shown on long-press or
  when expanding the tile's action menu
- **Code workspace overflow menu** (`code_workspace_panel.dart`) also exposes
  close and terminate actions for the currently monitored session

---

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
- `POST /api/v1/guardian/sessions/:id/close` — Gracefully close an active session
- `POST /api/v1/guardian/sessions/:id/terminate` — Irreversibly delete a session
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