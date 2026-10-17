import 'package:ai_world_flutter/main.dart' as app;
import 'package:ai_world_flutter/src/screens/map_page.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// The books by touch (#687): a place found, its row in the journal, and the map it opens on. A place
/// is named to the game through its console (`discover`), as a traveller who has heard of it would;
/// the journal lists it, a tap on its row opens the map with the place marked, the map is panned
/// without the hero moving, and closing the book gives the world its controls back.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('follows a place from the journal onto the map by touch', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});

    // somewhere with a name, made found, as the console lists and names places
    final places = await typed(tester, '/places shrine');
    final named = places.map((line) => line.split(' — ').first.trim()).where((name) => name.isNotEmpty && name != 'nothing').firstOrNull;
    expect(named, isNotNull, reason: 'the console named no shrine: $places');
    final place = named!;
    await typed(tester, '/discover $place');
    passed('a place found', {'place': place});

    // the journal lists it, and its row knows where it is
    await press(tester, const ValueKey('ledger-journal'));
    final row = ValueKey('found-$place');
    await until(tester, () => find.byKey(row).evaluate().isNotEmpty ? true : null, 'the journal listing $place',
      within: const Duration(minutes: 1));
    passed('in the journal');
    await shot('map-journal');

    // a tap on the row opens the map on it
    await tester.tap(find.byKey(row));
    await until(tester, () => find.byType(MapPage).evaluate().isNotEmpty ? true : null, 'the map opening',
      within: const Duration(minutes: 1));
    final map = tester.widget<MapPage>(find.byType(MapPage));
    final journal = (session!.journal['found'] as List? ?? const []).cast<Map>().firstWhere((f) => f['name'] == place);
    final at = journal['at'] as Map;
    expect(map.focus, Offset((at['x'] as num).toDouble(), (at['z'] as num).toDouble()), reason: 'the map is not on $place');
    expect(session!.walked, isNotEmpty, reason: 'the country walked is not uncovered on the map');
    passed('on the map', {'focus': '${map.focus}', 'walked': session!.walked.length});
    await shot('map-place');

    // the map is the book's to move, not the hero's
    final hero = heroOf(session)!;
    final view = find.byKey(const ValueKey('map-view'));
    await tester.drag(view, const Offset(-120, 60));
    await tester.pump(const Duration(milliseconds: 500));
    await press(tester, const ValueKey('map-in'));
    await Future<void>.delayed(const Duration(seconds: 2));
    expect(away(heroOf(session)!, (hero['x'] as num).toDouble(), (hero['z'] as num).toDouble()), lessThan(0.05),
      reason: 'moving the map moved the hero');
    expect(session!.presentation.value['owner'], 'BOOK');
    passed('map moved, hero still');

    // closed, and the world has its controls again
    await press(tester, const ValueKey('ledger-Close'));
    await until(tester, () => session!.presentation.value['owner'] == 'WORLD' ? true : null, 'the world getting its controls back',
      within: const Duration(minutes: 1));
    passed('closed');
  }, timeout: const Timeout(Duration(minutes: 40)));
}
