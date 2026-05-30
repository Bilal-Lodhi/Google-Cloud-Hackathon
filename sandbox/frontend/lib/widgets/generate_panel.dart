import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/generate_model.dart';
import '../providers/generate_provider.dart';

/// ─── Cerberus AI — Generate Panel ───────────────────────────────────────────
/// Text prompt input → generate button → results / error with manual retry.
///
/// Auto-retry logic is handled by [GenerateProvider]; this widget only
/// surfaces the final state after auto-retries are exhausted (or success).

class GeneratePanel extends StatefulWidget {
  const GeneratePanel({super.key});

  @override
  State<GeneratePanel> createState() => _GeneratePanelState();
}

class _GeneratePanelState extends State<GeneratePanel> {
  final _promptController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _promptController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onGenerate() {
    final prompt = _promptController.text;
    if (prompt.trim().isEmpty) return;
    FocusScope.of(context).unfocus();
    context.read<GenerateProvider>().generate(prompt);
  }

  void _onRetry() {
    context.read<GenerateProvider>().retry();
  }

  @override
  Widget build(BuildContext context) {
    final gen = context.watch<GenerateProvider>();
    final theme = Theme.of(context);

    return Column(
      children: [
        // ── Header ──────────────────────────────────────────────────────
        _buildHeader(theme),
        const Divider(height: 1),
        // ── Prompt input ─────────────────────────────────────────────────
        _buildPromptInput(theme, gen.isLoading),
        const SizedBox(height: 12),
        // ── Body — loading / error / result ──────────────────────────────
        Expanded(child: _buildBody(theme, gen)),
      ],
    );
  }

  // ── Header ────────────────────────────────────────────────────────────────
  Widget _buildHeader(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Icon(Icons.auto_awesome, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            'Test Suite Generator',
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          // Reset button (visible when suite exists)
          Consumer<GenerateProvider>(
            builder: (_, gen, __) {
              if (gen.suite == null && gen.error == null) {
                return const SizedBox.shrink();
              }
              return IconButton(
                icon: Icon(
                  Icons.refresh,
                  size: 20,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                tooltip: 'Reset',
                onPressed: gen.isLoading
                    ? null
                    : () {
                        _promptController.clear();
                        context.read<GenerateProvider>().reset();
                      },
              );
            },
          ),
        ],
      ),
    );
  }

  // ── Prompt input ───────────────────────────────────────────────────────────
  Widget _buildPromptInput(ThemeData theme, bool isLoading) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: TextField(
        controller: _promptController,
        enabled: !isLoading,
        minLines: 2,
        maxLines: 4,
        textInputAction: TextInputAction.send,
        onSubmitted: isLoading ? null : (_) => _onGenerate(),
        decoration: InputDecoration(
          hintText: 'Describe the assessment you want to generate…',
          hintMaxLines: 2,
          filled: true,
          fillColor: theme.colorScheme.surfaceContainerHighest,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          suffixIcon: Padding(
            padding: const EdgeInsets.only(right: 4),
            child: isLoading
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: Padding(
                      padding: EdgeInsets.all(8),
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : IconButton(
                    icon: Icon(
                      Icons.send_rounded,
                      color: theme.colorScheme.primary,
                    ),
                    tooltip: 'Generate',
                    onPressed: _onGenerate,
                  ),
          ),
        ),
      ),
    );
  }

  // ── Body ───────────────────────────────────────────────────────────────────
  Widget _buildBody(ThemeData theme, GenerateProvider gen) {
    // ── Loading state ────────────────────────────────────────────────────
    if (gen.isLoading) {
      return _buildLoadingState(theme);
    }

    // ── Error state with manual retry ────────────────────────────────────
    if (gen.error != null) {
      return _buildErrorState(theme, gen);
    }

    // ── Result state ─────────────────────────────────────────────────────
    if (gen.suite != null) {
      return _buildResultState(theme, gen.suite!);
    }

    // ── Empty / initial state ────────────────────────────────────────────
    return _buildEmptyState(theme);
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  Widget _buildLoadingState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 48,
              height: 48,
              child: CircularProgressIndicator(strokeWidth: 3),
            ),
            const SizedBox(height: 20),
            Text(
              'Generating test suite…',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'This may take 10–30 seconds. Gemini is crafting a structured assessment.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Error + Retry ──────────────────────────────────────────────────────────
  Widget _buildErrorState(ThemeData theme, GenerateProvider gen) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_rounded,
              size: 56,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              'Generation Failed',
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.error,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Text(
                gen.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: gen.canManualRetry ? _onRetry : null,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: theme.colorScheme.onPrimary,
                padding: const EdgeInsets.symmetric(
                  horizontal: 28,
                  vertical: 12,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  Widget _buildResultState(ThemeData theme, GeneratedSuite suite) {
    // Use suite models from generate_model.dart; they're auto-imported
    return ListView(
      controller: _scrollController,
      padding: const EdgeInsets.all(16),
      children: [
        // Suite card
        _SuiteOverviewCard(suite: suite),
        const SizedBox(height: 16),
        // Roles section
        if (suite.roles.isNotEmpty) ...[
          _SectionHeader(
            title: 'Roles (${suite.roles.length})',
            icon: Icons.badge,
          ),
          const SizedBox(height: 8),
          ...suite.roles.map((r) => _RoleCard(role: r)),
          const SizedBox(height: 16),
        ],
        // Competencies section
        if (suite.competencies.isNotEmpty) ...[
          _SectionHeader(
            title: 'Competencies (${suite.competencies.length})',
            icon: Icons.checklist,
          ),
          const SizedBox(height: 8),
          ...suite.competencies.map((c) => _CompetencyCard(competency: c)),
          const SizedBox(height: 16),
        ],
        // Problems section
        if (suite.problems.isNotEmpty) ...[
          _SectionHeader(
            title: 'Problems (${suite.problems.length})',
            icon: Icons.quiz,
          ),
          const SizedBox(height: 8),
          ...suite.problems.map((p) => _ProblemCard(problem: p)),
          const SizedBox(height: 16),
        ],
        // Metadata footer
        _MetadataFooter(metadata: suite.metadata),
      ],
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  Widget _buildEmptyState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.auto_awesome,
              size: 48,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(height: 16),
            Text(
              'Autonomous Test Suite Generator',
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Enter a prompt above to generate a competency-based assessment suite '
              'powered by Gemini 3 Flash Preview.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-widgets: Result cards
// ═══════════════════════════════════════════════════════════════════════

class _SectionHeader extends StatelessWidget {
  final String title;
  final IconData icon;
  const _SectionHeader({required this.title, required this.icon});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 18, color: theme.colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.primary,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _SuiteOverviewCard extends StatelessWidget {
  final GeneratedSuite suite;
  const _SuiteOverviewCard({required this.suite});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: theme.colorScheme.primaryContainer,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              suite.title.isNotEmpty ? suite.title : 'Untitled Suite',
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Suite ID: ${suite.suiteId}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onPrimaryContainer.withValues(
                  alpha: 0.7,
                ),
                fontFamily: 'monospace',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  final Role role;
  const _RoleCard({required this.role});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.secondaryContainer,
          child: Text(
            role.weight.toString(),
            style: TextStyle(
              fontSize: 12,
              fontFamily: 'monospace',
              color: theme.colorScheme.onSecondaryContainer,
            ),
          ),
        ),
        title: Text(role.title, style: theme.textTheme.bodyMedium),
        subtitle: role.description.isNotEmpty
            ? Text(
                role.description,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall,
              )
            : null,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      ),
    );
  }
}

class _CompetencyCard extends StatelessWidget {
  final Competency competency;
  const _CompetencyCard({required this.competency});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scoreFraction = competency.maxScore > 0
        ? ' / ${competency.maxScore}'
        : '';
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: ListTile(
        leading: Icon(Icons.star, size: 20, color: theme.colorScheme.secondary),
        title: Text(competency.name, style: theme.textTheme.bodyMedium),
        subtitle: competency.rubric.isNotEmpty
            ? Text(
                competency.rubric,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall,
              )
            : null,
        trailing: Text(
          '0$scoreFraction',
          style: theme.textTheme.labelSmall?.copyWith(fontFamily: 'monospace'),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      ),
    );
  }
}

class _ProblemCard extends StatelessWidget {
  final Problem problem;
  const _ProblemCard({required this.problem});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final typeColor = switch (problem.type) {
      'coding' => Colors.teal,
      'multiple_choice' => Colors.orange,
      'design' => Colors.purple,
      'essay' => Colors.indigo,
      _ => theme.colorScheme.secondary,
    };
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: typeColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(
            problem.type.replaceAll('_', ' ').toUpperCase(),
            style: TextStyle(
              fontSize: 10,
              color: typeColor,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        title: Text(
          problem.prompt,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.bodyMedium,
        ),
        subtitle: Row(
          children: [
            Icon(Icons.timer, size: 14, color: theme.colorScheme.outline),
            const SizedBox(width: 4),
            Text(
              '${problem.timeLimitMinutes} min',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(width: 12),
            Icon(Icons.science, size: 14, color: theme.colorScheme.outline),
            const SizedBox(width: 4),
            Text(
              '${problem.testCases.length} tests',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      ),
    );
  }
}

class _MetadataFooter extends StatelessWidget {
  final SuiteMetadata metadata;
  const _MetadataFooter({required this.metadata});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final date = DateTime.tryParse(metadata.generatedAt);
    final formatted = date != null
        ? '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')} '
              '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}'
        : metadata.generatedAt;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Wrap(
        spacing: 16,
        runSpacing: 4,
        children: [
          _MetaChip(Icons.model_training, metadata.modelUsed),
          _MetaChip(Icons.memory, '${metadata.tokenCount} tokens'),
          _MetaChip(Icons.calendar_today, formatted),
          _MetaChip(Icons.info, 'v${metadata.schemaVersion}'),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MetaChip(this.icon, this.label);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: theme.colorScheme.outline),
        const SizedBox(width: 4),
        Text(label, style: theme.textTheme.labelSmall),
      ],
    );
  }
}
