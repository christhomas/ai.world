import 'dart:convert';

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:flutter/material.dart' show ButtonStyleButton, InkWell;
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
  // what the screen said when the wait gave up, and a picture of it, so the report says why
  final said = find.byType(Text).evaluate().map((element) => (element.widget as Text).data).whereType<String>()
    .where((text) => text.trim().isNotEmpty).take(24).join(' | ');
  await shot('gave-up');
  throw TestFailure('$what did not happen within $within; the screen said: $said');
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

/// Whether what is under `key` answers a finger. A button the app has not turned on yet, such as
/// the title's while it is still reading storage, takes a tap and does nothing with it.
bool answers(Key key) {
  final at = find.byKey(key);
  if (at.evaluate().isEmpty) return false;
  final controls = find.descendant(of: at, matchRoot: true,
    matching: find.byWidgetPredicate((widget) => widget is ButtonStyleButton || widget is InkWell)).evaluate();
  return controls.every((element) {
    final widget = element.widget;
    return widget is ButtonStyleButton ? widget.enabled : (widget as InkWell).onTap != null;
  });
}

/// Tap what a finger would tap, once it answers, and give the app a moment to answer.
Future<void> press(WidgetTester tester, Key key) async {
  await until(tester, () => answers(key), 'something to press called $key', within: const Duration(minutes: 2));
  await tester.tap(find.byKey(key));
  await tester.pump(const Duration(milliseconds: 300));
}
