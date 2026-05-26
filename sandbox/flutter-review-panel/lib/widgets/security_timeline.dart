/**
 * Security Timeline Widget
 * Scrollable chronological list of timestamped behavioral events,
 * micro-flags, and Gemini suspicion report snapshots.
 */

import 'package:flutter/material.dart';
import '../models/review_models.dart';

class SecurityTimeline extends StatelessWidget {
  final List<TimelineItem> timelineItems;
  final String sessionId;

  const SecurityTimeline({
    super.key,
    required this.timelineItems,
    required this.sessionId,
  });

  @override
  Widget build(BuildContext context) {
    if (timelineItems.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_outlined, size: 48, color: Colors.grey[400]),
            const SizedBox(height: 12),
            Text(
              'No security events recorded',
              style: TextStyle(color: Colors.grey[600]),
            ),
            const SizedBox(height: 4),
            Text(
              'Session: $sessionId',
              style: TextStyle(color: Colors.grey[500], fontSize: 12),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: timelineItems.length,
      itemBuilder: (context, index) {
        final item = timelineItems[index];
        final isLast = index == timelineItems.length - 1;

        return _TimelineEntry(item: item, isLast: isLast);
      },
    );
  }
}

class _TimelineEntry extends StatelessWidget {
  final TimelineItem item;
  final bool isLast;

  const _TimelineEntry({required this.item, required this.isLast});

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Timeline rail
          SizedBox(
            width: 48,
            child: Column(
              children: [
                // Connector line from previous
                Container(width: 2, height: 12, color: Colors.grey[300]),
                // Icon circle
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _backgroundColor(item.severity),
                    border: Border.all(
                      color: _borderColor(item.severity),
                      width: 2,
                    ),
                  ),
                  child: Icon(
                    _iconForSeverity(item.severity),
                    size: 14,
                    color: Colors.white,
                  ),
                ),
                // Connector line to next (or empty if last)
                if (!isLast)
                  Expanded(child: Container(width: 2, color: Colors.grey[300])),
              ],
            ),
          ),
          // Content card
          Expanded(
            child: Container(
              margin: const EdgeInsets.only(
                right: 16,
                bottom: isLast ? 16 : 4,
                top: 4,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: _borderColor(item.severity).withAlpha(80),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        item.label,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        _formatTimestamp(item.timestamp),
                        style: TextStyle(fontSize: 11, color: Colors.grey[500]),
                      ),
                    ],
                  ),
                  if (item.detail.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      item.detail,
                      style: TextStyle(fontSize: 12, color: Colors.grey[700]),
                    ),
                  ],
                  const SizedBox(height: 6),
                  // Severity badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: _backgroundColor(item.severity).withAlpha(30),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      item.severity.toUpperCase(),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: _borderColor(item.severity),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _backgroundColor(String severity) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'warning':
        return Colors.orange;
      default:
        return Colors.blue;
    }
  }

  Color _borderColor(String severity) {
    switch (severity) {
      case 'critical':
        return Colors.red[700]!;
      case 'warning':
        return Colors.orange[700]!;
      default:
        return Colors.blue[700]!;
    }
  }

  IconData _iconForSeverity(String severity) {
    switch (severity) {
      case 'critical':
        return Icons.gpp_bad;
      case 'warning':
        return Icons.warning_amber;
      default:
        return Icons.info_outline;
    }
  }

  String _formatTimestamp(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final hour = dt.hour.toString().padLeft(2, '0');
      final min = dt.minute.toString().padLeft(2, '0');
      final sec = dt.second.toString().padLeft(2, '0');
      return '$hour:$min:$sec';
    } catch (_) {
      return iso;
    }
  }
}
