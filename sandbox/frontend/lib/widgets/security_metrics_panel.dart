import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/review_provider.dart';
import '../providers/guardian_provider.dart';
import '../models/guardian_model.dart';

/// ─── Cerberus FinSec — Middle Panel: Real-Time Threat Metrics & SIEM Feed ────
/// Displays a live Anomaly Risk Index circular gauge (0–100), a scrolling
/// micro-event timeline stream with color-coded severity badges, and
/// dimension-level risk breakdown cards. Reacts in real-time to
/// ingest events dispatched from the employee terminal workspace.

class SecurityMetricsPanel extends StatefulWidget {
  const SecurityMetricsPanel({super.key});

  @override
  State<SecurityMetricsPanel> createState() => _SecurityMetricsPanelState();
}

class _SecurityMetricsPanelState extends State<SecurityMetricsPanel> {
  final ScrollController _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToFirstRiskAssessment() {
    // Scroll to the top of the timeline where live events appear first
    if (_scrollController.hasClients) {
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  /// Merged timeline: GuardianProvider live events + ReviewRecord's static timeline
  List<_TimelineEntry> _buildTimeline(
    GuardianProvider guardian,
    ReviewRecord? record,
  ) {
    final entries = <_TimelineEntry>[];

    // Live guardian risk assessment payloads
    for (final payload in guardian.events.reversed) {
      // Derive a context-aware label from the top flag or risk score
      final topFlag = payload.flags.isNotEmpty
          ? payload.flags.first.description
          : null;
      final contextLabel =
          topFlag ??
          'Risk Score: ${payload.overallRiskScore.toStringAsFixed(1)}';
      final riskLabel =
          '$contextLabel (${payload.overallRiskScore.toStringAsFixed(0)})';

      entries.add(
        _TimelineEntry(
          timestamp: payload.generatedAt,
          eventType: 'RISK_ASSESSMENT',
          label: riskLabel,
          detail: payload.auditReasoning,
          severity: payload.overallRiskScore >= 75
              ? 'critical'
              : payload.overallRiskScore >= 45
              ? 'warning'
              : 'info',
        ),
      );
    }

    if (record != null) {
      for (final tl in record.timeline.reversed) {
        final ts = _parseTimelineTimestamp(tl['timestamp']);
        entries.add(
          _TimelineEntry(
            timestamp: ts,
            eventType: tl['eventType'] as String? ?? 'unknown',
            label: tl['label'] as String? ?? '',
            detail: tl['detail'] as String? ?? '',
            severity: tl['severity'] as String? ?? 'info',
          ),
        );
      }
    }

    return entries;
  }

  @override
  Widget build(BuildContext context) {
    final review = context.watch<ReviewProvider>().selected;
    final guardian = context.watch<GuardianProvider>();

    if (review == null) {
      return _buildEmptyState(context);
    }

    return _buildMetricsView(context, review, guardian);
  }

  Widget _buildEmptyState(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.shield_outlined,
            size: 64,
            color: theme.colorScheme.outline,
          ),
          const SizedBox(height: 16),
          Text(
            'Security metrics appear here',
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Select an active audit session to view the live telemetry',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricsView(
    BuildContext context,
    ReviewRecord record,
    GuardianProvider guardian,
  ) {
    final theme = Theme.of(context);
    final liveScore = guardian.events.isNotEmpty
        ? guardian.events.last.overallRiskScore
        : (record.lastRiskPayload?.overallRiskScore ?? 0.0);
    final severity = _deriveSeverity(liveScore);
    final timeline = _buildTimeline(guardian, record);
    final lastPayload = guardian.events.isNotEmpty
        ? guardian.events.last
        : record.lastRiskPayload;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // ═══ Anomaly Risk Index Gauge (always visible) ═══
        _buildAnomalyGaugeCard(theme, liveScore, severity, lastPayload),
        const Divider(height: 1),

        // ═══ Scrollable Live Micro-Event Stream ═══
        Expanded(
          child: timeline.isEmpty
              ? _buildNoEventsPlaceholder(theme)
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(12),
                  itemCount: timeline.length,
                  itemBuilder: (context, index) {
                    return _buildTimelineTile(theme, timeline[index]);
                  },
                ),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Anomaly Risk Index Circular Gauge Card
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildAnomalyGaugeCard(
    ThemeData theme,
    double score,
    String severity,
    RiskAssessmentPayload? lastPayload,
  ) {
    final color = _severityColor(severity, theme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.06)),
      child: Row(
        children: [
          // Circular progress indicator
          SizedBox(
            width: 72,
            height: 72,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.0, end: score / 100.0),
              duration: const Duration(milliseconds: 900),
              curve: Curves.easeOutCubic,
              builder: (context, value, _) {
                return Stack(
                  alignment: Alignment.center,
                  children: [
                    CircularProgressIndicator(
                      value: value,
                      strokeWidth: 6,
                      backgroundColor:
                          theme.colorScheme.surfaceContainerHighest,
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          score.toStringAsFixed(0),
                          style: theme.textTheme.headlineSmall?.copyWith(
                            color: color,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(width: 16),
          // Labels + metrics
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'ANOMALY RISK INDEX',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.outline,
                        letterSpacing: 0.8,
                      ),
                    ),
                    _severityBadge(theme, severity),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    _metricChip(
                      theme,
                      Icons.event,
                      '${lastPayload?.flags.length ?? 0} flags',
                      onTap: _scrollToFirstRiskAssessment,
                    ),
                    const SizedBox(width: 12),
                    _metricChip(
                      theme,
                      Icons.timer_outlined,
                      lastPayload != null
                          ? _formatTimestamp(lastPayload.generatedAt)
                          : '—',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNoEventsPlaceholder(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.check_circle_outline,
            size: 40,
            color: theme.colorScheme.outline,
          ),
          const SizedBox(height: 8),
          Text(
            'No suspicious events detected',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTimelineTile(ThemeData theme, _TimelineEntry entry) {
    final eventColor = _timelineSeverityColor(entry.severity, theme);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      color: theme.colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Event type icon
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: eventColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                _timelineIcon(entry.eventType),
                size: 18,
                color: eventColor,
              ),
            ),
            const SizedBox(width: 12),
            // Details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          entry.label,
                          style: theme.textTheme.labelMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      _severityBadge(theme, entry.severity),
                    ],
                  ),
                  if (entry.detail.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      entry.detail,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        fontFamily: 'monospace',
                        fontSize: 11,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    _formatTimestamp(entry.timestamp),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.outline,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  String _deriveSeverity(double score) {
    if (score >= 75) return 'critical';
    if (score >= 45) return 'elevated';
    return 'info';
  }

  Widget _severityBadge(ThemeData theme, String severity) {
    final color = _severityColor(severity, theme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        severity.toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: color,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _metricChip(
    ThemeData theme,
    IconData icon,
    String label, {
    VoidCallback? onTap,
  }) {
    final chip = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 14,
          color: onTap != null
              ? theme.colorScheme.primary
              : theme.colorScheme.outline,
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: onTap != null
                ? theme.colorScheme.primary
                : theme.colorScheme.outline,
          ),
        ),
      ],
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
          child: chip,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      child: chip,
    );
  }

  Color _severityColor(String severity, ThemeData theme) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'elevated':
        return Colors.orange;
      default:
        return theme.colorScheme.primary;
    }
  }

  Color _timelineSeverityColor(String severity, ThemeData theme) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'warning':
        return Colors.orange;
      default:
        return theme.colorScheme.primary;
    }
  }

  IconData _timelineIcon(String eventType) {
    switch (eventType) {
      case 'KEYSTROKE':
        return Icons.keyboard;
      case 'PASTE_TRIGGER':
        return Icons.content_paste;
      case 'CODE_DELTA':
        return Icons.account_tree;
      case 'TAB_SWITCH':
        return Icons.tab_unselected;
      case 'WINDOW_BLUR':
        return Icons.visibility_off;
      case 'COPY_ATTEMPT':
        return Icons.copy;
      case 'DEVELOPER_TOOLS_OPEN':
        return Icons.terminal;
      case 'FULLSCREEN_EXIT':
        return Icons.fullscreen_exit;
      case 'SUBMIT':
        return Icons.send;
      case 'RISK_ASSESSMENT':
        return Icons.analytics_outlined;
      default:
        return Icons.help_outline;
    }
  }

  /// Handles timestamps that may arrive as numeric epoch (ms) or ISO-8601 strings.
  String _parseTimelineTimestamp(dynamic value) {
    if (value == null) return '';
    if (value is String) return value;
    if (value is num) {
      return DateTime.fromMillisecondsSinceEpoch(
        value.toInt(),
      ).toUtc().toIso8601String();
    }
    return value.toString();
  }

  String _formatTimestamp(String timestamp) {
    if (timestamp.isEmpty) return '—';
    try {
      final dt = DateTime.parse(timestamp).toLocal();
      final hour = dt.hour.toString().padLeft(2, '0');
      final minute = dt.minute.toString().padLeft(2, '0');
      final second = dt.second.toString().padLeft(2, '0');
      return '$hour:$minute:$second';
    } catch (_) {
      return timestamp;
    }
  }
}

/// Lightweight internal model for the merged timeline list.
class _TimelineEntry {
  final String timestamp;
  final String eventType;
  final String label;
  final String detail;
  final String severity;

  const _TimelineEntry({
    required this.timestamp,
    required this.eventType,
    required this.label,
    required this.detail,
    required this.severity,
  });
}
