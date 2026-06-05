import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/health_provider.dart';
import '../providers/identity_provider.dart';
import '../providers/review_provider.dart';
import '../models/guardian_model.dart';
import '../widgets/generate_panel.dart';
import '../widgets/security_metrics_panel.dart';
import '../widgets/code_workspace_panel.dart';

/// ─── Cerberus FinSec — Dashboard Screen ───────────────────────────────────────
/// Root shell after identity setup. Provides:
///   - AppBar with operator identity badge
///   - Compliance Matrix button that opens a bottom sheet (via [ComplianceSheet])
///   - Left navigation drawer (active audit sessions)
///   - Wide layout: Code Workspace | Security Metrics
///   - Narrow layout: Tab-based switching between Terminal & Telemetry

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);

    // Load initial data
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final review = context.read<ReviewProvider>();
      review.loadSessions();
      final health = context.read<HealthProvider>();
      health.checkHealth();
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final identity = context.watch<IdentityProvider>();

    return Scaffold(
      // ── App Bar ──────────────────────────────────────────────────────────
      appBar: AppBar(
        title: Text(
          'Cerberus FinSec',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            color: theme.colorScheme.primary,
          ),
        ),
        actions: [
          // Compliance Matrix button
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: TextButton.icon(
              onPressed: () => ComplianceSheet.show(context),
              icon: Icon(
                Icons.gavel,
                size: 18,
                color: theme.colorScheme.primary,
              ),
              label: Text('Compliance', style: theme.textTheme.labelMedium),
              style: TextButton.styleFrom(
                foregroundColor: theme.colorScheme.primary,
                visualDensity: VisualDensity.compact,
              ),
            ),
          ),
          // Operator identity chip
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Chip(
              avatar: Icon(
                Icons.shield_moon,
                size: 18,
                color: theme.colorScheme.primary,
              ),
              label: Text(
                identity.displayName ?? 'Operator',
                style: theme.textTheme.labelMedium,
              ),
              backgroundColor: theme.colorScheme.primaryContainer,
              side: BorderSide.none,
            ),
          ),
        ],
      ),
      // ── Navigation Drawer (Left) ────────────────────────────────────────
      drawer: _buildDrawer(theme),
      // ── Body ─────────────────────────────────────────────────────────────
      body: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth >= 900) {
            return _buildWideLayout();
          }
          return _buildNarrowLayout();
        },
      ),
    );
  }

  // ── Drawer ─────────────────────────────────────────────────────────────────

  Widget _buildDrawer(ThemeData theme) {
    final review = context.watch<ReviewProvider>();
    final health = context.watch<HealthProvider>();

    return Drawer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drawer header
          Container(
            color: theme.colorScheme.primaryContainer,
            padding: const EdgeInsets.fromLTRB(16, 48, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.verified_user,
                            size: 28,
                            color: theme.colorScheme.onPrimaryContainer,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Active Audits',
                            style: theme.textTheme.titleMedium?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            '${review.sessions.length} session(s) monitored',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 4),
                    // Drawer close button
                    IconButton(
                      icon: Icon(
                        Icons.close,
                        size: 20,
                        color: theme.colorScheme.onPrimaryContainer.withValues(
                          alpha: 0.7,
                        ),
                      ),
                      tooltip: 'Close drawer',
                      onPressed: () => Navigator.pop(context),
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Cerberus FinSec',
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'Real-Time Insider Threat Guardian',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer.withValues(
                      alpha: 0.8,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Health status
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('SYSTEM HEALTH', style: theme.textTheme.labelSmall),
                const SizedBox(height: 8),
                health.isLoading
                    ? const LinearProgressIndicator()
                    : health.error != null
                    ? Row(
                        children: [
                          Icon(
                            Icons.error,
                            size: 16,
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              health.error!,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.error,
                              ),
                            ),
                          ),
                        ],
                      )
                    : _buildHealthGrid(theme, health),
              ],
            ),
          ),
          const Divider(),
          // ── Categorized audit session list ──
          Expanded(
            child: Builder(
              builder: (context) {
                if (review.isLoading) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (review.error != null) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        'Error: ${review.error}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.error,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }
                if (review.sessions.isEmpty) {
                  return Center(
                    child: Text(
                      'No deployed audits',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  );
                }

                // Categorize: active (eventCount > 0) vs new/inactive (eventCount == 0)
                final activeSessions = review.sessions
                    .where((s) => s.eventCount > 0)
                    .toList();
                final newSessions = review.sessions
                    .where((s) => s.eventCount == 0)
                    .toList();

                return ListView(
                  children: [
                    // ── Active Sessions Section ──
                    if (activeSessions.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.shield,
                              size: 14,
                              color: theme.colorScheme.primary,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'ACTIVE (${activeSessions.length})',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.primary,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ...activeSessions.map(
                        (session) => _buildSessionTile(theme, review, session),
                      ),
                      const Divider(indent: 16, endIndent: 16),
                    ],
                    // ── New / Inactive Sessions Section ──
                    if (newSessions.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.schedule,
                              size: 14,
                              color: theme.colorScheme.outline,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'NEW / INACTIVE (${newSessions.length})',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.outline,
                              ),
                            ),
                          ],
                        ),
                      ),
                      ...newSessions.map(
                        (session) => _buildSessionTile(theme, review, session),
                      ),
                    ],
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHealthGrid(ThemeData theme, HealthProvider health) {
    final status = health.status;
    if (status == null) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: status.services.map((svc) {
        return Chip(
          avatar: Icon(
            svc.isHealthy ? Icons.check_circle : Icons.error,
            size: 14,
            color: svc.isHealthy ? Colors.green : Colors.red,
          ),
          label: Text(
            '${svc.name} (${svc.latencyMs}ms)',
            style: theme.textTheme.labelSmall,
          ),
          backgroundColor: theme.colorScheme.surfaceContainerHighest,
          side: BorderSide.none,
        );
      }).toList(),
    );
  }

  // ── Wide Layout (>= 900px) ─────────────────────────────────────────────────
  Widget _buildWideLayout() {
    final theme = Theme.of(context);

    return Row(
      children: [
        // Left panel — Employee Terminal Workspace
        Expanded(
          flex: 5,
          child: Container(
            decoration: BoxDecoration(
              border: Border(
                right: BorderSide(color: theme.dividerColor, width: 2),
              ),
            ),
            child: const CodeWorkspacePanel(),
          ),
        ),
        // Right panel — Live Threat Telemetry
        Expanded(flex: 4, child: _buildTelemetryPanel(theme)),
      ],
    );
  }

  // ── Narrow Layout (< 900px) ────────────────────────────────────────────────
  Widget _buildNarrowLayout() {
    final theme = Theme.of(context);

    return Column(
      children: [
        TabBar(
          controller: _tabController,
          labelColor: theme.colorScheme.primary,
          unselectedLabelColor: theme.colorScheme.outline,
          tabs: const [
            Tab(icon: Icon(Icons.terminal), text: 'Terminal'),
            Tab(icon: Icon(Icons.shield), text: 'Telemetry'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              const CodeWorkspacePanel(),
              const SecurityMetricsPanel(),
            ],
          ),
        ),
      ],
    );
  }

  Color _riskScoreColor(double score, ThemeData theme) {
    if (score >= 75) return Colors.red;
    if (score >= 40) return Colors.orange;
    return theme.colorScheme.primary;
  }

  Widget _buildTelemetryPanel(ThemeData theme) {
    return Container(
      color: theme.colorScheme.surface,
      child: const SecurityMetricsPanel(),
    );
  }

  // ── Shared session tile builder for drawer ───────────────────────────────

  Widget _buildSessionTile(
    ThemeData theme,
    ReviewProvider review,
    SessionSummary session,
  ) {
    final isSelected = review.selected?.sessionId == session.sessionId;
    final score = session.peakRiskScore;
    final hasEvents = session.eventCount > 0;
    final statusText = hasEvents
        ? (session.alertTriggered ? '⚠ ALERT' : 'active')
        : 'inactive';
    return ListTile(
      selected: isSelected,
      leading: hasEvents
          ? CircleAvatar(
              backgroundColor: _riskScoreColor(score, theme),
              radius: 14,
              child: Text(
                score.toStringAsFixed(0),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
              ),
            )
          : Icon(Icons.schedule, size: 28, color: theme.colorScheme.outline),
      title: Text(
        session.employeeId,
        style: theme.textTheme.bodyMedium?.copyWith(
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Text(
        '${session.sessionId}\nEvents: ${session.eventCount} | $statusText',
        style: theme.textTheme.bodySmall,
        overflow: TextOverflow.ellipsis,
        maxLines: 2,
      ),
      onTap: () {
        review.selectSession(session.sessionId);
        Navigator.pop(context);
      },
    );
  }
}
