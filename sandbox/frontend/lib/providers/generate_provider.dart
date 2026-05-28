import 'package:flutter/foundation.dart';
import '../models/generate_model.dart';
import '../services/api_service.dart';

/// ─── Cerberus AI — Generate Provider ────────────────────────────────────────
/// Holds the state for the Autonomous Test Suite Generator feature.
/// Sends a text prompt to the Orchestrator Agent (Gemini 2.5 Flash) and
/// receives a fully structured competency-based assessment.

class GenerateProvider extends ChangeNotifier {
  final ApiService _api;

  GeneratedSuite? _suite;
  String? _error;
  bool _isLoading = false;

  GenerateProvider(this._api);

  GeneratedSuite? get suite => _suite;
  String? get error => _error;
  bool get isLoading => _isLoading;

  Future<void> generate(String prompt) async {
    if (prompt.trim().isEmpty) {
      _error = 'Prompt must not be empty';
      notifyListeners();
      return;
    }

    _isLoading = true;
    _error = null;
    _suite = null;
    notifyListeners();

    try {
      _suite = await _api.generateSuite(prompt);
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = 'Generation failed: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void reset() {
    _suite = null;
    _error = null;
    _isLoading = false;
    notifyListeners();
  }
}
