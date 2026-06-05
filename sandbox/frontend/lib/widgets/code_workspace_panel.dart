import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/review_provider.dart';
import '../providers/guardian_provider.dart';
import '../models/guardian_model.dart';

/// ─── Cerberus FinSec — Interactive Employee Terminal Workspace ───────────────
/// Loads financial source code (SWIFT handler, ledger logic, etc.) for the
/// selected audit session into a live editable terminal. Every keystroke is
/// debounced (500 ms) and dispatched as a MicroEvent to the guardian ingest
/// pipeline so the middle-panel threat dashboard reflects real-time behavior.
class CodeWorkspacePanel extends StatefulWidget {
  const CodeWorkspacePanel({super.key});

  @override
  State<CodeWorkspacePanel> createState() => _CodeWorkspacePanelState();
}

class _CodeWorkspacePanelState extends State<CodeWorkspacePanel>
    with WidgetsBindingObserver {
  final TextEditingController _codeController = TextEditingController();
  Timer? _debounceTimer;
  bool _isSending = false;
  bool _copied = false;
  String _lastSessionId = '';
  String _previousText = '';
  final FocusNode _codeFocusNode = FocusNode();
  // Threshold: inserts > this many chars in one edit are classified as paste.
  // Must match backend's hasLargePaste check (≥100 chars) conceptually, but
  // we classify smaller batch edits as PASTE too for accurate paste tracking.
  static const int _pasteThreshold = 20;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _debounceTimer?.cancel();
    _codeFocusNode.dispose();
    _codeController.dispose();
    super.dispose();
  }

  // ── Copy handler: copies selected text (or full text if no selection) ──

  /// Copies the currently selected text (or the entire content if no
  /// selection exists) to the clipboard and dispatches a COPY_ATTEMPT
  /// telemetry event to the guardian ingest pipeline.
  Future<void> _handleCopy() async {
    if (_lastSessionId.isEmpty) return;

    // Read providers before any async gap
    final reviewProvider = context.read<ReviewProvider>();
    final guardianProvider = context.read<GuardianProvider>();
    final sessionId = _lastSessionId;

    final review = reviewProvider.selected;
    if (review == null) return;

    // Determine text to copy: prefer current selection, fall back to all
    final selection = _codeController.selection;
    final hasValidSelection =
        selection.isValid &&
        selection.start < selection.end &&
        selection.baseOffset >= 0 &&
        selection.extentOffset <= _codeController.text.length;
    final selectedText = hasValidSelection
        ? _codeController.text.substring(selection.start, selection.end)
        : '';
    final textToCopy = selectedText.isNotEmpty
        ? selectedText
        : _codeController.text;

    await Clipboard.setData(ClipboardData(text: textToCopy));

    if (!mounted) return;
    setState(() => _copied = true);
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });

    // Show SnackBar feedback
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            selectedText.isNotEmpty
                ? 'Copied ${textToCopy.length} characters (selected)'
                : 'Copied ${textToCopy.length} characters to clipboard',
          ),
          duration: const Duration(seconds: 2),
          behavior: SnackBarBehavior.floating,
          backgroundColor: const Color(0xFF1A1A2E),
          action: SnackBarAction(
            label: 'OK',
            textColor: Colors.greenAccent,
            onPressed: () {},
          ),
        ),
      );
    }

    // Build and send COPY_ATTEMPT telemetry event
    final previewLength = textToCopy.length > 100 ? 100 : textToCopy.length;
    final copyEvent = MicroEvent(
      sessionId: sessionId,
      employeeId: review.employeeId,
      auditId: review.auditId,
      eventType: 'COPY_ATTEMPT',
      payload: MicroEventPayload(
        copyContent: previewLength > 0
            ? textToCopy.substring(0, previewLength)
            : textToCopy,
        copiedLength: textToCopy.length,
      ),
      timestampEpochMs: DateTime.now().millisecondsSinceEpoch,
    );
    try {
      await guardianProvider.ingestEvents([copyEvent]);
    } catch (_) {
      // Silently swallow — keep working even if ingest is unavailable.
    }
  }

  // ── WidgetsBindingObserver: detect tab switch / window blur ───────────
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      _sendTabSwitchEvent();
    }
  }

  Future<void> _sendTabSwitchEvent() async {
    if (_lastSessionId.isEmpty) return;
    final review = context.read<ReviewProvider>().selected;
    if (review == null) return;

    final event = MicroEvent(
      sessionId: _lastSessionId,
      employeeId: review.employeeId,
      auditId: review.auditId,
      eventType: 'TAB_SWITCH',
      payload: const MicroEventPayload(windowEvent: 'blur'),
      timestampEpochMs: DateTime.now().millisecondsSinceEpoch,
    );

    try {
      await context.read<GuardianProvider>().ingestEvents([event]);
    } catch (_) {
      // Silently swallow — keep working even if ingest is unavailable.
    }
  }

  // ── Boilerplate snippets keyed by target system ──────────────────────────
  String _boilerplateFor(String? targetSystem) {
    switch ((targetSystem ?? '').toLowerCase()) {
      case 'swift gateway':
        return '''// SWIFT MT103 Single Customer Credit Transfer
// Employee Terminal — ISO 15022 Format Handler
class SwiftMT103Handler {
  final String senderBIC;
  final String receiverBIC;
  final double amount;
  final String currency;

  SwiftMT103Handler({
    required this.senderBIC,
    required this.receiverBIC,
    required this.amount,
    required this.currency,
  });

  String generateMessage() {
    // :20: Transaction Reference
    // :32A: Value Date / Currency / Amount
    // :50K: Ordering Customer
    // :59: Beneficiary Customer
    return '{1:F01\${senderBIC}XXXX0000000000}'
        '{2:I103\${receiverBIC}XXXXXN}'
        '{4:\\n'
        ':20:REF\${DateTime.now().millisecondsSinceEpoch}\\n'
        ':32A:\${DateTime.now().toIso8601String().substring(0, 10).replaceAll("-", "")}\${currency}\${amount.toStringAsFixed(2)}\\n'
        ':50K:CERBERUS FINANCIAL\\\\n'
        ':59:BENEFICIARY ACCOUNT\\\\n'
        '-}';
  }
}
''';
      case 'core trading ledger':
        return '''// Core Trading Ledger — Position Book Handler
// Employee Terminal — Real-Time P&L Calculator
class TradingLedgerPosition {
  final String instrumentId;
  final String bookId;
  double unrealizedPnL = 0.0;
  double realizedPnL = 0.0;
  int position = 0;

  TradingLedgerPosition({
    required this.instrumentId,
    required this.bookId,
  });

  void applyFill(String side, int quantity, double price) {
    if (side == 'BUY') {
      position += quantity;
      unrealizedPnL -= quantity * price;
    } else {
      position -= quantity;
      unrealizedPnL += quantity * price;
    }
  }

  double markToMarket(double currentPrice) {
    unrealizedPnL = position * currentPrice + realizedPnL;
    return unrealizedPnL;
  }

  Map<String, dynamic> toJournalEntry() => {
    'instrumentId': instrumentId,
    'bookId': bookId,
    'position': position,
    'unrealizedPnL': unrealizedPnL,
    'realizedPnL': realizedPnL,
  };
}
''';
      case 'finra 3110':
        return '''// FINRA Rule 3110 — Supervisory Controls Audit Handler
// Employee Terminal — Branch Office Inspection Compliance
class FINRA3110SupervisoryReview {
  final String branchOfficeId;
  final String reviewerRegNumber;
  final List<String> inspectionChecklist;
  DateTime? lastInspectionDate;
  String? inspectionStatus;

  FINRA3110SupervisoryReview({
    required this.branchOfficeId,
    required this.reviewerRegNumber,
    required this.inspectionChecklist,
  });

  bool get isOverdue {
    if (lastInspectionDate == null) return true;
    return DateTime.now().difference(lastInspectionDate!).inDays > 365;
  }

  Map<String, dynamic> generateInspectionReport() {
    final completedItems = inspectionChecklist
        .where((item) => item.startsWith('[x]'))
        .length;
    return {
      'branchOfficeId': branchOfficeId,
      'reviewerRegNumber': reviewerRegNumber,
      'lastInspectionDate': lastInspectionDate?.toIso8601String(),
      'isOverdue': isOverdue,
      'completionPct':
          (completedItems / inspectionChecklist.length * 100).toStringAsFixed(1),
      'status': inspectionStatus ?? 'PENDING',
    };
  }
}
''';
      default:
        return '''// Cerberus FinSec — Financial Terminal Workspace
// Employee: ${_employeeIdForCurrentSession()}
// Session: $_lastSessionId
//
// This terminal is monitored by the Cerberus Guardian.
// All code edits are streamed as behavioral telemetry.

void main() {
  // Write your financial operation logic here
  print('Cerberus FinSec Terminal — Active');
}
''';
    }
  }

  String _employeeIdForCurrentSession() {
    final review = context.read<ReviewProvider>().selected;
    return review?.employeeId ?? 'UNKNOWN_OPERATOR';
  }

  /// Computes the signed length delta between old and new text. Positive
  /// means insertion, negative means deletion, zero means pure replacement.
  int _computeChangeLength(String oldText, String newText) {
    return newText.length - oldText.length;
  }

  /// Dispatches a micro-event to the guardian ingest pipeline after a
  /// 500 ms debounce window. Detects paste (large insert) vs. normal
  /// EDIT events and sends the full terminal snapshot with the change
  /// length so the server-side risk engine can score behavioral shifts.
  void _onCodeChanged() {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () async {
      if (_isSending || _lastSessionId.isEmpty) return;

      final review = context.read<ReviewProvider>().selected;
      if (review == null) return;

      final guardian = context.read<GuardianProvider>();
      final currentCode = _codeController.text;

      // No actual change — skip sending
      if (currentCode == _previousText) return;

      final changeLength = _computeChangeLength(_previousText, currentCode);

      // Classify as PASTE if a large block of text was inserted in one edit
      final isPaste = changeLength >= _pasteThreshold;

      final previous = _previousText;
      _previousText = currentCode;

      setState(() => _isSending = true);

      try {
        final event = MicroEvent(
          sessionId: _lastSessionId,
          employeeId: review.employeeId,
          auditId: review.auditId,
          eventType: isPaste ? 'PASTE' : 'EDIT',
          payload: MicroEventPayload(
            newText: currentCode,
            changeLength: changeLength,
          ),
          timestampEpochMs: DateTime.now().millisecondsSinceEpoch,
        );

        await guardian.ingestEvents([event]);
      } catch (_) {
        // Restore previous text on failure so the next diff is accurate
        _previousText = previous;
        // Silently swallow — the terminal keeps working even if the
        // ingest pipeline is temporarily unavailable.
      } finally {
        if (mounted) setState(() => _isSending = false);
      }
    });
  }

  /// Loads boilerplate financial source code when a session becomes active.
  void _loadSessionCode() {
    final review = context.read<ReviewProvider>().selected;
    if (review == null) return;

    // Only reload if the session changed
    if (review.sessionId == _lastSessionId) return;
    _lastSessionId = review.sessionId;

    final existing = review.codeSubmission;
    if (existing.isNotEmpty) {
      _codeController.text = existing;
    } else {
      _codeController.text = _boilerplateFor(review.targetSystem);
    }
    // Seed previous text so the first edit computes an accurate changeLength
    _previousText = _codeController.text;
  }

  @override
  Widget build(BuildContext context) {
    final review = context.watch<ReviewProvider>().selected;

    // Load boilerplate when session becomes active
    if (review != null && review.sessionId != _lastSessionId) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _loadSessionCode());
    }

    if (review == null) {
      return _buildEmptyState(context);
    }

    return _buildInteractiveTerminal(context);
  }

  Widget _buildEmptyState(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.terminal, size: 64, color: theme.colorScheme.outline),
          const SizedBox(height: 16),
          Text(
            'Employee Terminal Workspace',
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Select an active audit session\nfrom the left drawer to begin',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInteractiveTerminal(BuildContext context) {
    final theme = Theme.of(context);
    final review = context.watch<ReviewProvider>().selected!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // ── Terminal Header Bar ─────────────────────────────────────────
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFF1A1A2E),
            border: Border(
              bottom: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.3),
              ),
            ),
          ),
          child: Row(
            children: [
              // Traffic-light dots
              _terminalDot(Colors.redAccent),
              const SizedBox(width: 6),
              _terminalDot(Colors.amberAccent),
              const SizedBox(width: 6),
              _terminalDot(Colors.greenAccent),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  '${review.targetSystem.isNotEmpty ? review.targetSystem : 'FINANCIAL TERMINAL'} — ${review.employeeId}',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: Colors.white70,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (_isSending)
                SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: Colors.greenAccent,
                  ),
                )
              else
                Icon(Icons.cloud_done, size: 16, color: Colors.greenAccent),
              const SizedBox(width: 8),
              // DETAILS button — opens risk notification when threats are detected
              Builder(
                builder: (context) {
                  final guardian = context.watch<GuardianProvider>();
                  final hasRisk =
                      guardian.latestRiskPayload != null &&
                      guardian.events.isNotEmpty;
                  if (hasRisk) {
                    return Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: SizedBox(
                        height: 30,
                        child: ElevatedButton.icon(
                          onPressed: () =>
                              guardian.openLatestNotification(context),
                          icon: const Icon(Icons.visibility, size: 14),
                          label: const Text(
                            'DETAILS',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 10,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.red,
                            foregroundColor: Colors.white,
                            elevation: 1,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(6),
                            ),
                          ),
                        ),
                      ),
                    );
                  }
                  return const SizedBox.shrink();
                },
              ),
              IconButton(
                icon: Icon(
                  _copied ? Icons.check : Icons.copy,
                  size: 18,
                  color: _copied ? Colors.greenAccent : Colors.white54,
                ),
                tooltip: _copied ? 'Copied to clipboard' : 'Copy selected text',
                onPressed: _handleCopy,
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: 4),
              IconButton(
                icon: const Icon(Icons.close, size: 18, color: Colors.white54),
                tooltip: 'Close this session (keeps it active)',
                onPressed: () {
                  final guardian = context.read<GuardianProvider>();
                  final review = context.read<ReviewProvider>();
                  guardian.stopStreaming();
                  review.clearSelection();
                  _lastSessionId = '';
                  _codeController.clear();
                  _previousText = '';
                },
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: 2),
              IconButton(
                icon: const Icon(
                  Icons.stop_circle_outlined,
                  size: 18,
                  color: Colors.redAccent,
                ),
                tooltip: 'Kill session (terminate on backend)',
                onPressed: () {
                  final review = context.read<ReviewProvider>();
                  final guardian = context.read<GuardianProvider>();
                  final sid = _lastSessionId;
                  guardian.stopStreaming();
                  review.clearSelection();
                  _lastSessionId = '';
                  _codeController.clear();
                  _previousText = '';
                  if (sid.isNotEmpty) {
                    guardian.terminateSession(sid);
                  }
                },
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ),

        // ── Interactive Code Editor Body ────────────────────────────────
        Expanded(
          child: Container(
            color: const Color(0xFF0D0D1A),
            child: Focus(
              onKeyEvent: (node, event) {
                if (event is KeyDownEvent || event is KeyRepeatEvent) {
                  final isCtrlPressed = Platform.isMacOS
                      ? HardwareKeyboard.instance.isMetaPressed
                      : HardwareKeyboard.instance.isControlPressed;
                  if (isCtrlPressed &&
                      event.logicalKey == LogicalKeyboardKey.keyC) {
                    _handleCopy();
                    return KeyEventResult.handled;
                  }
                }
                return KeyEventResult.ignored;
              },
              child: TextField(
                focusNode: _codeFocusNode,
                controller: _codeController,
                onChanged: (_) => _onCodeChanged(),
                maxLines: null,
                expands: true,
                textAlignVertical: TextAlignVertical.top,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  height: 1.6,
                  color: Color(0xFF00FF88), // Terminal green
                ),
                decoration: InputDecoration(
                  contentPadding: const EdgeInsets.all(16),
                  border: InputBorder.none,
                  hintText: '// Type financial logic here...',
                  hintStyle: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: Colors.white24,
                  ),
                ),
                cursorColor: const Color(0xFF00FF88),
                keyboardType: TextInputType.multiline,
              ),
            ),
          ),
        ),

        // ── Status Footer ───────────────────────────────────────────────
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: const BoxDecoration(color: Color(0xFF15152A)),
          child: Row(
            children: [
              Icon(Icons.assignment, size: 14, color: Colors.white38),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Session: ${review.sessionId.length > 8 ? '${review.sessionId.substring(0, 8)}…' : review.sessionId} | '
                  'Status: ${review.status.toUpperCase()} | '
                  'Lines: ${_codeController.text.split('\n').length}',
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 10,
                    color: Colors.white38,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _terminalDot(Color color) {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.6),
            blurRadius: 4,
            spreadRadius: 1,
          ),
        ],
      ),
    );
  }
}
