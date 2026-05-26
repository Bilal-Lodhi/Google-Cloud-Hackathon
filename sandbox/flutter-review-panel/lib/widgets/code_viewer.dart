/**
 * Code Viewer Widget — Syntax-highlighted, read-only code display
 * Displays the candidate's submitted solution with line numbers.
 * Zero external syntax-highlighting packages — uses Flutter's TextSpan.
 */

import 'package:flutter/material.dart';

class CodeViewer extends StatelessWidget {
  final String code;
  final String language;

  const CodeViewer({
    super.key,
    required this.code,
    this.language = 'javascript',
  });

  @override
  Widget build(BuildContext context) {
    final lines = code.split('\n');

    return Container(
      color: const Color(0xFF1E1E1E), // VSCode-dark background
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SingleChildScrollView(
          scrollDirection: Axis.vertical,
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Line numbers gutter
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: List.generate(
                  lines.length,
                  (i) => SizedBox(
                    height: 20,
                    child: Text(
                      '${i + 1}',
                      style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                        color: Colors.grey[600],
                        height: 1.5,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              // Code content
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: lines.map((line) {
                  return SizedBox(
                    height: 20,
                    child: RichText(text: _highlightSyntax(line)),
                  );
                }).toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Basic keyword-highlighting TextSpan builder
  TextSpan _highlightSyntax(String line) {
    if (line.trim().isEmpty) {
      return TextSpan(
        text: line.isEmpty ? ' ' : line,
        style: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 13,
          color: Colors.white,
          height: 1.5,
        ),
      );
    }

    // Tokenize keywords, strings, comments, and identifiers
    final List<TextSpan> spans = [];
    int i = 0;

    while (i < line.length) {
      // Check for comments (//)
      if (i + 1 < line.length && line[i] == '/' && line[i + 1] == '/') {
        spans.add(
          TextSpan(
            text: line.substring(i),
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13,
              color: Color(0xFF6A9955), // green comment
              height: 1.5,
            ),
          ),
        );
        break;
      }

      // Check for strings (single or double quoted)
      if (line[i] == '"' || line[i] == '\'') {
        final quote = line[i];
        final end = line.indexOf(quote, i + 1);
        final strEnd = end != -1 ? end + 1 : line.length;
        spans.add(
          TextSpan(
            text: line.substring(i, strEnd),
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13,
              color: Color(0xFFCE9178), // orange string
              height: 1.5,
            ),
          ),
        );
        i = strEnd;
        continue;
      }

      // Check for keywords
      final remaining = line.substring(i);
      final keywordMatch = _keywords.firstWhere(
        (kw) =>
            remaining.startsWith(kw) &&
            (remaining.length == kw.length ||
                !RegExp(r'[a-zA-Z0-9_]').hasMatch(remaining[kw])),
        orElse: () => '',
      );

      if (keywordMatch.isNotEmpty) {
        spans.add(
          TextSpan(
            text: keywordMatch,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 13,
              color: Color(0xFF569CD6), // blue keyword
              height: 1.5,
              fontWeight: FontWeight.bold,
            ),
          ),
        );
        i += keywordMatch.length;
        continue;
      }

      // Default character
      spans.add(
        TextSpan(
          text: line[i],
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 13,
            color: Color(0xFFD4D4D4), // default text
            height: 1.5,
          ),
        ),
      );
      i++;
    }

    return TextSpan(children: spans.isEmpty ? [TextSpan(text: ' ')] : spans);
  }

  static const _keywords = [
    'function',
    'const',
    'let',
    'var',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'import',
    'export',
    'default',
    'from',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'new',
    'this',
    'typeof',
    'instanceof',
    'true',
    'false',
    'null',
    'undefined',
    'int',
    'String',
    'bool',
    'void',
    'final',
    'required',
    'print',
    'Map',
    'List',
    'Set',
    'Future',
    'Stream',
  ];
}
