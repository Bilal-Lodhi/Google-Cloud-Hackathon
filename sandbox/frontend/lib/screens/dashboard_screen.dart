import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/theme_provider.dart';
import '../providers/health_provider.dart';
import '../providers/guardian_provider.dart';
import '../providers/review_provider.dart';
import '../widgets/code_workspace_panel.dart';
import '../widgets/security_metrics_panel.dart';

/// ─── Cerberus AI — Dashboard Screen (Split-View Analytical Review Log) ──────
/// Uses LayoutBuilder to decide between a side-by-side Row (wide screens) or
/// a TabBar / vertical stack (narrow screens). Displays candidate code
/// (left/near) and security metrics timeline (right/far).

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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initialLoad();
    });
  }

  Future<void> _initialLoad() async {
    final healthProvider = context.read<HealthProvider>();
    final reviewProvider = context.read<ReviewProvider>();
    if (!mounted) return;
    await healthProvider.checkHealth();
    if (!mounted) return;
    await reviewProvider.loadReviews();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _buildAppBar(context),
      drawer: _buildDrawer(context),
      body: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth >= 900) {
            return _buildWideLayout();
          } else {
            return _buildNarrowLayout();
          }
        },
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(BuildContext context) {
    final theme = Theme.of(context);
    final themeProvider = context.watch<ThemeProvider>();
    final guardian = context.watch<GuardianProvider>();

    return AppBar(
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.security, color: theme.colorScheme.primary),
          const SizedBox(width: 10),
          const Text('Cerberus AI — Review Log'),
        ],
      ),
      actions: [
        // Guardian streaming indicator
        if (guardian.isStreaming)
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(
                  width: 10,
                  height: 10,
                  child: CircularProgressIndicator(strokeWidth: 1.5),
                ),
                const SizedBox(width: 6),
                Text(
                  'Guardian Active',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
              ],
            ),
          ),
        // Dark mode toggle
        IconButton(
          icon: Icon(
            themeProvider.isDarkMode ? Icons.light_mode : Icons.dark_mode,
          ),
          tooltip: 'Toggle dark mode',
          onPressed: () => themeProvider.toggleDarkMode(),
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  Widget _buildDrawer(BuildContext context) {
    final theme = Theme.of(context);
    final health = context.watch<HealthProvider>();
    final review = context.watch<ReviewProvider>();

    return Drawer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DrawerHeader(
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Icon(
                  Icons.security,
                  size: 36,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
                const SizedBox(height: 8),
                Text(
                  'Cerberus AI',
                  style: theme.textTheme.titleLarge?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  'Agentic Assessment Platform',
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
          // Review records list
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('REVIEW RECORDS', style: theme.textTheme.labelSmall),
          ),
          Expanded(
            child: review.isLoading
                ? const Center(child: CircularProgressIndicator())
                : review.records.isEmpty
                ? Center(
                    child: Text(
                      'No review records',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                  )
                : ListView.builder(
                    itemCount: review.records.length,
                    itemBuilder: (context, index) {
                      final record = review.records[index];
                      final isSelected =
                          review.selected?.recordId == record.recordId;
                      return ListTile(
                        selected: isSelected,
                        leading: CircleAvatar(
                          backgroundColor: _suspicionColor(
                            record.suspicion.severity,
                            theme,
                          ),
                          radius: 14,
                          child: Text(
                            record.suspicion.suspicionScore.toStringAsFixed(0),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        title: Text(
                          record.candidateName,
                          style: theme.textTheme.bodyMedium,
                        ),
                        subtitle: Text(
                          record.problemTitle,
                          style: theme.textTheme.bodySmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () {
                          review.selectRecord(record);
                          Navigator.pop(context);
                        },
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
        // Left panel — Code workspace
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
        // Right panel — Security metrics
        Expanded(
          flex: 4,
          child: Container(
            color: theme.colorScheme.surface,
            child: const SecurityMetricsPanel(),
          ),
        ),
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
            Tab(icon: Icon(Icons.code), text: 'Code'),
            Tab(icon: Icon(Icons.shield), text: 'Security'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: const [CodeWorkspacePanel(), SecurityMetricsPanel()],
          ),
        ),
      ],
    );
  }

  Color _suspicionColor(String severity, ThemeData theme) {
    switch (severity) {
      case 'critical':
        return Colors.red;
      case 'elevated':
        return Colors.orange;
      default:
        return theme.colorScheme.primary;
    }
  }
}
