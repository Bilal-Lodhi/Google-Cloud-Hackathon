import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/generate_model.dart';
import '../services/api_service.dart';

/// ─── Cerberus AI — Generate Provider ────────────────────────────────────────
/// Holds the state for the Autonomous Test Suite Generator feature.
///
/// Retry strategy:
///   1. On transient 5xx / timeout errors, auto-retry up to 2 more times
///      with exponential backoff + jitter (500ms–4s delay).
///   2. If auto-retries are exhausted, surface a user-facing error state
///      that includes a "Retry" action — the user can manually re-trigger.
///   3. Manual retries send the exact same prompt again; they do NOT
///      count toward the auto-retry limit (the user is in control).

class GenerateProvider extends ChangeNotifier {
  final ApiService _api;

  static const int _maxAutoRetries = 2;
  static const Duration _initialDelay = Duration(seconds: 2);
  static const Duration _maxDelay = Duration(seconds: 8);

  GeneratedSuite? _suite;
  String? _error;
  bool _isLoading = false;
  int _attempt = 0; // 1-based, resets on success or explicit reset
  String _lastPrompt = '';

  GenerateProvider(this._api);

  // ── Public getters ──────────────────────────────────────────────────────

  GeneratedSuite? get suite => _suite;
  String? get error => _error;
  bool get isLoading => _isLoading;

  /// True when all auto-retries were exhausted and the user needs to
  /// manually tap "Retry" to try again.
  bool get canManualRetry =>
      !_isLoading && _error != null && _lastPrompt.isNotEmpty;

  // ── Generate — entry point (auto-retry loop) ────────────────────────────

  Future<void> generate(String prompt) async {
    final trimmed = prompt.trim();
    if (trimmed.isEmpty) {
      _error = 'Prompt must not be empty';
      notifyListeners();
      return;
    }

    _lastPrompt = trimmed;
    _attempt = 0;
    _suite = null;
    _error = null;
    _isLoading = true;
    notifyListeners();

    await _generateWithAutoRetry(trimmed);
  }

  // ── Manual retry (from UI button) ───────────────────────────────────────

  Future<void> retry() async {
    if (_lastPrompt.isEmpty) return;
    _attempt = 0; // reset counter so the user gets a fresh auto-retry cycle
    _suite = null;
    _error = null;
    _isLoading = true;
    notifyListeners();

    await _generateWithAutoRetry(_lastPrompt);
  }

  void reset() {
    _suite = null;
    _error = null;
    _isLoading = false;
    _attempt = 0;
    _lastPrompt = '';
    notifyListeners();
  }

  // ── Internal: auto-retry loop ───────────────────────────────────────────

  Future<void> _generateWithAutoRetry(String prompt) async {
    while (_attempt <= _maxAutoRetries) {
      _attempt++;
      try {
        _suite = await _api.generateSuite(prompt);
        // Success — clear error state
        _error = null;
        break;
      } on ApiException catch (e) {
        if (!e.isTransient || _attempt > _maxAutoRetries) {
          _error = _buildUserMessage(e);
          break;
        }
        // Transient error — backoff then loop
        await _backoff(_attempt);
      } catch (e) {
        _error = 'Generation failed: $e';
        break;
      }
    }

    _isLoading = false;
    notifyListeners();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  Future<void> _backoff(int attempt) async {
    final rng = Random();
    final jitter = rng.nextInt(500); // 0–499 ms
    final base = _initialDelay * pow(2, attempt - 1);
    final delay = Duration(
      milliseconds: (base.inMilliseconds + jitter).clamp(
        _initialDelay.inMilliseconds,
        _maxDelay.inMilliseconds,
      ),
    );
    // Log in debug builds
    debugPrint(
      '[GenerateProvider] Auto-retry in ${delay.inMilliseconds}ms (attempt $attempt/$_maxAutoRetries)',
    );
    await Future<void>.delayed(delay);
  }

  String _buildUserMessage(ApiException e) {
    if (e.statusCode == 503) {
      return 'Gemini is currently busy. Please try again in a moment.';
    }
    if (e.statusCode == 504) {
      return 'Gemini is taking too long to respond. Please try again shortly.';
    }
    if (e.statusCode == 429) {
      return 'Rate limit reached. Please wait and retry.';
    }
    if (e.statusCode >= 500) {
      return 'A server error occurred (${e.statusCode}). Tap Retry to try again.';
    }
    if (e.statusCode >= 400) {
      return e.message.length > 200 ? e.message.substring(0, 200) : e.message;
    }
    return e.message;
  }
}
