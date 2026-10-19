import 'dart:convert';

import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// A shop by touch (#685): into a shop through its door with the stick, to the keeper's counter, the
/// action card's TALK, Buy, and the cheapest thing the purse runs to. The gold that went is checked
/// against the price on the row, and the thing against the pack; then Done, and the world's controls
/// are the world's again.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('walks into a shop, talks to the keeper and buys something by touch', (tester) async {
    await app.main();
    passed('world open', {'openMs': await openWorld(tester)});
    final bearings = await stickBearings(tester);

    // the nearest shop with a door, as the console lists them
    Door? door;
    for (final kind in ['store', 'smith', 'apothecary']) {
      door = doorIn(await typed(tester, '/doors $kind'));
      if (door != null) break;
    }
    expect(door, isNotNull, reason: 'the console listed no shop doors near here');
    final shop = door!;
    passed('a shop to walk into', {'door': shop.line});
    final walked = await walkIn(tester, bearings, shop);
    passed('in the shop', {'place': walked.inside});

    // where the keeper will talk, and the action card saying so
    await typed(tester, '/stand-at-counter');
    final action = await until(tester, () {
      final said = '${hudOf(session)['action'] ?? ''}';
      return said.startsWith('Talk to') ? said : null;
    }, 'the action card offering to talk', within: const Duration(minutes: 1));
    passed('at the counter', {'action': action});
    await shot('shop-counter');

    await tester.tap(find.text('TALK · USE'));
    final greeting = await toChoices(tester);
    passed('talking to the keeper', {'choices': greeting});
    await choose(tester, (label) => label == 'Buy');

    // the cheapest thing the purse runs to; one the shelf is out of is put back and the next tried
    int gold() => ((heroOf(session) ?? const {})['gold'] as num? ?? 0).toInt();
    final tried = <String>{};
    String? bought;
    int? paid;
    for (var attempt = 0; attempt < 6 && bought == null; attempt++) {
      final stock = await toChoices(tester);
      int? price(String label) => int.tryParse(RegExp(r' — (\d+)g').firstMatch(label)?.group(1) ?? '');
      // a map charts the country round the shop rather than going in the pack, so it is not the test
      final affordable = stock.where((label) => price(label) != null && price(label)! <= gold() && !tried.contains(label)
          && !label.contains('Map') && !label.contains('Chart')).toList()
        ..sort((a, b) => price(a)!.compareTo(price(b)!));
      expect(affordable, isNotEmpty, reason: 'nothing on $stock for ${gold()} gold');
      final pick = affordable.first;
      tried.add(pick);
      final before = gold();
      await choose(tester, (label) => label == pick);
      await toChoices(tester);
      // bought is paid for: the keeper says so over two pages, and the purse says it in one number
      if (before - gold() == price(pick)) {
        bought = pick;
        paid = price(pick);
      } else {
        await choose(tester, (label) => label == 'Back');
      }
    }
    expect(bought, isNotNull, reason: 'six things tried and none could be bought: $tried');
    final name = RegExp(r'^\S+ (.+?) — ').firstMatch(bought!)?.group(1) ?? bought;
    final pack = jsonEncode((session!.presentation.value['models'] as Map?)?['pack']);
    expect(pack, contains(name), reason: 'bought $name and the pack does not have it: $pack');
    passed('bought something', {'item': name, 'paid': paid, 'gold': gold()});
    await shot('shop-bought');

    // done, and the world's controls are the world's again
    await choose(tester, (label) => label == 'Done');
    await until(tester, () => talkOf(session) == null && session!.presentation.value['owner'] == 'WORLD' ? true : null,
      'the conversation ending', within: const Duration(minutes: 1));
    passed('done talking');
  }, timeout: const Timeout(Duration(minutes: 40)));
}
