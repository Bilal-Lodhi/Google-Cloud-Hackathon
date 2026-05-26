/**
 * Analytical Review Models — Dart Data Contracts
 * Mirrors the TypeScript types from honored-api/src/types.ts
 * for the Flutter review panel UI layer.
 */

/// Full session review payload from GET /api/v1/sessions/:id/review
class SessionReviewResponse {
  final String sessionId;
  final String candidateId;
  final String assessmentId;
  final String status; // "in_progress", "submitted", "flagged"
  final String submittedCode;
  final List<TimelineItem> timeline;
  final List<SuspicionPayload> suspicionSummary;
  final int? finalScore;

  const SessionReviewResponse({
    required this.sessionId,
    required this.candidateId,
    required this.assessmentId,
    required this.status,
    required this.submittedCode,
    required this.timeline,
    required this.suspicionSummary,
    this.finalScore,
  });

  factory SessionReviewResponse.fromJson(Map<String, dynamic> json) {
    return SessionReviewResponse(
      sessionId: json['sessionId'] as String,
      candidateId: json['candidateId'] as String,
      assessmentId: json['assessmentId'] as String,
      status: json['status'] as String,
      submittedCode: json['submittedCode'] as String,
      timeline: (json['timeline'] as List<dynamic>)
          .map((e) => TimelineItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      suspicionSummary: (json['suspicionSummary'] as List<dynamic>)
          .map((e) => SuspicionPayload.fromJson(e as Map<String, dynamic>))
          .toList(),
      finalScore: json['finalScore'] as int?,
    );
  }
}

/// Individual behavioral timeline entry
class TimelineItem {
  final String timestamp;
  final String eventType;
  final String label;
  final String severity; // "info", "warning", "critical"
  final String detail;

  const TimelineItem({
    required this.timestamp,
    required this.eventType,
    required this.label,
    required this.severity,
    required this.detail,
  });

  factory TimelineItem.fromJson(Map<String, dynamic> json) {
    return TimelineItem(
      timestamp: json['timestamp'] as String,
      eventType: json['eventType'] as String,
      label: json['label'] as String,
      severity: json['severity'] as String,
      detail: json['detail'] as String? ?? '',
    );
  }
}

/// Gemini-generated suspicion payload for a micro-event analysis session
class SuspicionPayload {
  final int overallScore; // 0-100
  final String verdict; // "clean", "suspicious", "confirmed_violation"
  final List<SuspicionFactor> factors;
  final String generatedAt;
  final String sessionId;

  const SuspicionPayload({
    required this.overallScore,
    required this.verdict,
    required this.factors,
    required this.generatedAt,
    required this.sessionId,
  });

  factory SuspicionPayload.fromJson(Map<String, dynamic> json) {
    return SuspicionPayload(
      overallScore: (json['overallScore'] as num?)?.round() ?? 0,
      verdict: json['verdict'] as String? ?? 'clean',
      factors:
          (json['factors'] as List<dynamic>?)
              ?.map((e) => SuspicionFactor.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      generatedAt: json['generatedAt'] as String? ?? '',
      sessionId: json['sessionId'] as String? ?? '',
    );
  }
}

/// Individual suspicion factor contributing to the overall score
class SuspicionFactor {
  final String name;
  final int score; // 0-100 for this factor
  final String evidence;

  const SuspicionFactor({
    required this.name,
    required this.score,
    required this.evidence,
  });

  factory SuspicionFactor.fromJson(Map<String, dynamic> json) {
    return SuspicionFactor(
      name: json['name'] as String? ?? 'Unknown',
      score: (json['score'] as num?)?.round() ?? 0,
      evidence: json['evidence'] as String? ?? '',
    );
  }
}

/// Represents an individual micro-event sent by the frontend
class MicroEvent {
  final String eventType;
  final String timestamp;
  final Map<String, dynamic> payload;

  const MicroEvent({
    required this.eventType,
    required this.timestamp,
    required this.payload,
  });

  Map<String, dynamic> toJson() => {
    'eventType': eventType,
    'timestamp': timestamp,
    'payload': payload,
  };
}
