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
    final response = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'prompt': prompt,
            'roleContext': 'fullstack-typescript',
          }),
        )
        .timeout(const Duration(seconds: 60));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Suite generation failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return GeneratedSuite.fromJson(body);
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

class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException(this.statusCode, this.message);

  @override
  String toString() => 'ApiException($statusCode): $message';
}
