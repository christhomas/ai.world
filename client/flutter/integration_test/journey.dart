import 'dart:convert';
import 'dart:io';

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/state_engine.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// What the installed-app journeys share (#584; docs/mobile/installed-journey.md). Every move is a
/// touch on the screen; what they read of the game is only to check that the touch did something.

/// Said to the runner (`tools/mobile/journey.py`), which photographs the screen with the OS's own
/// capture while the journey waits, so the native world is in the picture.
Future<void> shot(String name) async {
  // ignore: avoid_print
  print('JOURNEY_SHOT $name');
  await Future<void>.delayed(const Duration(seconds: 3));
}

/// A step passed, said to the runner for the report.
void passed(String step, [Map<String, Object?> facts = const {}]) {
  // ignore: avoid_print
  print('JOURNEY_STEP ${jsonEncode({'step': step, ...facts})}');
}

/// Keep the app drawing and wait for something to be so, or fail saying what never happened.
Future<T> until<T extends Object>(WidgetTester tester, T? Function() check, String what,
    {Duration within = const Duration(minutes: 10)}) async {
  final deadline = DateTime.now().add(within);
  while (DateTime.now().isBefore(deadline)) {
    final value = check();
    if (value != null && value != false) return value;
    await tester.pump(const Duration(milliseconds: 100));
    await Future<void>.delayed(const Duration(milliseconds: 250));
  }
  throw TestFailure('$what did not happen within $within');
}

/// The hero, as the game last said where he is.
Map<String, dynamic>? heroOf(GameSession? session) {
  final models = session?.presentation.value['models'] as Map?;
  final hero = models?['hero'] as Map?;
  return hero == null || hero['x'] is! num ? null : Map<String, dynamic>.from(hero);
}

/// The session the app is playing, once it is.
GameSession? get session => playing.value;

/// What the native renderer last drew, read back from its own target, and how much of it varies.
Future<({int width, int height, double spread})> drawn() async {
  final shot = await session!.pipeline!.renderer.snapshot();
  final pixels = shot.rgba;
  var sum = 0.0, squares = 0.0;
  var n = 0;
  for (var i = 0; i < pixels.length; i += 4 * 97) {
    final luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    sum += luma;
    squares += luma * luma;
    n++;
  }
  final mean = sum / n;
  return (width: shot.width, height: shot.height, spread: (squares / n - mean * mean).clamp(0, double.infinity).toDouble());
}

/// Where the journey writes down what the next launch must find: in the app's own storage, which a
/// reinstall over the same app keeps and a lost save would not explain away.
Future<File> notes() async => File('${await StateEngine.storageRoot()}/journey-left.json');

Future<void> remember(Map<String, Object?> left) async =>
  (await notes()).writeAsBytes(utf8.encode(jsonEncode(left)), flush: true);

Future<Map<String, dynamic>> recall() async => jsonDecode(await (await notes()).readAsString()) as Map<String, dynamic>;

/// Tap what a finger would tap, and give the app a moment to answer.
Future<void> press(WidgetTester tester, Key key) async {
  await until(tester, () => find.byKey(key).evaluate().isNotEmpty, 'something to press called $key', within: const Duration(minutes: 2));
  await tester.tap(find.byKey(key));
  await tester.pump(const Duration(milliseconds: 300));
}
