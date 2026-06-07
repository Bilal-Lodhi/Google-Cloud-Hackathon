import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/health_provider.dart';
import '../providers/identity_provider.dart';
import '../providers/review_provider.dart';
import '../providers/guardian_provider.dart';
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
          // ── Compliance Matrix — primary CTA ──
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: FilledButton.icon(
              onPressed: () => ComplianceSheet.show(context),
              icon: const Icon(Icons.gavel, size: 20),
              label: const Text(
                'Compliance',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: theme.colorScheme.onPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                elevation: 2,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Logout / Switch Account button
          IconButton(
            icon: const Icon(Icons.logout, size: 20),
            tooltip: 'Logout / Switch Account',
            onPressed: () {
              showDialog(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Switch Account'),
                  content: const Text(
                    'Clear your current identity and return to the login screen? Your session will be ended.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed: () {
                        Navigator.pop(ctx);
                        context.read<IdentityProvider>().clearIdentity();
                      },
                      child: const Text('Logout'),
                    ),
                  ],
                ),
              );
            },
            visualDensity: VisualDensity.compact,
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
                    // Refresh sessions button
                    IconButton(
                      icon: Icon(
                        Icons.refresh,
                        size: 20,
                        color: theme.colorScheme.onPrimaryContainer.withValues(
                          alpha: 0.7,
                        ),
                      ),
                      tooltip: 'Refresh audit sessions',
                      onPressed: () => review.loadSessions(),
                      visualDensity: VisualDensity.compact,
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                    ),
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
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.cloud_off,
                            size: 36,
                            color: theme.colorScheme.error.withValues(
                              alpha: 0.6,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Error: ${review.error}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 16),
                          FilledButton.icon(
                            onPressed: () => review.loadSessions(),
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Retry'),
                            style: FilledButton.styleFrom(
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                        ],
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

    // ── Build content area (tappable) and trailing delete button ────────────
    // Uses a Card + InkWell + Row instead of ListTile to avoid Flutter's
    // gesture conflict where ListTile.onTap intercepts taps meant for the
    // trailing IconButton. See: flutter/flutter#15427, #21383.
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: isSelected
          ? theme.colorScheme.primaryContainer.withValues(alpha: 0.4)
          : Colors.transparent,
      shape: isSelected
          ? Border(left: BorderSide(color: theme.colorScheme.primary, width: 3))
          : const Border(),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            // ── Tappable content area (InkWell only wraps this part) ──
            Expanded(
              child: InkWell(
                onTap: () {
                  // Reset guardian provider state so the right panel clears
                  // and loads the new session's timeline from scratch.
                  context.read<GuardianProvider>().resetForNewSession(
                    session.sessionId,
                  );
                  review.selectSession(session.sessionId);
                  Navigator.pop(context);
                },
                child: Row(
                  children: [
                    // ── Leading avatar / icon ──
                    if (hasEvents)
                      CircleAvatar(
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
                    else
                      Icon(
                        Icons.schedule,
                        size: 28,
                        color: theme.colorScheme.outline,
                      ),
                    const SizedBox(width: 16),
                    // ── Title + subtitle ──
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            session.employeeId,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${session.sessionId}\nEvents: ${session.eventCount} | $statusText',
                            style: theme.textTheme.bodySmall,
                            overflow: TextOverflow.ellipsis,
                            maxLines: 2,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 8),
            // ── Delete button OUTSIDE InkWell — independent gesture zone ──
            IconButton(
              icon: Icon(
                Icons.delete_outline,
                size: 18,
                color: theme.colorScheme.error.withValues(alpha: 0.7),
              ),
              tooltip: 'Delete session',
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Terminate Session'),
                    content: Text(
                      'Permanently delete audit session for '
                      '${session.employeeId}?\n\n'
                      'Session ID: ${session.sessionId}',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Cancel'),
                      ),
                      FilledButton(
                        onPressed: () {
                          Navigator.pop(ctx);
                          review.deleteSession(session.sessionId);
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor: theme.colorScheme.error,
                        ),
                        child: const Text('Delete'),
                      ),
                    ],
                  ),
                );
              },
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
          ],
        ),
      ),
    );
  }
}
