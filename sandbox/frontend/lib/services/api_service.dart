import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

import '../models/health_model.dart';
import '../models/generate_model.dart';
import '../models/guardian_model.dart';

/// ─── Cerberus AI — API Service ──────────────────────────────────────────────
/// Thin HTTP / SSE connectivity layer targeting the Hono API gateway.
/// Every call routes through Google Cloud-native fetch bindings (via Dart http)
/// with zero legacy dependencies.

class ApiService {
  final String baseUrl;
  final http.Client _client;

  ApiService({required this.baseUrl}) : _client = http.Client();

  // ── Health ─────────────────────────────────────────────────────────────────
  Future<HealthStatus> fetchHealth() async {
    final uri = Uri.parse('$baseUrl/health');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Health check failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return HealthStatus.fromJson(body);
  }

  // ── Autonomous Test Suite Generator ────────────────────────────────────────
  Future<GeneratedSuite> generateSuite(String prompt) async {
    final uri = Uri.parse('$baseUrl/api/v1/generate');
    http.Response response;
    try {
      response = await _client
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'prompt': prompt,
              'roleContext': 'fullstack-typescript',
            }),
          )
          .timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw ApiException(
        503,
        'Suite generation timed out — Gemini may be overloaded',
      );
    }

    if (response.statusCode == 200 || response.statusCode == 201) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      // Unwrap the response envelope: { success, suite, mcpCorrelationId }
      final suiteJson = body['suite'] as Map<String, dynamic>? ?? body;
      return GeneratedSuite.fromJson(suiteJson);
    }

    // ── Extract server-side error detail for better UX ────────────────────
    String detail;
    try {
      final errorBody = jsonDecode(response.body) as Map<String, dynamic>;
      detail = (errorBody['error'] as String?) ?? response.body;
      // Prefer the structured server error message
      if (detail.isEmpty) detail = response.body;
    } catch (_) {
      detail = response.body.isNotEmpty
          ? response.body.substring(0, Math.min(response.body.length, 256))
          : 'Suite generation failed';
    }

    throw ApiException(response.statusCode, detail);
  }

  // ── Live Guardian Stream (SSE with Polling Fallback) ───────────────────────
  Stream<SuspicionPayload> streamGuardianEvents(
    String sessionId, {
    Duration pollInterval = const Duration(seconds: 5),
  }) async* {
    final uri = Uri.parse('$baseUrl/api/v1/guardian/stream/$sessionId');

    try {
      final request = http.Request('GET', uri);
      final streamedResponse = await _client
          .send(request)
          .timeout(const Duration(seconds: 15));

      if (streamedResponse.statusCode == 200) {
        // ── SSE streaming active ─────────────────────────────────────────────
        final lineStream = streamedResponse.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter());

        await for (final line in lineStream) {
          if (line.startsWith('data: ')) {
            final raw = line.substring(6).trim();
            if (raw.isEmpty || raw == '[DONE]') continue;
            try {
              final json = jsonDecode(raw) as Map<String, dynamic>;
              yield SuspicionPayload.fromJson(json);
            } catch (_) {
              // Skip malformed events
            }
          }
        }
        return; // SSE stream ended naturally
      }
    } on Exception {
      // SSE unavailable — fall through to polling
    }

    // ── Polling Fallback ────────────────────────────────────────────────────
    while (true) {
      try {
        final review = await fetchReview(sessionId);
        if (review.latestSuspicion != null) {
          yield review.latestSuspicion!;
        }
      } catch (_) {
        // Silently swallow polling errors to keep the stream alive
      }
      await Future.delayed(pollInterval);
    }
  }

  // ── Ingest Micro-Events ────────────────────────────────────────────────────
  /// Submits candidate behavioral telemetry events to the Hono Guardian
  /// endpoint for real-time analysis. Returns `true` on successful ingestion.
  Future<bool> ingestMicroEvents(List<MicroEvent> events) async {
    final uri = Uri.parse('$baseUrl/api/v1/guardian/ingest');

    try {
      final response = await _client
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'events': events.map((e) => e.toJson()).toList(),
            }),
          )
          .timeout(const Duration(seconds: 15));

      return response.statusCode == 200 || response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  // ── Fetch Review Record ────────────────────────────────────────────────────
  /// Fetches a single session's full review payload from
  /// GET /api/v1/sessions/:sessionId which returns { success, data }.
  Future<ReviewRecord> fetchReview(String sessionId) async {
    final uri = Uri.parse('$baseUrl/api/v1/sessions/$sessionId');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Review fetch failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final data = body['data'] as Map<String, dynamic>?;
    if (data == null) {
      throw ApiException(response.statusCode, 'Review data missing');
    }
    return ReviewRecord.fromJson(data);
  }

  // ── List All Sessions (Drawer) ─────────────────────────────────────────────
  /// Fetches the session list from GET /api/v1/sessions
  /// which returns { success, data: [...] }.
  Future<List<SessionSummary>> fetchSessions() async {
    final uri = Uri.parse('$baseUrl/api/v1/sessions');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Sessions list failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final items = body['data'] as List<dynamic>? ?? [];
    return items
        .map((s) => SessionSummary.fromJson(s as Map<String, dynamic>))
        .toList();
  }

  void dispose() {
    _client.close();
  }
}

class Math {
  static int min(int a, int b) => a < b ? a : b;
}

class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException(this.statusCode, this.message);

  /// 503 Service Unavailable or 504 Gateway Timeout — temporary,
  /// downstream service (Gemini) may recover.
  bool get isRetryable =>
      statusCode == 503 ||
      statusCode == 504 ||
      (statusCode >= 500 && message.toLowerCase().contains('timed out')) ||
      message.toLowerCase().contains('overloaded');

  /// True when auto-retries are appropriate (5xx except explicitly terminal).
  bool get isTransient => statusCode >= 500 && statusCode < 600;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
