import 'package:ai_world_flutter/main.dart' as app;
import 'package:ai_world_flutter/src/screens/map_page.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// Underground by touch (#688), as the web reference's shrine and the floor below it: into the
/// nearest shrine and down a floor through the game's console, with the HUD naming each, the world
/// drawn down there, and the map tab showing the floor rather than the country; then out again.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('goes into a shrine, down a floor and back out', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});
    String area() => '${hudOf(session)['area'] ?? ''}';

    final shrine = (await typed(tester, '/enter-shrine')).join(' ');
    final first = await until(tester, () => area().contains('Depths') ? area() : null, 'the HUD naming the shrine',
      within: const Duration(minutes: 3));
    await until(tester, () => session!.floor, 'the floor\'s map', within: const Duration(minutes: 1));
    final picture = await drawn();
    expect(picture.spread, greaterThan(10), reason: 'nothing drawn underground: ${picture.width}x${picture.height}');
    passed('in the shrine', {'shrine': shrine, 'area': first, 'spread': picture.spread});
    await shot('dungeon-first');

    // the map is the floor's down here, not the country's
    await press(tester, const ValueKey('ledger-map'));
    await until(tester, () => find.byType(MapPage).evaluate().isNotEmpty ? true : null, 'the map opening',
      within: const Duration(minutes: 1));
    expect(tester.widget<MapPage>(find.byType(MapPage)).floor, isNotNull, reason: 'the map underground is not the floor');
    passed('the floor on the map');
    await shot('dungeon-map');
    await press(tester, const ValueKey('ledger-Close'));

    await typed(tester, '/descend');
    final second = await until(tester, () => area().contains('floor 2') ? area() : null, 'the HUD naming the floor below',
      within: const Duration(minutes: 3));
    passed('a floor down', {'area': second});
    await shot('dungeon-second');

    await typed(tester, '/climb-out');
    await until(tester, () => session!.floor == null && !area().contains('Depths') ? true : null, 'the hero back on the surface',
      within: const Duration(minutes: 3));
    passed('back on the surface', {'area': area()});
  }, timeout: const Timeout(Duration(minutes: 40)));
}
