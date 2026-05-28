import 'package:flutter/foundation.dart';
import '../models/guardian_model.dart';
import '../services/api_service.dart';

/// ─── Cerberus AI — Review Provider ──────────────────────────────────────────
/// Loads aggregated review records (code submission + suspicion timeline)
/// for display in the split-panel analytical review log.

class ReviewProvider extends ChangeNotifier {
  final ApiService _api;

  List<ReviewRecord> _records = [];
  ReviewRecord? _selected;
  String? _error;
  bool _isLoading = false;

  ReviewProvider(this._api);

  List<ReviewRecord> get records => _records;
  ReviewRecord? get selected => _selected;
  String? get error => _error;
  bool get isLoading => _isLoading;

  Future<void> loadReviews() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _records = await _api.fetchReviews();
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = 'Failed to load reviews: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> loadReview(String recordId) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _selected = await _api.fetchReview(recordId);
    } on ApiException catch (e) {
      _error = e.message;
    } catch (e) {
      _error = 'Failed to load review: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  void selectRecord(ReviewRecord record) {
    _selected = record;
    notifyListeners();
  }

  void clearSelection() {
    _selected = null;
    notifyListeners();
  }
}
