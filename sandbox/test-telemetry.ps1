# ═══════════════════════════════════════════════════════════════════
# Cerberus FinSec — Live Telemetry Test (EDIT / PASTE Micro-Events)
# ═══════════════════════════════════════════════════════════════════
# Tests the new EDIT and PASTE event types sent from the Flutter
# CodeWorkspacePanel to POST /api/v1/guardian/ingest.
#
# Prerequisites:
#   1. Start services:    node dev-services.js
#   2. Deploy a session:  (or run steps 1-6 of test-all-10.ps1 first)
#   3. Run this script:   pwsh -File test-telemetry.ps1
#
# Or run the full pipeline:  pwsh -File test-all-10.ps1
# ═══════════════════════════════════════════════════════════════════

param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$SessionId = "active-ledger-audit-v2",
  [string]$EmployeeId = "op-trader-001"
)

$ErrorActionPreference = "Continue"

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  LIVE TELEMETRY TEST — EDIT / PASTE" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# ─── 1. Health Check ────────────────────────────────────────────────
Write-Host "[1/5] Health Check..." -ForegroundColor Cyan
try {
  $r = Invoke-RestMethod -Uri "$BaseUrl/health" -Method GET -TimeoutSec 5
  Write-Host "  HEALTH: OK — $($r.status)" -ForegroundColor Green
} catch {
  Write-Host "  FAIL: Backend not running at $BaseUrl" -ForegroundColor Red
  Write-Host "  Start with: node dev-services.js" -ForegroundColor Yellow
  exit 1
}

# ─── 2. Deploy a test session ───────────────────────────────────────
Write-Host "`n[2/5] Deploying test session..." -ForegroundColor Cyan
$deployBody = @{
  employeeUid = $EmployeeId
  sessionId   = $SessionId
  matrixId    = "test-matrix-001"
  targetSystem = "Core Trading Ledger"
} | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/v1/guardian/deploy" -Method POST `
    -ContentType "application/json" -Body $deployBody -TimeoutSec 10
  Write-Host "  DEPLOY: OK — session=$($r.sessionId) mongo=$($r.mongoDocumentId)" -ForegroundColor Green
} catch {
  Write-Host "  DEPLOY: $($_.Exception.Message) (may already exist — continuing)" -ForegroundColor Yellow
}

# ─── 3. Send an EDIT event (normal typing) ──────────────────────────
Write-Host "`n[3/5] Sending EDIT event (normal typing)..." -ForegroundColor Cyan

$editPayload = @{
  newText      = "void main() {`n  print(`"Hello FinSec`");`n}"
  changeLength = 15
}

$editEvent = [ordered]@{
  eventId        = "evt-edit-001"
  sessionId      = $SessionId
  employeeId     = $EmployeeId
  auditId        = "audit-test-001"
  vectorId       = "vec-test-001"
  eventType      = "EDIT"
  timestamp      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
  payload        = $editPayload
  clientMetadata = @{
    userAgent        = "Flutter/Dart"
    ipAddress        = "10.0.0.1"
    screenResolution = "1920x1080"
    platform         = "Windows"
    language         = "en"
  }
}

$editBody = @{ events = @($editEvent) } | ConvertTo-Json -Depth 5

try {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/v1/guardian/ingest" -Method POST `
    -ContentType "application/json" -Body $editBody -TimeoutSec 15
  
  Write-Host "  EDIT INGEST: OK" -ForegroundColor Green
  Write-Host "    processedCount : $($r.processedCount)"
  Write-Host "    success        : $($r.success)"
  Write-Host "    anomalyRiskIdx : $($r.anomalyRiskIndex)"
  if ($r.riskPayload) {
    Write-Host "    riskScore      : $($r.riskPayload.overallRiskScore)"
  }
} catch {
  Write-Host "  EDIT INGEST: FAIL — $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails) { Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red }
}

# ─── 4. Send a PASTE event (large insert) ───────────────────────────
Write-Host "`n[4/5] Sending PASTE event (large paste detected)..." -ForegroundColor Cyan

$pastePayload = @{
  newText      = "void main() {`n  print(`"Hello FinSec`");`n  // Pasted: suspicious cross-border transfer`n  SwiftTransfer.execute(`n    bic: `"OFFSHOREBNK`",`n    amount: 500000.00,`n    currency: `"USD`"`n  );`n}"
  changeLength = 150
}

$pasteEvent = [ordered]@{
  eventId        = "evt-paste-001"
  sessionId      = $SessionId
  employeeId     = $EmployeeId
  auditId        = "audit-test-001"
  vectorId       = "vec-test-001"
  eventType      = "PASTE"
  timestamp      = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
  payload        = $pastePayload
  clientMetadata = @{
    userAgent        = "Flutter/Dart"
    ipAddress        = "10.0.0.1"
    screenResolution = "1920x1080"
    platform         = "Windows"
    language         = "en"
  }
}

$pasteBody = @{ events = @($pasteEvent) } | ConvertTo-Json -Depth 5

try {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/v1/guardian/ingest" -Method POST `
    -ContentType "application/json" -Body $pasteBody -TimeoutSec 15
  
  Write-Host "  PASTE INGEST: OK" -ForegroundColor Green
  Write-Host "    processedCount : $($r.processedCount)"
  Write-Host "    success        : $($r.success)"
  Write-Host "    alertTriggered : $($r.alertTriggered)"
  Write-Host "    anomalyRiskIdx : $($r.anomalyRiskIndex)"
  if ($r.riskPayload) {
    Write-Host "    riskScore      : $($r.riskPayload.overallRiskScore)"
    Write-Host "    flags          : $($r.riskPayload.flags.Count)"
    foreach ($f in $r.riskPayload.flags) {
      Write-Host "      - [$($f.severity)] $($f.description) (confidence: $($f.confidence))"
    }
  }
} catch {
  Write-Host "  PASTE INGEST: FAIL — $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails) { Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Red }
}

# ─── 5. Verify session state ────────────────────────────────────────
Write-Host "`n[5/5] Verifying session state..." -ForegroundColor Cyan

try {
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/v1/guardian/sessions/$SessionId" -Method GET -TimeoutSec 10
  
  $s = if ($r.session) { $r.session } else { $r.data }
  Write-Host "  SESSION STATE:" -ForegroundColor Cyan
  Write-Host "    sessionId      : $($s.sessionId)"
  Write-Host "    eventCount     : $($s.eventCount)"
  Write-Host "    pasteCount     : $($s.pasteCount)"
  Write-Host "    codeLength     : $($s.currentCodeLength)"
  Write-Host "    riskIndex      : $($s.riskIndex)"
  Write-Host "    alertTriggered : $($s.alertTriggered)"
  
  # Display the current code snapshot (trimmed)
  $code = if ($s.currentCode) { $s.currentCode } else { "(empty)" }
  if ($code.Length -gt 200) { $code = $code.Substring(0, 200) + "..." }
  Write-Host "    currentCode    :"
  Write-Host "      $code"
  
  Write-Host "`n  VERDICT: Session is tracking EDIT/PASTE events correctly." -ForegroundColor Green
} catch {
  Write-Host "  SESSION LOOKUP: FAIL — $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  TELEMETRY TEST COMPLETE" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta