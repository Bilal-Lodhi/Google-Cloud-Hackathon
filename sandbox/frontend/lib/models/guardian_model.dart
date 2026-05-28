class SuspicionPayload {
  /// ─── Cerberus AI — Intent & Plagiarism Guardian Model ─────────────────────
  /// Captures streaming micro-event suspicion payloads emitted by the Guardian
  /// Agent when it detects paste triggers, structural code shifts, fast token
  /// injections, or semantic similarity against known AI completions.
  final String sessionId;
  final String candidateId;
  final String problemId;
  final double suspicionScore; // 0.0 - 100.0
  final String severity; // "nominal" | "elevated" | "critical"
  final List<MicroEvent> flaggedEvents;
  final String generatedAt;

  const SuspicionPayload({
    required this.sessionId,
    required this.candidateId,
    required this.problemId,
    required this.suspicionScore,
    required this.severity,
    required this.flaggedEvents,
    required this.generatedAt,
  });

  factory SuspicionPayload.fromJson(Map<String, dynamic> json) {
    return SuspicionPayload(
      sessionId: json['session_id'] as String? ?? '',
      candidateId: json['candidate_id'] as String? ?? '',
      problemId: json['problem_id'] as String? ?? '',
      suspicionScore: (json['suspicion_score'] as num?)?.toDouble() ?? 0.0,
      severity: json['severity'] as String? ?? 'nominal',
      flaggedEvents: (json['flagged_events'] as List<dynamic>? ?? [])
          .map((e) => MicroEvent.fromJson(e as Map<String, dynamic>))
          .toList(),
      generatedAt: json['generated_at'] as String? ?? '',
    );
  }
}

class MicroEvent {
  final String eventType;
  // "paste_trigger" | "structural_shift" | "token_injection" |
  // "semantic_similarity" | "tab_blur" | "heartbeat_gap"
  final String timestamp;
  final Map<String, dynamic> evidence;
  final double confidence; // 0.0 - 1.0

  const MicroEvent({
    required this.eventType,
    required this.timestamp,
    required this.evidence,
    required this.confidence,
  });

  factory MicroEvent.fromJson(Map<String, dynamic> json) {
    return MicroEvent(
      eventType: json['event_type'] as String? ?? 'unknown',
      timestamp: json['timestamp'] as String? ?? '',
      evidence: json['evidence'] as Map<String, dynamic>? ?? const {},
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
    );
  }

  Map<String, dynamic> toJson() => {
    'event_type': eventType,
    'timestamp': timestamp,
    'evidence': evidence,
    'confidence': confidence,
  };
}

/// Aggregated review record combining the security timeline with the
/// candidate's final code submission for the split-panel UI.
class ReviewRecord {
  final String recordId;
  final String candidateId;
  final String candidateName;
  final String problemTitle;
  final String codeSubmission;
  final String language;
  final SuspicionPayload suspicion;
  final List<BehavioralFlag> behavioralFlags;

  const ReviewRecord({
    required this.recordId,
    required this.candidateId,
    required this.candidateName,
    required this.problemTitle,
    required this.codeSubmission,
    required this.language,
    required this.suspicion,
    required this.behavioralFlags,
  });

  factory ReviewRecord.fromJson(Map<String, dynamic> json) {
    return ReviewRecord(
      recordId: json['record_id'] as String? ?? '',
      candidateId: json['candidate_id'] as String? ?? '',
      candidateName: json['candidate_name'] as String? ?? 'Unknown Candidate',
      problemTitle: json['problem_title'] as String? ?? '',
      codeSubmission: json['code_submission'] as String? ?? '',
      language: json['language'] as String? ?? 'javascript',
      suspicion: SuspicionPayload.fromJson(
        json['suspicion'] as Map<String, dynamic>? ?? const {},
      ),
      behavioralFlags: (json['behavioral_flags'] as List<dynamic>? ?? [])
          .map((f) => BehavioralFlag.fromJson(f as Map<String, dynamic>))
          .toList(),
    );
  }
}

class BehavioralFlag {
  final String flagId;
  final String label;
  final String description;
  final String severity; // "info" | "warning" | "critical"
  final String detectedAt;

  const BehavioralFlag({
    required this.flagId,
    required this.label,
    required this.description,
    required this.severity,
    required this.detectedAt,
  });

  factory BehavioralFlag.fromJson(Map<String, dynamic> json) {
    return BehavioralFlag(
      flagId: json['flag_id'] as String? ?? '',
      label: json['label'] as String? ?? '',
      description: json['description'] as String? ?? '',
      severity: json['severity'] as String? ?? 'info',
      detectedAt: json['detected_at'] as String? ?? '',
    );
  }
}
