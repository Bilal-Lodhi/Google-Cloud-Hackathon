import 'dart:async';
import 'package:flutter/widgets.dart';
import '../models/guardian_model.dart';
import '../services/api_service.dart';
import '../widgets/risk_notification.dart';

/// ─── Cerberus FinSec — Guardian Provider ─────────────────────────────────────
/// Manages the SSE stream of risk assessment payloads from the Real-Time
/// Insider Threat & Data Exfiltration Guardian. Accumulates events into
/// a session timeline and exposes the latest aggregated anomaly risk index.

class GuardianProvider extends ChangeNotifier {
  final ApiService _api;

  final List<RiskAssessmentPayload> _events = [];
  StreamSubscription<RiskAssessmentPayload>? _subscription;
  String? _error;
  bool _isStreaming = false;

  /// The most recent risk payload shown to the user via the notification banner.
  /// Once the user dismisses it, this is set back to null until the next detection.
  RiskAssessmentPayload? _latestRiskPayload;
  bool _notificationDismissed = false;

  GuardianProvider(this._api);

  List<RiskAssessmentPayload> get events => List.unmodifiable(_events);
  String? get error => _error;
  bool get isStreaming => _isStreaming;

  /// Latest undismissed risk notification for the banner overlay.
  RiskAssessmentPayload? get latestRiskPayload =>
      _notificationDismissed ? null : _latestRiskPayload;

  double get latestRiskScore {
    if (_events.isEmpty) return 0.0;
    return _events.last.overallRiskScore;
  }

  int get criticalCount =>
      _events.where((e) => e.flags.any((f) => f.category == 'critical')).length;
  int get elevatedCount =>
      _events.where((e) => e.flags.any((f) => f.category == 'elevated')).length;

  void startStreaming(String sessionId) {
    if (_isStreaming) return;

    _isStreaming = true;
    _error = null;
    _events.clear();
    notifyListeners();

    _subscription = _api
        .streamAuditEvents(sessionId)
        .listen(
          (payload) {
            _events.add(payload);
            notifyListeners();
          },
          onError: (err) {
            _error = 'Guardian stream error: $err';
            _isStreaming = false;
            notifyListeners();
          },
          onDone: () {
            _isStreaming = false;
            notifyListeners();
          },
          cancelOnError: true,
        );
  }

  void stopStreaming() {
    _subscription?.cancel();
    _subscription = null;
    _isStreaming = false;
    notifyListeners();
  }

  /// Submits employee terminal behavioral telemetry events for server-side
  /// analysis. Returns the full ingestion response with anomaly scoring.
  /// Pushes the response's riskPayload into the live events stream and surfaces
  /// it as the latest notification banner payload if an alert was triggered.
  Future<IngestMicroEventResponse> ingestEvents(List<MicroEvent> events) async {
    final result = await _api.ingestMicroEvents(events);
    if (result.riskPayload != null) {
      _events.add(result.riskPayload!);

      // Surface notification only for elevated/critical alerts (score ≥ 45)
      if (result.alertTriggered || result.riskPayload!.overallRiskScore >= 45) {
        _latestRiskPayload = result.riskPayload;
        _notificationDismissed = false;
      }
      notifyListeners();
    }
    return result;
  }

  /// Dismisses the current risk notification banner. It will only re-appear
  /// when a new risk detection event arrives.
  void dismissNotification() {
    _notificationDismissed = true;
    notifyListeners();
  }

  /// Opens the current notification as the full expandable dialog.
  void openLatestNotification(BuildContext context) {
    if (_latestRiskPayload != null) {
      showRiskNotificationDialog(context, _latestRiskPayload!);
    }
  }

  /// Terminates (kills) a session on the backend, removing it from
  /// in-memory registries and marking it as terminated in MongoDB.
  Future<void> terminateSession(String sessionId) async {
    await _api.terminateSession(sessionId);
  }

  /// Deploys a guardrail matrix to a live employee terminal session.
  Future<AuditSession> deployGuardrail({
    required String employeeId,
    required String sessionId,
    required String matrixId,
    String? targetSystem,
  }) {
    return _api.deployGuardrail(
      employeeId: employeeId,
      sessionId: sessionId,
      matrixId: matrixId,
      targetSystem: targetSystem,
    );
  }

  @override
  void dispose() {
    stopStreaming();
    super.dispose();
  }
}
