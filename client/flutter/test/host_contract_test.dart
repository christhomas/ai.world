import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ai_world_flutter/src/host_contract.dart';

void main() {
  final fixture = jsonDecode(File('../../shared/mobile/fixtures/session-v1.json').readAsStringSync()) as Map<String, dynamic>;
  test('identical fixture validates and preserves Float64 precision', () {
    final gate = HostRequestGate('fixture:1');
    expect(gate.accept(fixture['start'])['type'], 'start');
    expect(gate.accept(fixture['step'])['payload']['tick'], 0);
    final scalars = (fixture['scalars'] as List).map((dynamic n) => (n as num).toDouble()).toList();
    expect(decodeHostScalars(encodeHostScalars(scalars)), scalars);
    final bytes = encodeHostScalars(scalars);
    expect(() => decodeHostScalars(bytes.sublist(0, bytes.length - 1)), throwsFormatException);
  });
  test('unknown version, stale session and invalid messages are rejected', () {
    final start = Map<String, dynamic>.from(fixture['start'] as Map);
    expect(() => validateHostRequest({...start, 'version': 25}), throwsFormatException);
    expect(() => validateHostRequest({...start, 'type': 'wat'}), throwsFormatException);
    final gate = HostRequestGate('fixture:1');
    expect(() => gate.accept({...start, 'session': 'old'}), throwsFormatException);
    expect(() => gate.accept(fixture['step']), throwsFormatException);
    expect(gate.accept(start)['sequence'], 0);
    expect(() => gate.accept(start), throwsFormatException);
  });
  testWidgets('fake session renders shared presentation and accepts a touch action', (tester) async {
    final gate = HostRequestGate('fixture:1'); gate.accept(fixture['start']);
    final models = fixture['presentation']['models'] as Map;
    var accepted = false;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Column(children: [
      Text('Health ${models['hud']['health']}'),
      TextButton(onPressed: () { accepted = gate.accept(fixture['step'])['type'] == 'step'; }, child: Text(models['context']['label'] as String)),
    ]))));
    expect(find.text('Health 72'), findsOneWidget);
    await tester.tap(find.text('Talk')); await tester.pump();
    expect(accepted, isTrue);
  });
}
