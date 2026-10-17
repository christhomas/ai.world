import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:ai_world_flutter/src/app_shell.dart';
import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/state_engine.dart';
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

/// Where the journey writes down what the next launch must find: in the app's own storage, which a
/// reinstall over the same app keeps and a lost save would not explain away.
Future<File> notes() async => File('${await StateEngine.storageRoot()}/journey-left.json');

Future<void> remember(Map<String, Object?> left) async =>
  (await notes()).writeAsBytes(utf8.encode(jsonEncode(left)), flush: true);

Future<Map<String, dynamic>> recall() async => jsonDecode(await (await notes()).readAsString()) as Map<String, dynamic>;

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

/// What the HUD last said, as the game sends it each reply.
Map<String, dynamic> hudOf(GameSession? session) {
  final models = session?.presentation.value['models'] as Map?;
  return Map<String, dynamic>.from(models?['hud'] as Map? ?? const {});
}

/// Open a world from the title: the game a part before this one left, or a new one. Waits until the
/// shell is playing and the native renderer has drawn something that is not blank.
Future<int> openWorld(WidgetTester tester) async {
  final opening = Stopwatch()..start();
  await until(tester, () => answers(const ValueKey('new-game')), 'the title');
  await press(tester, answers(const ValueKey('continue')) ? const ValueKey('continue') : const ValueKey('new-game'));
  await until(tester, () => heroOf(session), 'the world opening');
  await until(tester, () => find.byKey(const ValueKey('ledger-pack')).evaluate().isNotEmpty, 'the playing shell');
  await until(tester, () => session!.pipeline == null ? null : true, 'a renderer');
  final seeing = Stopwatch()..start();
  while ((await drawn()).spread < 40 && seeing.elapsed < const Duration(minutes: 10)) {
    await Future<void>.delayed(const Duration(seconds: 2));
  }
  return opening.elapsedMilliseconds;
}

/// A line typed into the game's own console by touch: the more controls, the console, the line, SAY.
/// Returns the lines the console said back, in order.
Future<List<String>> typed(WidgetTester tester, String line) async {
  // the chat keeps its last forty lines, so what is new is what follows the old tail, not a longer list
  List<String> lines() => [for (final said in hudOf(session)['chat'] as List? ?? const []) jsonEncode(said)];
  final before = lines();
  await press(tester, const ValueKey('more'));
  await press(tester, const ValueKey('more-console'));
  await until(tester, () => find.byKey(const ValueKey('console-line')).evaluate().isNotEmpty, 'the console');
  await tester.enterText(find.byKey(const ValueKey('console-line')), line);
  await press(tester, const ValueKey('console-say'));
  await until(tester, () => lines().join() != before.join(), 'the console answering $line', within: const Duration(minutes: 1));
  // everything a command says is said in one go, so a moment more has all of it
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final after = lines();
  var kept = math.min(before.length, after.length);
  while (kept > 0 && before.sublist(before.length - kept).join('\n') != after.sublist(0, kept).join('\n')) {
    kept--;
  }
  await press(tester, const ValueKey('console-done'));
  return [for (final said in after.sublist(kept)) '${(jsonDecode(said) as Map)['text']}'];
}

/// Where a thumb lands to steer: in the walk field, clear of the tab gutter and the action corner.
Offset walkField(WidgetTester tester) {
  final size = tester.view.physicalSize / tester.view.devicePixelRatio;
  return Offset(size.width * 0.45, size.height * 0.6);
}

/// Lean the stick toward a screen direction for a while, as a thumb does, and let go.
Future<void> lean(WidgetTester tester, Offset towards, Duration how) async {
  final reach = towards.distance == 0 ? Offset.zero : towards / towards.distance * 54;
  final thumb = await tester.startGesture(walkField(tester));
  await thumb.moveBy(reach * (20 / 54));
  await thumb.moveBy(reach * (34 / 54));
  await Future<void>.delayed(how);
  await thumb.up();
  await tester.pump(const Duration(milliseconds: 300));
}

/// Lean the stick toward a screen direction and hold it until something is so or a while has passed,
/// as a player on a slow phone holds it for as long as the walk takes. Returns whether it came true.
Future<bool> leanUntil(WidgetTester tester, Offset towards, bool Function() done, Duration within) async {
  final reach = towards.distance == 0 ? Offset.zero : towards / towards.distance * 54;
  final thumb = await tester.startGesture(walkField(tester));
  await thumb.moveBy(reach * (20 / 54));
  await thumb.moveBy(reach * (34 / 54));
  final holding = Stopwatch()..start();
  var came = done();
  while (!came && holding.elapsed < within) {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    came = done();
  }
  await thumb.up();
  await tester.pump(const Duration(milliseconds: 300));
  return came;
}

/// How far the hero is from somewhere on the ground.
double away(Map<String, dynamic> hero, double x, double z) =>
  math.sqrt(math.pow(x - (hero['x'] as num), 2) + math.pow(z - (hero['z'] as num), 2));

/// Which way on the ground the stick walks the hero: leaned up, and leaned right, for a moment each.
/// The camera decides it, so it is measured rather than assumed.
Future<({Offset up, Offset right})> stickBearings(WidgetTester tester) async {
  Future<Offset> moved(Offset towards) async {
    final from = heroOf(session)!;
    Offset delta() {
      final to = heroOf(session)!;
      return Offset(((to['x'] as num) - (from['x'] as num)).toDouble(), ((to['z'] as num) - (from['z'] as num)).toDouble());
    }
    // held until he has gone far enough to say which way, however long a slow phone takes
    await leanUntil(tester, towards, () => delta().distance > 0.6, const Duration(minutes: 1));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    return delta();
  }
  var up = await moved(const Offset(0, -1));
  if (up.distance < 0.3) up = -(await moved(const Offset(0, 1)));
  var right = await moved(const Offset(1, 0));
  if (right.distance < 0.3) right = -(await moved(const Offset(-1, 0)));
  if (up.distance < 0.3 || right.distance < 0.3) {
    throw TestFailure('the stick did not walk the hero: up moved him $up, right $right');
  }
  return (up: up, right: right);
}

/// The stick's lean that walks the hero along a direction on the ground, through the bearings.
Offset leanFor(({Offset up, Offset right}) bearings, Offset ground) {
  final r = bearings.right, u = bearings.up;
  final det = r.dx * u.dy - u.dx * r.dy;
  final a = (ground.dx * u.dy - u.dx * ground.dy) / det;
  final b = (r.dx * ground.dy - ground.dx * r.dy) / det;
  return Offset(a, -b);
}

/// Walk the hero by touch to within `within` tiles of somewhere, steering again every half second.
Future<double> walkTo(WidgetTester tester, ({Offset up, Offset right}) bearings, double x, double z,
    {double within = 1, Duration giveUp = const Duration(minutes: 6)}) async {
  final walking = Stopwatch()..start();
  var left = away(heroOf(session)!, x, z);
  while (left > within && walking.elapsed < giveUp) {
    final hero = heroOf(session)!;
    final ground = Offset(x - (hero['x'] as num), z - (hero['z'] as num));
    await lean(tester, leanFor(bearings, ground), Duration(milliseconds: (150 * left).clamp(150, 600).round()));
    left = away(heroOf(session)!, x, z);
  }
  return left;
}

/// A door as the console lists it (`doors`): where to stand outside it, and the middle of the building.
typedef Door = ({String line, ({double x, double z}) step, ({double x, double z}) inside});

/// The first door in what the console said, or null if it listed none.
Door? doorIn(List<String> said) {
  int? field(String line, String name) => int.tryParse(RegExp('(?:^|, )$name (-?\\d+)').firstMatch(line)?.group(1) ?? '');
  for (final line in said) {
    final x = field(line, 'x'), z = field(line, 'z'), bx = field(line, 'bx'), bz = field(line, 'bz');
    if (x != null && z != null && bx != null && bz != null) {
      return (line: line, step: (x: x + 0.5, z: z + 0.5), inside: (x: bx + 0.5, z: bz + 0.5));
    }
  }
  return null;
}

/// On a door's doorstep through the console, then into it with the stick until the HUD names the
/// building. Returns where the HUD said he was outside, and inside.
Future<({String outside, String inside, Offset inward})> walkIn(WidgetTester tester, ({Offset up, Offset right}) bearings,
    Door door) async {
  await typed(tester, '/teleport ${door.step.x} ${door.step.z}');
  await until(tester, () => away(heroOf(session)!, door.step.x, door.step.z) < 1.5 ? true : null, 'the hero on the doorstep',
    within: const Duration(minutes: 3));
  // a moment for the doorstep to know he is on it, which is what arms the door
  await Future<void>.delayed(const Duration(seconds: 4));
  final outside = '${hudOf(session)['area']}';
  final inward = leanFor(bearings, Offset(door.inside.x - door.step.x, door.inside.z - door.step.z));
  String area() => '${hudOf(session)['area']}';
  if (await leanUntil(tester, inward, () => area() != outside && area().contains(' in '), const Duration(minutes: 3))) {
    return (outside: outside, inside: area(), inward: inward);
  }
  throw TestFailure('leaning into ${door.line} never took him inside; the HUD said ${area()}');
}

/// What is being said, as the game last sent it, or null when nobody is talking.
Map<String, dynamic>? talkOf(GameSession? session) {
  final models = session?.presentation.value['models'] as Map?;
  final talk = models?['conversation'];
  return talk is Map ? Map<String, dynamic>.from(talk) : null;
}

/// Tap through what is being said until there is something to choose, and return the choices.
Future<List<String>> toChoices(WidgetTester tester) async {
  for (var taps = 0; taps < 40; taps++) {
    final talk = await until(tester, () => talkOf(session), 'somebody talking', within: const Duration(minutes: 1));
    final choices = [for (final choice in talk['choices'] as List? ?? const []) '${(choice as Map)['label']}'];
    if (talk['atChoices'] == true && choices.isNotEmpty) return choices;
    await press(tester, const ValueKey('talk-on'));
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }
  throw TestFailure('forty taps and nothing to choose: ${talkOf(session)}');
}

/// Choose the first row whose words match, by touch.
Future<String> choose(WidgetTester tester, bool Function(String label) which) async {
  final choices = await toChoices(tester);
  final row = choices.indexWhere(which);
  if (row < 0) throw TestFailure('nothing to choose that fits among $choices');
  await press(tester, ValueKey('choice-$row'));
  await Future<void>.delayed(const Duration(milliseconds: 600));
  return choices[row];
}
