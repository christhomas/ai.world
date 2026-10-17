import 'dart:math' as math;

import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// The first installed journey, part two (#584): a new launch of the app, after the first was
/// stopped, continues the game it left, with the same hero standing where he was.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('a new launch continues the game that was left, where it was left', (tester) async {
    final left = await recall();
    await app.main();
    await press(tester, const ValueKey('continue'));
    final hero = await until(tester, () => heroOf(session), 'the game continuing');
    expect(hero['playerId'], left['playerId'], reason: 'the same hero, not a new one');
    final apart = math.sqrt(math.pow((hero['x'] as num) - (left['x'] as num), 2) + math.pow((hero['z'] as num) - (left['z'] as num), 2));
    expect(apart, lessThan(0.5), reason: 'continued at $hero, left at $left');
    passed('continued', {'apart': apart});
    await shot('continued');
  }, timeout: const Timeout(Duration(minutes: 30)));
}
