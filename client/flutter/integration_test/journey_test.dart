import 'dart:math' as math;

import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// The first installed journey, part one (#584): a fresh install opens a new offline world, shows it,
/// walks the hero by touch, opens and closes the pack, and saves and leaves. Part two
/// (`continue_test.dart`) is a new launch of the app, which must continue from here.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('a new offline world: see it, walk it by touch, open the pack, save and leave', (tester) async {
    await app.main();
    await press(tester, const ValueKey('new-game'));
    passed('new game');

    // the world opens and its ground arrives, and the renderer draws something that is not blank
    final opening = Stopwatch()..start();
    await until(tester, () => heroOf(session), 'the world opening');
    await until(tester, () => find.byKey(const ValueKey('ledger-pack')).evaluate().isNotEmpty, 'the playing shell');
    final world = await until(tester, () => session!.pipeline == null ? null : true, 'a renderer');
    expect(world, isTrue);
    var picture = await drawn();
    final seeing = Stopwatch()..start();
    while (picture.spread < 40 && seeing.elapsed < const Duration(minutes: 10)) {
      await Future<void>.delayed(const Duration(seconds: 2));
      picture = await drawn();
    }
    expect(picture.spread, greaterThan(40), reason: 'the native world is blank: ${picture.width}x${picture.height}');
    passed('world visible', {'openMs': opening.elapsedMilliseconds, 'framebuffer': '${picture.width}x${picture.height}', 'spread': picture.spread});
    await shot('world');

    // a thumb on the walk field, leaned forward, walks the hero; the game's own collision decides where
    final from = heroOf(session)!;
    final size = tester.view.physicalSize / tester.view.devicePixelRatio;
    final thumb = await tester.startGesture(Offset(size.width * 0.45, size.height * 0.6));
    await thumb.moveBy(const Offset(0, -20));
    await thumb.moveBy(const Offset(0, -34));
    await Future<void>.delayed(const Duration(seconds: 4));
    await thumb.up();
    await tester.pump(const Duration(milliseconds: 500));
    final to = heroOf(session)!;
    final walked = math.sqrt(math.pow((to['x'] as num) - (from['x'] as num), 2) + math.pow((to['z'] as num) - (from['z'] as num), 2));
    expect(walked, greaterThan(1), reason: 'a touch on the stick walked the hero $walked tiles, from $from to $to');
    passed('walked by touch', {'tiles': walked});
    await shot('walked');

    // the pack opens as a book, which parks the world, and closes again
    await press(tester, const ValueKey('ledger-pack'));
    await until(tester, () => find.text('RUCKSACK').evaluate().isNotEmpty, 'the pack opening');
    passed('pack open');
    await shot('pack');
    await press(tester, const ValueKey('ledger-Close'));
    await until(tester, () => find.text('RUCKSACK').evaluate().isEmpty, 'the pack closing');
    passed('pack closed');

    // where he stands is written down, then the game is saved and left from Options
    final left = heroOf(session)!;
    await remember({'x': left['x'], 'z': left['z'], 'playerId': left['playerId']});
    await press(tester, const ValueKey('ledger-options'));
    await press(tester, const ValueKey('save-and-leave'));
    await until(tester, () => find.byKey(const ValueKey('continue')).evaluate().isNotEmpty, 'the title with a game to continue');
    passed('saved and left', {'x': left['x'], 'z': left['z']});
    await shot('title');
  }, timeout: const Timeout(Duration(minutes: 30)));
}
