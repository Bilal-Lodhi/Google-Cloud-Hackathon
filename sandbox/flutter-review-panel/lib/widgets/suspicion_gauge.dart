/**
 * Suspicion Gauge Widget
 * Visual summary of the Gemini Intent Guardian suspicion analysis.
 * Displays a semi-circular gauge with the overall score (0-100),
 * color-coded risk zones, and a verdict label.
 */

import 'package:flutter/material.dart';
import '../models/review_models.dart';

class SuspicionGauge extends StatelessWidget {
  final List<SuspicionPayload> reports;
  final String currentCode; // Reserved for future diff-highlighting overlay

  const SuspicionGauge({
    super.key,
    required this.reports,
    this.currentCode = '',
  });

  @override
  Widget build(BuildContext context) {
    if (reports.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF2E7D32), Color(0xFF388E3C)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Row(
          children: [
            Icon(Icons.check_circle, color: Colors.white, size: 32),
            SizedBox(width: 12),
            Text(
              'No suspicious activity detected',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 15,
              ),
            ),
          ],
        ),
      );
    }

    // Use the most recent report
    final latest = reports.first;
    final score = latest.overallScore.clamp(0, 100);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: _gradientColors(score),
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: _mainColor(score).withAlpha(80),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Top row: Verdict + Score
          Row(
            children: [
              Icon(_verdictIcon(latest.verdict), color: Colors.white, size: 24),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'SUSPICION SCORE',
                      style: TextStyle(
                        color: Colors.white.withAlpha(200),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _verdictLabel(latest.verdict),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                      ),
                    ),
                  ],
                ),
              ),
              // Numeric score display
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withAlpha(40),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  '$score',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 28,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Progress bar visualization
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: score / 100,
              minHeight: 6,
              backgroundColor: Colors.white.withAlpha(60),
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
            ),
          ),
          const SizedBox(height: 4),

          // Min / Max labels
          Row(
            children: [
              Text(
                '0 Clean',
                style: TextStyle(
                  color: Colors.white.withAlpha(180),
                  fontSize: 10,
                ),
              ),
              const Spacer(),
              Text(
                '100 Critical',
                style: TextStyle(
                  color: Colors.white.withAlpha(180),
                  fontSize: 10,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Factor breakdown
          if (latest.factors.isNotEmpty) ...[
            Text(
              'DETECTED FACTORS',
              style: TextStyle(
                color: Colors.white.withAlpha(180),
                fontSize: 10,
                fontWeight: FontWeight.bold,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 6),
            ...latest.factors.map(
              (factor) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        factor.name,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 60,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: factor.score / 100,
                          minHeight: 4,
                          backgroundColor: Colors.white.withAlpha(40),
                          valueColor: AlwaysStoppedAnimation<Color>(
                            Colors.white.withAlpha(220),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${factor.score}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  List<Color> _gradientColors(int score) {
    if (score < 30) {
      return const [Color(0xFF2E7D32), Color(0xFF43A047)];
    } else if (score < 60) {
      return const [Color(0xFFE65100), Color(0xFFFF9800)];
    } else {
      return const [Color(0xFFC62828), Color(0xFFE53935)];
    }
  }

  Color _mainColor(int score) {
    if (score < 30) return Colors.green;
    if (score < 60) return Colors.orange;
    return Colors.red;
  }

  IconData _verdictIcon(String verdict) {
    switch (verdict) {
      case 'confirmed_violation':
        return Icons.gpp_bad;
      case 'suspicious':
        return Icons.warning_amber;
      default:
        return Icons.shield;
    }
  }

  String _verdictLabel(String verdict) {
    switch (verdict) {
      case 'confirmed_violation':
        return 'CONFIRMED VIOLATION';
      case 'suspicious':
        return 'SUSPICIOUS ACTIVITY';
      default:
        return 'CLEAN';
    }
  }
}
