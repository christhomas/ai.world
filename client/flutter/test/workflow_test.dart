import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the Flutter CI job grants read-only access and pins every action by commit', () {
    final workflow = File('../../.github/workflows/checks.yml')
        .readAsStringSync();
    expect(workflow, contains('\npermissions:\n  contents: read\n'));

    final flutterStart = workflow.indexOf('\n  flutter:');
    final nextJob = workflow.indexOf('\n  playtest:', flutterStart);
    expect(flutterStart, greaterThanOrEqualTo(0));
    expect(nextJob, greaterThan(flutterStart));
    final flutterJob = workflow.substring(flutterStart, nextJob);
    final uses = RegExp(
      r'^\s*- uses: ([^\s]+)',
      multiLine: true,
    ).allMatches(flutterJob).map((match) => match.group(1)!).toList();

    expect(uses, hasLength(3));
    for (final action in uses) {
      expect(action, matches(RegExp(r'^[^@]+@[0-9a-f]{40}$')), reason: action);
    }
  });
}
