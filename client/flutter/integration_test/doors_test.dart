import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// Into a building and back out by touch (#684), as the web playtest's "walking into a door takes
/// you inside" and "and walking into it again takes you out". The nearest door is asked of the game's
/// console (`doors`), the hero is put on its doorstep, and from there it is the stick: into the door,
/// and back out the way he came. The HUD says where he is, as it says it to a player.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('walks into a building by touch and back out again', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});
    final bearings = await stickBearings(tester);

    // the nearest door, as the console lists them: where to stand outside it, and the building
    final said = await typed(tester, '/doors');
    final found = doorIn(said);
    expect(found, isNotNull, reason: 'the console listed no doors: $said');
    final door = found!;
    passed('a door to walk into', {'door': door.line});

    // on its doorstep, through the console, and into it with the stick until the HUD names it
    final walked = await walkIn(tester, bearings, door);
    passed('on the doorstep', {'area': walked.outside});
    passed('walked in', {'place': walked.inside});
    await shot('door-inside');
    final within = walked.inside, inward = walked.inward;

    // and back out the way he came, once the door has rested
    String? out;
    for (var tries = 0; tries < 80 && out == null; tries++) {
      await lean(tester, -inward, const Duration(milliseconds: 500));
      final area = '${hudOf(session)['area']}';
      if (area != within) out = area;
    }
    expect(out, isNotNull, reason: 'leaning back never took him out of $within');
    passed('walked out', {'place': out});
    await shot('door-outside-again');
  }, timeout: const Timeout(Duration(minutes: 40)));
}
