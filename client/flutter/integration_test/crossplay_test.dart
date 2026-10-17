import 'package:ai_world_flutter/main.dart' as app;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'journey.dart';

/// The cross-platform journey (#583): the installed app follows an invite into a shared world on a
/// real world server, where a web player is already standing (`tools/mobile/crossplay-web.cjs`), and
/// sees them there; it stays a while so the web player can see the phone back. The invite is given
/// at build time as `CROSSPLAY_INVITE`, because the emulator and the simulator reach the server
/// by different addresses.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('the phone and a web player meet in one shared world', (tester) async {
    const invite = String.fromEnvironment('CROSSPLAY_INVITE');
    expect(invite, isNotEmpty, reason: 'the runner gives the invite with --dart-define=CROSSPLAY_INVITE=…');
    await app.main();
    await press(tester, const ValueKey('join'));
    await tester.enterText(find.byKey(const ValueKey('invite')), invite);
    await press(tester, const ValueKey('join-world'));
    final hero = await until(tester, () => heroOf(session), 'the shared world opening');
    passed('joined a shared world', {'x': hero['x'], 'z': hero['z']});

    // the web player, by the name hung over their head
    final plates = await until(tester, () {
      final hud = (session?.presentation.value['models'] as Map?)?['hud'] as Map?;
      final hung = hud?['plates'] as List?;
      return hung == null || hung.isEmpty ? null : hung;
    }, 'another player appearing', within: const Duration(minutes: 10));
    passed('saw the web player', {'names': [for (final plate in plates) (plate as Map)['text']]});
    await shot('crossplay');

    // and stays, so the web player sees the phone too
    await Future<void>.delayed(const Duration(seconds: 30));
    passed('stayed for the web player');
  }, timeout: const Timeout(Duration(minutes: 30)));
}
