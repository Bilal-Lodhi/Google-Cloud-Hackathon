/**
 * Behavioral Flags List Widget
 * Renders a list of active behavioral flags with color-coded severity
 * indicators, expanding detail panels, and flag-dismissal actions.
 */

import 'package:flutter/material.dart';
import '../models/review_models.dart';

class BehavioralFlagsList extends StatelessWidget {
  final List<SuspicionPayload> reports;

  const BehavioralFlagsList({super.key, required this.reports});

  @override
  Widget build(BuildContext context) {
    if (reports.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.flag_outlined, size: 40, color: Colors.grey[350]),
            const SizedBox(height: 8),
            Text(
              'No behavioral flags raised',
              style: TextStyle(color: Colors.grey[500], fontSize: 13),
            ),
          ],
        ),
      );
    }

    // Flatten all factors across all reports
    final allFactors = <_FactorWithContext>[];
    for (final report in reports) {
      for (final factor in report.factors) {
        allFactors.add(
          _FactorWithContext(
            factor: factor,
            verdict: report.verdict,
            generatedAt: report.generatedAt,
          ),
        );
      }
    }

    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      itemCount: allFactors.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final item = allFactors[index];
        return _FlagTile(item: item);
      },
    );
  }
}

/// Internal pairing of a factor with its parent report context
class _FactorWithContext {
  final SuspicionFactor factor;
  final String verdict;
  final String generatedAt;

  const _FactorWithContext({
    required this.factor,
    required this.verdict,
    required this.generatedAt,
  });
}

class _FlagTile extends StatefulWidget {
  final _FactorWithContext item;

  const _FlagTile({required this.item});

  @override
  State<_FlagTile> createState() => _FlagTileState();
}

class _FlagTileState extends State<_FlagTile> {
  bool _expanded = false;
  bool _dismissed = false;

  @override
  Widget build(BuildContext context) {
    if (_dismissed) {
      return const SizedBox.shrink();
    }

    final factor = widget.item.factor;
    final severityColor = _colorForScore(factor.score);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      margin: const EdgeInsets.symmetric(vertical: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              child: Row(
                children: [
                  // Severity dot
                  Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: severityColor,
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Factor name
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          factor.name,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (_expanded && factor.evidence.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            factor.evidence,
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.grey[600],
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Score chip
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: severityColor.withAlpha(25),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${factor.score}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: severityColor,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  // Expand icon
                  Icon(
                    _expanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    size: 18,
                    color: Colors.grey[400],
                  ),
                ],
              ),
            ),
          ),
          // Expanded detail section
          if (_expanded) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  const SizedBox(width: 20),
                  Text(
                    'Verdict Context: ${widget.item.verdict.toUpperCase()}',
                    style: TextStyle(
                      fontSize: 10,
                      color: Colors.grey[500],
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: () => setState(() => _dismissed = true),
                    icon: const Icon(Icons.close, size: 14),
                    label: const Text(
                      'Dismiss',
                      style: TextStyle(fontSize: 11),
                    ),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),
          ],
        ],
      ),
    );
  }

  Color _colorForScore(int score) {
    if (score >= 70) return Colors.red;
    if (score >= 40) return Colors.orange;
    return Colors.yellow[700]!;
  }
}
