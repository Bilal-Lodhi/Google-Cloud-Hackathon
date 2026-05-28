import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/review_provider.dart';
import '../models/guardian_model.dart';

/// ─── Cerberus AI — Right Panel: Security Metrics Timeline ───────────────────
/// Scrollable ListView rendering timestamped suspicion scores, micro-event
/// evidence, and behavioral flags from the MongoDB datastore via SSE stream.

class SecurityMetricsPanel extends StatelessWidget {
  const SecurityMetricsPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final review = context.watch<ReviewProvider>().selected;

    if (review == null) {
      return _buildEmptyState(context);
    }

    return _buildMetricsView(context, review);
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
            'Select a review record to view the timeline',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMetricsView(BuildContext context, ReviewRecord record) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Suspicion score header bar
        _buildScoreHeader(theme, record.suspicion),
        const Divider(height: 1),

        // Behavioral flags section
        if (record.behavioralFlags.isNotEmpty) ...[
          _buildFlagsSection(theme, record.behavioralFlags),
          const Divider(height: 1),
        ],

        // Micro-event timeline
        Expanded(
          child: record.suspicion.flaggedEvents.isEmpty
              ? _buildNoEventsPlaceholder(theme)
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: record.suspicion.flaggedEvents.length,
                  itemBuilder: (context, index) {
                    return _buildEventTile(
                      theme,
                      record.suspicion.flaggedEvents[index],
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildScoreHeader(ThemeData theme, SuspicionPayload suspicion) {
    final color = _severityColor(suspicion.severity, theme);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.08)),
      child: Column(
        children: [
          // Score gauge
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Suspicion Score', style: theme.textTheme.titleSmall),
              _severityBadge(theme, suspicion.severity),
            ],
          ),
          const SizedBox(height: 12),
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: suspicion.suspicionScore / 100),
            duration: const Duration(milliseconds: 800),
            curve: Curves.easeOutCubic,
            builder: (context, value, _) {
              return Column(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: value,
                      minHeight: 10,
                      backgroundColor:
                          theme.colorScheme.surfaceContainerHighest,
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      '${suspicion.suspicionScore.toStringAsFixed(1)} / 100',
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: color,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _metricChip(
                theme,
                Icons.event,
                '${suspicion.flaggedEvents.length} events',
              ),
              const SizedBox(width: 12),
              _metricChip(
                theme,
                Icons.timer_outlined,
                _formatTimestamp(suspicion.generatedAt),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFlagsSection(ThemeData theme, List<BehavioralFlag> flags) {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.flag, size: 16, color: theme.colorScheme.error),
              const SizedBox(width: 6),
              Text(
                'Behavioral Flags',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.error,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${flags.length}',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onErrorContainer,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: flags.map((flag) {
              return Chip(
                avatar: Icon(
                  _flagIcon(flag.severity),
                  size: 14,
                  color: _flagColor(flag.severity, theme),
                ),
                label: Text(flag.label, style: theme.textTheme.labelSmall),
                backgroundColor: _flagColor(
                  flag.severity,
                  theme,
                ).withValues(alpha: 0.12),
                side: BorderSide.none,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              );
            }).toList(),
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

  Widget _buildEventTile(ThemeData theme, MicroEvent event) {
    final eventColor = _eventTypeColor(event.eventType, theme);

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
                _eventIcon(event.eventType),
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
                      Text(
                        _eventLabel(event.eventType),
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        '${(event.confidence * 100).toStringAsFixed(0)}% conf.',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.outline,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _eventEvidenceSummary(event.evidence),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _formatTimestamp(event.timestamp),
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

  Widget _metricChip(ThemeData theme, IconData icon, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: theme.colorScheme.outline),
        const SizedBox(width: 4),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.outline,
          ),
        ),
      ],
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

  Color _flagColor(String severity, ThemeData theme) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'warning':
        return Colors.orange;
      default:
        return Colors.blue;
    }
  }

  IconData _flagIcon(String severity) {
    switch (severity) {
      case 'critical':
        return Icons.report;
      case 'warning':
        return Icons.warning_amber;
      default:
        return Icons.info_outline;
    }
  }

  Color _eventTypeColor(String eventType, ThemeData theme) {
    switch (eventType) {
      case 'paste_trigger':
        return Colors.orange;
      case 'structural_shift':
        return Colors.purple;
      case 'token_injection':
        return Colors.red;
      case 'semantic_similarity':
        return Colors.deepOrange;
      case 'tab_blur':
        return Colors.amber;
      case 'heartbeat_gap':
        return Colors.teal;
      default:
        return theme.colorScheme.outline;
    }
  }

  IconData _eventIcon(String eventType) {
    switch (eventType) {
      case 'paste_trigger':
        return Icons.content_paste;
      case 'structural_shift':
        return Icons.account_tree;
      case 'token_injection':
        return Icons.speed;
      case 'semantic_similarity':
        return Icons.compare_arrows;
      case 'tab_blur':
        return Icons.tab_unselected;
      case 'heartbeat_gap':
        return Icons.monitor_heart;
      default:
        return Icons.help_outline;
    }
  }

  String _eventLabel(String eventType) {
    switch (eventType) {
      case 'paste_trigger':
        return 'Paste Trigger';
      case 'structural_shift':
        return 'Structural Shift';
      case 'token_injection':
        return 'Token Injection';
      case 'semantic_similarity':
        return 'AI Similarity Match';
      case 'tab_blur':
        return 'Tab Focus Loss';
      case 'heartbeat_gap':
        return 'Heartbeat Gap';
      default:
        return eventType;
    }
  }

  String _eventEvidenceSummary(Map<String, dynamic> evidence) {
    if (evidence.isEmpty) return 'No evidence details';
    final keys = evidence.keys.take(3).join(', ');
    return 'Evidence: $keys';
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
