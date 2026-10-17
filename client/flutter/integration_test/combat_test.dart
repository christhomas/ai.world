import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// Combat by touch (#683): a creature put beside the hero through the game's console, walked up to
/// with the stick, struck with SWING until a blow lands, and GUARD held and let go. The game says
/// a blow landed the way it says it to a player who is listening: the sound of what was hit.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('a creature walked up to and struck by touch is struck, and the guard is held and let go', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});

    // which way the stick walks him is the camera's business, so it is measured, then he faces east
    final bearings = await stickBearings(tester);
    await lean(tester, leanFor(bearings, const Offset(1, 0)), const Duration(milliseconds: 400));
    passed('stick bearings measured', {'up': '${bearings.up}', 'right': '${bearings.right}'});

    // a goat, through the console as a player types it, a step and a half in front of him
    final said = (await typed(tester, '/spawn goat 1.6')).join(' ');
    final x = RegExp(r'\bx (-?[\d.]+)').firstMatch(said), z = RegExp(r'\bz (-?[\d.]+)').firstMatch(said);
    expect(x != null && z != null, isTrue, reason: 'the console did not say where the goat is: $said');
    final goat = (x: double.parse(x!.group(1)!), z: double.parse(z!.group(1)!));
    passed('a creature to fight', {'said': said});

    // walked up to with the stick, which also turns him to face it
    final left = await walkTo(tester, bearings, goat.x + 0.5, goat.z + 0.5, within: 1.3);
    passed('walked up to it', {'tiles': left});
    await shot('combat-facing');

    // SWING until a blow lands: the game sounds what it hit, and a miss sounds like air
    bool landed() => (hudOf(session)['sounds'] as List? ?? const []).any((cue) => '$cue'.startsWith('hit:'));
    expect(landed(), isFalse, reason: 'something was struck before anybody swung');
    var swings = 0;
    while (!landed() && swings < 12) {
      await tester.tap(find.text('SWING'));
      swings++;
      await tester.pump(const Duration(milliseconds: 100));
      await Future<void>.delayed(const Duration(milliseconds: 600));
    }
    final sounds = hudOf(session)['sounds'];
    expect(landed(), isTrue, reason: 'twelve swings and nothing struck: $sounds');
    passed('a blow landed', {'swings': swings, 'sounds': sounds});
    await shot('combat-struck');

    // GUARD held is held in the game, and let go is let go
    bool guarding() => (hudOf(session)['breath'] as Map?)?['guarding'] == true;
    final guard = await tester.startGesture(tester.getCenter(find.text('GUARD')));
    await until(tester, guarding, 'the guard going up', within: const Duration(seconds: 20));
    await guard.up();
    await until(tester, () => !guarding(), 'the guard coming down', within: const Duration(seconds: 20));
    passed('guard held and let go');
  }, timeout: const Timeout(Duration(minutes: 40)));
}
