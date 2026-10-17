import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// A horse by touch (#686), as the web playtest's "the hero can get on a horse": one lent from the
/// stable through the console stands beside him, and the rest is the action card and the stick. He
/// gets on, rides further than the same lean walks him, and gets off; the action card says which he is.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('gets on a horse, rides it with the stick and gets off, by touch', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});
    String action() => '${hudOf(session)['action'] ?? ''}';

    // how far a lean walks him on foot, for the horse to be measured against
    Future<double> leaned() async {
      final from = heroOf(session)!;
      await lean(tester, const Offset(0, -1), const Duration(milliseconds: 2500));
      await Future<void>.delayed(const Duration(milliseconds: 500));
      return away(heroOf(session)!, (from['x'] as num).toDouble(), (from['z'] as num).toDouble());
    }
    final walked = await leaned();

    // a horse from the stable, beside him, and the action card offering to ride it
    final said = await typed(tester, '/borrow-horse');
    final ride = await until(tester, () => action().startsWith('Ride ') ? action() : null, 'the action card offering to ride',
      within: const Duration(minutes: 1));
    passed('a horse to ride', {'said': said, 'action': ride});

    await tester.tap(find.text('TALK · USE'));
    await until(tester, () => action() == 'Dismount' ? true : null, 'him in the saddle', within: const Duration(minutes: 1));
    passed('mounted');
    await shot('horse-mounted');

    // the same lean, in the saddle, carries him further, and he is still on the horse after it
    final rode = await leaned();
    expect(action(), 'Dismount', reason: 'he came off the horse while it was being ridden');
    expect(rode, greaterThan(walked * 1.2), reason: 'a lean rode him $rode tiles and walked him $walked');
    passed('rode by touch', {'walked': walked, 'rode': rode});
    await shot('horse-ridden');

    await tester.tap(find.text('TALK · USE'));
    await until(tester, () => action().startsWith('Ride ') ? true : null, 'him off the horse', within: const Duration(minutes: 1));
    passed('got off');
  }, timeout: const Timeout(Duration(minutes: 40)));
}
