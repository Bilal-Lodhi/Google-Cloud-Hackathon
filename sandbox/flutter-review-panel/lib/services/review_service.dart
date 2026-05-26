/**
 * Analytical Review Service — HTTP Client Layer
 * Communicates with the Hono API backend for session review data.
 * Uses Dart's native dart:io HttpClient — zero third-party HTTP deps.
 */

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../models/review_models.dart';

class ReviewService {
  final HttpClient _httpClient = HttpClient();
  static const Duration _timeout = Duration(seconds: 15);

  /// Fetch a complete session review snapshot
  Future<SessionReviewResponse> fetchReview({
    required String apiBaseUrl,
    required String sessionId,
  }) async {
    final uri = Uri.parse('$apiBaseUrl/api/v1/sessions/$sessionId');

    try {
      final request = await _httpClient.getUrl(uri)
        ..headers.set('Content-Type', 'application/json')
        ..headers.set('Accept', 'application/json');

      final response = await request.close().timeout(_timeout);

      if (response.statusCode == 200) {
        final body = await response.transform(utf8.decoder).join();
        final json = jsonDecode(body) as Map<String, dynamic>;

        if (json['success'] == true && json['data'] != null) {
          return SessionReviewResponse.fromJson(
            json['data'] as Map<String, dynamic>,
          );
        } else {
          throw Exception(json['error'] ?? 'Unknown API error');
        }
      } else if (response.statusCode == 404) {
        throw Exception('Session not found: $sessionId');
      } else {
        throw Exception('HTTP ${response.statusCode}: Failed to fetch review');
      }
    } on TimeoutException {
      throw Exception('Request timed out while fetching session review');
    } on SocketException {
      throw Exception('Network error: Unable to reach the API server');
    }
  }

  /// Stream review updates via Server-Sent Events (EventSource).
  /// Falls back to polling if SSE endpoint is unavailable.
  Stream<SessionReviewResponse> streamReview({
    required String apiBaseUrl,
    required String sessionId,
    Duration pollInterval = const Duration(seconds: 5),
  }) async* {
    // Attempt SSE connection to the streaming endpoint
    final sseUri = Uri.parse('$apiBaseUrl/api/v1/sessions/$sessionId/stream');

    try {
      final request = await _httpClient.getUrl(sseUri)
        ..headers.set('Accept', 'text/event-stream')
        ..headers.set('Cache-Control', 'no-cache');

      final response = await request.close();
      final statusCode = response.statusCode;

      if (statusCode == 200) {
        // SSE streaming active
        final lines = response
            .transform(utf8.decoder)
            .transform(const LineSplitter());

        await for (final line in lines) {
          if (line.startsWith('data: ')) {
            final data = line.substring(6);
            if (data == '[DONE]') break;

            try {
              final json = jsonDecode(data) as Map<String, dynamic>;
              if (json['data'] != null) {
                yield SessionReviewResponse.fromJson(
                  json['data'] as Map<String, dynamic>,
                );
              }
            } catch (_) {
              // Skip unparseable SSE frames
            }
          }
        }
        return; // SSE stream ended naturally
      }
    } on SocketException {
      // SSE unavailable, fall through to polling
    } on TimeoutException {
      // Connection timed out, fall through to polling
    }

    // ─── Polling Fallback ─────────────────────────────────────────
    while (true) {
      try {
        final review = await fetchReview(
          apiBaseUrl: apiBaseUrl,
          sessionId: sessionId,
        );
        yield review;
      } catch (_) {
        // Silently swallow polling errors to keep the stream alive
      }
      await Future.delayed(pollInterval);
    }
  }

  /// Submit micro-events batch to the guardian endpoint
  Future<bool> ingestMicroEvents({
    required String apiBaseUrl,
    required List<MicroEvent> events,
  }) async {
    final uri = Uri.parse('$apiBaseUrl/api/v1/guardian/ingest');

    try {
      final request = await _httpClient.postUrl(uri)
        ..headers.set('Content-Type', 'application/json')
        ..write(jsonEncode({'events': events.map((e) => e.toJson()).toList()}));

      final response = await request.close().timeout(_timeout);
      return response.statusCode == 200 || response.statusCode == 201;
    } catch (_) {
      return false;
    }
  }

  void dispose() {
    _httpClient.close();
  }
}
