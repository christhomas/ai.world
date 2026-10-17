import 'package:ai_world_flutter/main.dart' as app;
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
    final doors = await typed(tester, '/doors');
    int? field(String line, String name) => int.tryParse(RegExp('(?:^|, )$name (-?\\d+)').firstMatch(line)?.group(1) ?? '');
    final listed = doors.where((line) => field(line, 'bx') != null).firstOrNull;
    expect(listed, isNotNull, reason: 'the console listed no doors: $doors');
    final door = listed!;
    final step = (x: field(door, 'x')! + 0.5, z: field(door, 'z')! + 0.5);
    final inside = (x: field(door, 'bx')! + 0.5, z: field(door, 'bz')! + 0.5);
    passed('a door to walk into', {'door': door});

    // on its doorstep, through the console, and given a moment for the doorstep to know he is there
    await typed(tester, '/teleport ${step.x} ${step.z}');
    await until(tester, () => away(heroOf(session)!, step.x, step.z) < 1.5 ? true : null, 'the hero on the doorstep',
      within: const Duration(minutes: 3));
    await Future<void>.delayed(const Duration(seconds: 4));
    final outside = '${hudOf(session)['area']}';
    passed('on the doorstep', {'area': outside});
    await shot('door-outside');

    // into the door with the stick, toward the building, until the HUD says he is in it
    final inward = leanFor(bearings, Offset(inside.x - step.x, inside.z - step.z));
    String? within;
    for (var tries = 0; tries < 40 && within == null; tries++) {
      await lean(tester, inward, const Duration(milliseconds: 500));
      final area = '${hudOf(session)['area']}';
      if (area != outside && area.contains(' in ')) within = area;
    }
    expect(within, isNotNull, reason: 'leaning into the door never took him inside; the HUD said ${hudOf(session)['area']}');
    passed('walked in', {'place': within});
    await shot('door-inside');

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
