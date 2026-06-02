Write-Host '=== 1/10: GET /health ===' -ForegroundColor Cyan
$r = curl -UseBasicParsing -Uri 'http://localhost:8080/health' 2>&1
Write-Host $r.Content
Write-Host "STATUS: $($r.StatusCode)"
Write-Host ''

Write-Host '=== 2/10: POST /api/v1/identity/set ===' -ForegroundColor Cyan
$body = '{"displayName":"Alice Chen","employeeId":"op-trader-001","role":"Senior Quant Trader"}'
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/identity/set' 2>&1
Write-Host $r.Content
$token = ($r.Content | ConvertFrom-Json).sessionToken
Write-Host "Token: $token"
Write-Host ''

Write-Host '=== 3/10: GET /api/v1/identity/me ===' -ForegroundColor Cyan
$r = curl -Method GET -Headers @{'X-Session-Token'=$token} -UseBasicParsing -Uri 'http://localhost:8080/api/v1/identity/me' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 4/10: POST /api/v1/generate ===' -ForegroundColor Cyan
$body = '{"prompt":"Generate a compliance audit for cross-border SWIFT transfer monitoring covering AML and KYC mandates","roleContext":"swift-gateway","problemCount":5,"difficultyMix":{"beginner":0.33,"intermediate":0.34,"advanced":0.33}}'
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/generate' 2>&1
Write-Host $r.Content
$matrixJson = $r.Content | ConvertFrom-Json
$matrixId = $matrixJson.matrix.metadata.matrixId
Write-Host "matrixId: $matrixId"
$genRequestId = $matrixJson.generationRequestId
Write-Host "generationRequestId: $genRequestId"
Write-Host ''

Write-Host '=== 5/10: POST /api/v1/generate/cancel (valid genRequestId but already completed) ===' -ForegroundColor Cyan
$body = "{`"generationRequestId`":`"$genRequestId`"}"
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/generate/cancel' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 6/10: POST /api/v1/guardian/deploy (valid matrixId) ===' -ForegroundColor Cyan
$body = "{`"employeeId`":`"op-trader-001`",`"sessionId`":`"active-ledger-audit-v2`",`"matrixId`":`"$matrixId`",`"targetSystem`":`"Core Trading Ledger`"}"
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/guardian/deploy' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 7/10: POST /api/v1/guardian/ingest (PASTE_TRIGGER + TAB_SWITCH) ===' -ForegroundColor Cyan
$body = '{"events":[{"eventId":"evt-001","sessionId":"active-ledger-audit-v2","employeeId":"op-trader-001","auditId":"audit-001","vectorId":"vec-001","eventType":"PASTE_TRIGGER","timestamp":"2026-06-01T15:00:00.000Z","payload":{"pasteContent":"function exploitLedger() { transferFunds(offshore); }"},"clientMetadata":{"userAgent":"Mozilla/5.0","ipAddress":"10.0.0.1","screenResolution":"1920x1080","platform":"Windows","language":"en"}},{"eventId":"evt-002","sessionId":"active-ledger-audit-v2","employeeId":"op-trader-001","auditId":"audit-001","vectorId":"vec-001","eventType":"TAB_SWITCH","timestamp":"2026-06-01T15:00:05.000Z","payload":{"visibilityState":"hidden"},"clientMetadata":{"userAgent":"Mozilla/5.0","ipAddress":"10.0.0.1","screenResolution":"1920x1080","platform":"Windows","language":"en"}}]}'
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/guardian/ingest' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 7b/10: POST /api/v1/guardian/ingest (EDIT + PASTE with newText/changeLength) ===' -ForegroundColor Cyan
$body = '{"events":[{"eventId":"evt-edit-001","sessionId":"active-ledger-audit-v2","employeeId":"op-trader-001","auditId":"audit-001","vectorId":"vec-001","eventType":"EDIT","timestamp":"2026-06-02T09:30:00.000Z","payload":{"newText":"void main() {\n  print(\"hello\");\n}","changeLength":15},"clientMetadata":{"userAgent":"Flutter/Dart","ipAddress":"10.0.0.1","screenResolution":"1920x1080","platform":"Windows","language":"en"}},{"eventId":"evt-paste-001","sessionId":"active-ledger-audit-v2","employeeId":"op-trader-001","auditId":"audit-001","vectorId":"vec-001","eventType":"PASTE","timestamp":"2026-06-02T09:30:05.000Z","payload":{"newText":"void main() {\n  print(\"hello world\");\n  // pasted malicious snippet\n  transferToOffshore();\n}","changeLength":65},"clientMetadata":{"userAgent":"Flutter/Dart","ipAddress":"10.0.0.1","screenResolution":"1920x1080","platform":"Windows","language":"en"}}]}'
$r = curl -Method POST -ContentType 'application/json' -UseBasicParsing -Body $body -Uri 'http://localhost:8080/api/v1/guardian/ingest' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 8/10: GET /api/v1/guardian/sessions/:sessionId ===' -ForegroundColor Cyan
$r = curl -UseBasicParsing -Uri 'http://localhost:8080/api/v1/guardian/sessions/active-ledger-audit-v2' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 9/10: GET /api/v1/sessions ===' -ForegroundColor Cyan
$r = curl -UseBasicParsing -Uri 'http://localhost:8080/api/v1/sessions' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== 10/10: GET /api/v1/sessions/:sessionId ===' -ForegroundColor Cyan
$r = curl -UseBasicParsing -Uri 'http://localhost:8080/api/v1/sessions/active-ledger-audit-v2' 2>&1
Write-Host $r.Content
Write-Host ''

Write-Host '=== ALL 10 TESTS COMPLETE ===' -ForegroundColor Green