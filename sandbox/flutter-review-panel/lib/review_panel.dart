/**
 * Interactive Analytical Review Log — Flutter Split-Panel View
 * Google Cloud Rapid Agent Hackathon 2026 — MongoDB Partner Track
 *
 * This widget renders a responsive two-panel layout:
 *   Left Panel:  Candidate's submitted code workspace (syntax-highlighted)
 *   Right Panel: Scrollable timeline of timestamped security metrics,
 *                suspicion scores, and behavioral flags from MongoDB
 *
 * Architecture:
 *   LayoutBuilder → Row (wide) / Column (narrow) split
 *   Fetches from Hono API: GET /api/v1/sessions/:sessionId/review
 *   Subscription-based micro-event streaming via EventSource
 *
 * Zero legacy Flutter dependencies beyond the Flutter SDK itself.
 * Uses Dart's native http and dart:convert — no third-party state management.
 */

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'models/review_models.dart';
import 'widgets/code_viewer.dart';
import 'widgets/security_timeline.dart';
import 'widgets/suspicion_gauge.dart';
import 'widgets/behavioral_flags_list.dart';
import 'services/review_service.dart';

class ReviewPanel extends StatefulWidget {
  final String sessionId;
  final String apiBaseUrl;

  const ReviewPanel({
    super.key,
    required this.sessionId,
    this.apiBaseUrl = 'http://localhost:3000',
  });

  @override
  State<ReviewPanel> createState() => _ReviewPanelState();
}

class _ReviewPanelState extends State<ReviewPanel> {
  final ReviewService _reviewService = ReviewService();
  SessionReviewResponse? _review;
  bool _isLoading = true;
  String? _error;
  StreamSubscription<SessionReviewResponse>? _streamSubscription;

  @override
  void initState() {
    super.initState();
    _loadReview();
    _subscribeToStreaming();
  }

  @override
  void dispose() {
    _streamSubscription?.cancel();
    super.dispose();
  }

  Future<void> _loadReview() async {
    try {
      setState(() {
        _isLoading = true;
        _error = null;
      });

      final review = await _reviewService.fetchReview(
        apiBaseUrl: widget.apiBaseUrl,
        sessionId: widget.sessionId,
      );

      if (mounted) {
        setState(() {
          _review = review;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  void _subscribeToStreaming() {
    _streamSubscription = _reviewService
        .streamReview(
          apiBaseUrl: widget.apiBaseUrl,
          sessionId: widget.sessionId,
        )
        .listen(
          (updatedReview) {
            if (mounted) {
              setState(() {
                _review = updatedReview;
              });
            }
          },
          onError: (error) {
            if (mounted) {
              setState(() {
                _error = error.toString();
              });
            }
          },
        );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Loading analytical review...'),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 64, color: Colors.red[400]),
            const SizedBox(height: 16),
            Text(
              'Failed to load review',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: Colors.red[700])),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _loadReview,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    final review = _review!;

    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth > 900;

        if (isWide) {
          // ─── Wide Layout: Side-by-side Row ──────────────────────
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Left Panel — Code Submission
              Expanded(flex: 5, child: _buildLeftPanel(review)),
              // Vertical Divider
              const VerticalDivider(width: 1, thickness: 2),
              // Right Panel — Security Timeline
              Expanded(flex: 4, child: _buildRightPanel(review)),
            ],
          );
        } else {
          // ─── Narrow Layout: Top/Bottom Stack ────────────────────
          return Column(
            children: [
              // Top — Code Submission (collapsible)
              Flexible(flex: 1, child: _buildLeftPanel(review)),
              const Divider(height: 1, thickness: 2),
              // Bottom — Security Timeline
              Flexible(flex: 1, child: _buildRightPanel(review)),
            ],
          );
        }
      },
    );
  }

  Widget _buildLeftPanel(SessionReviewResponse review) {
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Panel Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHigh,
              border: const Border(bottom: BorderSide(color: Colors.black12)),
            ),
            child: Row(
              children: [
                Icon(Icons.code, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Code Submission',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const Spacer(),
                // Copy button
                IconButton(
                  icon: const Icon(Icons.copy, size: 18),
                  tooltip: 'Copy code to clipboard',
                  onPressed: () {
                    Clipboard.setData(
                      ClipboardData(text: review.submittedCode),
                    );
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Code copied to clipboard')),
                    );
                  },
                ),
              ],
            ),
          ),
          // Code Viewer (syntax-highlighted, read-only)
          Expanded(
            child: CodeViewer(
              code: review.submittedCode,
              language: 'javascript', // Configurable based on assessment type
            ),
          ),
          // Status bar
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHigh,
              border: const Border(top: BorderSide(color: Colors.black12)),
            ),
            child: Row(
              children: [
                _buildStatusChip(review.status),
                const SizedBox(width: 12),
                if (review.finalScore != null) ...[
                  const Icon(Icons.score, size: 16),
                  const SizedBox(width: 4),
                  Text('Score: ${review.finalScore}'),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRightPanel(SessionReviewResponse review) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Panel Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHigh,
              border: const Border(bottom: BorderSide(color: Colors.black12)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.security,
                  color: _getSecurityColor(review.suspicionSummary),
                ),
                const SizedBox(width: 8),
                Text(
                  'Security Audit Trail',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const Spacer(),
                // Refresh button
                IconButton(
                  icon: const Icon(Icons.refresh, size: 18),
                  tooltip: 'Refresh data',
                  onPressed: _loadReview,
                ),
              ],
            ),
          ),

          // ─── Suspect-gauge summary bar ──────────────────────────
          if (review.suspicionSummary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(12),
              child: SuspicionGauge(
                reports: review.suspicionSummary,
                currentCode: review.submittedCode,
              ),
            ),

          // ─── Scrollable timeline ────────────────────────────────
          Expanded(
            child: SecurityTimeline(
              timelineItems: review.timeline,
              sessionId: review.sessionId,
            ),
          ),

          // ─── Behavioral flags summary ───────────────────────────
          if (review.suspicionSummary.isNotEmpty)
            Container(
              constraints: const BoxConstraints(maxHeight: 200),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHigh,
                border: const Border(top: BorderSide(color: Colors.black12)),
              ),
              child: BehavioralFlagsList(reports: review.suspicionSummary),
            ),
        ],
      ),
    );
  }

  Color _getSecurityColor(List<SuspicionPayload> reports) {
    if (reports.isEmpty) return Colors.green;
    final maxScore = reports
        .map((r) => r.overallScore)
        .reduce((a, b) => a > b ? a : b);
    if (maxScore < 30) return Colors.green;
    if (maxScore < 60) return Colors.orange;
    return Colors.red;
  }

  Widget _buildStatusChip(String status) {
    Color chipColor;
    IconData chipIcon;
    String label;

    switch (status) {
      case 'submitted':
        chipColor = Colors.blue;
        chipIcon = Icons.check_circle;
        label = 'Submitted';
        break;
      case 'flagged':
        chipColor = Colors.orange;
        chipIcon = Icons.flag;
        label = 'Flagged';
        break;
      case 'in_progress':
        chipColor = Colors.grey;
        chipIcon = Icons.hourglass_top;
        label = 'In Progress';
        break;
      default:
        chipColor = Colors.grey;
        chipIcon = Icons.help;
        label = status;
    }

    return Chip(
      avatar: Icon(chipIcon, size: 16, color: Colors.white),
      label: Text(
        label,
        style: const TextStyle(color: Colors.white, fontSize: 12),
      ),
      backgroundColor: chipColor,
      padding: EdgeInsets.zero,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}
