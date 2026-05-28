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

  // ── Live Guardian Stream (SSE) ─────────────────────────────────────────────
  Stream<SuspicionPayload> streamGuardianEvents(String sessionId) async* {
    final uri = Uri.parse('$baseUrl/api/v1/guardian/stream/$sessionId');
    final request = http.Request('GET', uri);
    final streamedResponse = await _client
        .send(request)
        .timeout(const Duration(minutes: 10));

    if (streamedResponse.statusCode != 200) {
      throw ApiException(streamedResponse.statusCode, 'Guardian stream failed');
    }

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
  }

  // ── Fetch Review Record ────────────────────────────────────────────────────
  Future<ReviewRecord> fetchReview(String sessionId) async {
    final uri = Uri.parse('$baseUrl/api/v1/sessions/$sessionId');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Review fetch failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return ReviewRecord.fromJson(body);
  }

  // ── List All Review Records ────────────────────────────────────────────────
  Future<List<ReviewRecord>> fetchReviews() async {
    final uri = Uri.parse('$baseUrl/api/v1/sessions');
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw ApiException(response.statusCode, 'Reviews list failed');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final items = body['records'] as List<dynamic>? ?? [];
    return items
        .map((r) => ReviewRecord.fromJson(r as Map<String, dynamic>))
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
