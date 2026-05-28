class GeneratedSuite {
  /// ─── Cerberus AI — Test Suite Generator Model ─────────────────────────────
  /// Models the structured JSON output contract from the Orchestrator Agent
  /// when it converts a text prompt into a full competency-based assessment.
  final String suiteId;
  final String title;
  final String promptHash;
  final SuiteMetadata metadata;
  final List<Role> roles;
  final List<Competency> competencies;
  final List<Problem> problems;
  final TestingMatrix testingMatrix;

  const GeneratedSuite({
    required this.suiteId,
    required this.title,
    required this.promptHash,
    required this.metadata,
    required this.roles,
    required this.competencies,
    required this.problems,
    required this.testingMatrix,
  });

  factory GeneratedSuite.fromJson(Map<String, dynamic> json) {
    return GeneratedSuite(
      suiteId: json['suite_id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      promptHash: json['prompt_hash'] as String? ?? '',
      metadata: SuiteMetadata.fromJson(
        json['metadata'] as Map<String, dynamic>? ?? const {},
      ),
      roles: (json['roles'] as List<dynamic>? ?? [])
          .map((r) => Role.fromJson(r as Map<String, dynamic>))
          .toList(),
      competencies: (json['competencies'] as List<dynamic>? ?? [])
          .map((c) => Competency.fromJson(c as Map<String, dynamic>))
          .toList(),
      problems: (json['problems'] as List<dynamic>? ?? [])
          .map((p) => Problem.fromJson(p as Map<String, dynamic>))
          .toList(),
      testingMatrix: TestingMatrix.fromJson(
        json['testing_matrix'] as Map<String, dynamic>? ?? const {},
      ),
    );
  }
}

class SuiteMetadata {
  final String modelUsed;
  final String generatedAt;
  final int tokenCount;
  final String schemaVersion;

  const SuiteMetadata({
    required this.modelUsed,
    required this.generatedAt,
    required this.tokenCount,
    required this.schemaVersion,
  });

  factory SuiteMetadata.fromJson(Map<String, dynamic> json) {
    return SuiteMetadata(
      modelUsed: json['model_used'] as String? ?? 'gemini-2.5-flash',
      generatedAt: json['generated_at'] as String? ?? '',
      tokenCount: json['token_count'] as int? ?? 0,
      schemaVersion: json['schema_version'] as String? ?? '1.0',
    );
  }
}

class Role {
  final String id;
  final String title;
  final String description;
  final int weight;

  const Role({
    required this.id,
    required this.title,
    required this.description,
    required this.weight,
  });

  factory Role.fromJson(Map<String, dynamic> json) {
    return Role(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String? ?? '',
      weight: json['weight'] as int? ?? 0,
    );
  }
}

class Competency {
  final String id;
  final String roleId;
  final String name;
  final String rubric;
  final int maxScore;

  const Competency({
    required this.id,
    required this.roleId,
    required this.name,
    required this.rubric,
    required this.maxScore,
  });

  factory Competency.fromJson(Map<String, dynamic> json) {
    return Competency(
      id: json['id'] as String? ?? '',
      roleId: json['role_id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      rubric: json['rubric'] as String? ?? '',
      maxScore: json['max_score'] as int? ?? 0,
    );
  }
}

class Problem {
  final String id;
  final String competencyId;
  final String type; // "coding" | "multiple_choice" | "design" | "essay"
  final String prompt;
  final String starterCode;
  final int timeLimitMinutes;
  final List<TestCase> testCases;

  const Problem({
    required this.id,
    required this.competencyId,
    required this.type,
    required this.prompt,
    required this.starterCode,
    required this.timeLimitMinutes,
    required this.testCases,
  });

  factory Problem.fromJson(Map<String, dynamic> json) {
    return Problem(
      id: json['id'] as String? ?? '',
      competencyId: json['competency_id'] as String? ?? '',
      type: json['type'] as String? ?? 'coding',
      prompt: json['prompt'] as String? ?? '',
      starterCode: json['starter_code'] as String? ?? '',
      timeLimitMinutes: json['time_limit_minutes'] as int? ?? 30,
      testCases: (json['test_cases'] as List<dynamic>? ?? [])
          .map((t) => TestCase.fromJson(t as Map<String, dynamic>))
          .toList(),
    );
  }
}

class TestCase {
  final String id;
  final String input;
  final String expectedOutput;
  final bool hidden;
  final int weight;

  const TestCase({
    required this.id,
    required this.input,
    required this.expectedOutput,
    required this.hidden,
    required this.weight,
  });

  factory TestCase.fromJson(Map<String, dynamic> json) {
    return TestCase(
      id: json['id'] as String? ?? '',
      input: json['input'] as String? ?? '',
      expectedOutput: json['expected_output'] as String? ?? '',
      hidden: json['hidden'] as bool? ?? false,
      weight: json['weight'] as int? ?? 1,
    );
  }
}

class TestingMatrix {
  final List<String> integrityHashes;
  final String version;

  const TestingMatrix({required this.integrityHashes, required this.version});

  factory TestingMatrix.fromJson(Map<String, dynamic> json) {
    return TestingMatrix(
      integrityHashes: List<String>.from(
        (json['integrity_hashes'] as List<dynamic>?) ?? [],
      ),
      version: json['version'] as String? ?? '1.0',
    );
  }
}
