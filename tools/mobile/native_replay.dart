// Hosted renderer replay only. This does not implement or certify installed gameplay.
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:ai_world_flutter/src/storage/checkpoint_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'hosted_fixture.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [DeviceOrientation.landscapeLeft]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(MaterialApp(
    debugShowCheckedModeBanner: false,
    home: Scaffold(body: NativeWorldView(onCreated: (renderer) async {
      try {
        debugPrint('HOSTED_NATIVE_CREATED texture=${renderer.textureId}');
        if (Platform.isIOS || Platform.isAndroid) await proveInstalledStateEngine();
        final scenes = (jsonDecode(await rootBundle.loadString('assets/hosted/scenes.json')) as List)
            .map((scene) => Map<String, dynamic>.from(scene as Map)).toList();
        final advance = Directory(await StateEngine.storageRoot());
        // One pipeline for every scene, so each draw replaces the last rather than piling on it.
        final pipeline = FlutterFramePipeline(renderer);
        for (var index = 0; index < scenes.length; index++) {
          final scene = scenes[index];
          final name = scene['name'] as String;
          final text = name == 'interior-fixture'
              ? hostedFixture : await rootBundle.loadString('assets/hosted/$name.json');
          final packet = jsonDecode(text) as Map<String, dynamic>;
          // The render time the web drew this frame at, so water and anything else that moves stands
          // where it stood in the web picture; the checked-in fixture predates the field.
          (packet['frame'] as Map)['renderTimeMs'] ??= 1000.0;
          final frame = SceneFrame.fromJson(packet, geometryCache: SceneGeometryCache());
          checkScene(name, frame, Map<String, dynamic>.from(scene['kinds'] as Map));
          await pipeline.draw(frame);
          final lights = frame.nodes.where((node) => const ['ambient', 'hemisphere', 'directional', 'point'].contains(node['kind'])).length;
          // The target itself, twice, for the comparison with the web picture and the repeat noise
          // floor: a screenshot is the device's frame, rotated and composited, and not what was drawn.
          await Future<void>.delayed(const Duration(milliseconds: 1500));
          final drawn = <String>[];
          for (final pass in const ['first', 'repeat']) {
            final shot = await renderer.snapshot();
            await File('${advance.path}/parity-$index-$pass.rgba').writeAsBytes(shot.rgba, flush: true);
            drawn.add('${shot.width}x${shot.height}');
            await Future<void>.delayed(const Duration(milliseconds: 500));
          }
          if (drawn.toSet().length != 1) throw StateError('$name was read back at two sizes: $drawn');
          debugPrint('HOSTED_SCENE_READY index=$index name=$name nodes=${frame.nodes.length} lights=$lights '
              'framebuffer=${drawn.first} renderTimeMs=${(packet['frame'] as Map)['renderTimeMs']}');
          // Held until the host has photographed it twice, however long a loaded emulator takes.
          final cue = File('${advance.path}/parity-advance-$index');
          final deadline = DateTime.now().add(const Duration(minutes: 4));
          while (!await cue.exists()) {
            if (DateTime.now().isAfter(deadline)) throw StateError('The host never photographed $name');
            await Future<void>.delayed(const Duration(milliseconds: 200));
          }
        }
        debugPrint('HOSTED_NATIVE_READY scenes=${scenes.length}');
        try {
          await proveInstalledGame(renderer, pipeline, advance);
        } catch (error, stack) {
          debugPrint('HOSTED_GAME_FAILED $error\n$stack');
          rethrow;
        }
      } catch (error, stack) {
        debugPrint('HOSTED_NATIVE_FAILED $error\n$stack');
        rethrow;
      }
    })),
  ));
}

/// The whole shared game, in this app's own JavaScript engine (#563): a world opened from the bundled
/// engine, its ground streamed into the native renderer a packet at a time, the hero walked by the
/// stick, the frame he ended in read back, and the save the game wrote handed to the app.
Future<void> proveInstalledGame(NativeWorldRenderer renderer, FlutterFramePipeline pipeline, Directory store) async {
  final view = WidgetsBinding.instance.platformDispatcher.views.first;
  final size = view.physicalSize / view.devicePixelRatio;
  final opening = Stopwatch()..start();
  final engine = await StateEngine.openGame('installed-game:${Platform.operatingSystem}', {
    'seed': 3, 'kind': 'road', 'slot': 'installed', 'name': 'Rowan',
    'viewport': {'width': size.width.roundToDouble(), 'height': size.height.roundToDouble()},
  });
  try {
    Map<String, dynamic> state(Map<String, dynamic> reply) {
      if (reply['type'] != 'result') throw StateError('Game request failed: ${reply['payload']}');
      return Map<String, dynamic>.from(reply['payload']['state'] as Map);
    }
    try {
      state(await engine.request('start', {'mode': 'local', 'world': 'installed'}));
    } catch (error) {
      throw StateError('Opening the world failed after ${opening.elapsedMilliseconds} ms: $error');
    }
    final opened = opening.elapsedMilliseconds;
    debugPrint('HOSTED_GAME_OPENED platform=${Platform.operatingSystem} openMs=$opened sha=${engine.sourceSha}');
    final cache = SceneGeometryCache();
    final stepMicros = <int>[];
    var tick = -1;
    var time = 0.0;
    var packets = 0;
    // where the engine's time went, by kind of job, as the game last said (#559)
    Map work = const {};
    String jobs() => work.isEmpty ? 'jobs=none'
      : 'jobs=${work.entries.map((e) => '${e.key}:${(e.value as Map)['runs']}/${((e.value as Map)['ms'] as num).round()}/${((e.value as Map)['longest'] as num).round()}').join(',')}';
    Future<Map<String, dynamic>> step({List<double> move = const [0, 0]}) async {
      tick++;
      time += 1000 / 30;
      final watch = Stopwatch()..start();
      final reply = state(await engine.request('step', {'tick': tick, 'dtSeconds': 1 / 30, 'renderTimeMs': time,
        'input': {'move': move, 'look': [0, 0], 'held': {'guard': false, 'run': false}, 'actions': <String>[],
          'owner': 'WORLD', 'busy': null}}));
      stepMicros.add(watch.elapsedMicroseconds);
      if ((reply['models'] as Map)['perf'] case {'jobs': final Map jobs}) work = jobs;
      final scene = (reply['models'] as Map)['scene'];
      if (scene != null) {
        packets++;
        await pipeline.draw(SceneFrame.fromJson(Map<String, dynamic>.from(scene as Map), geometryCache: cache));
      }
      return reply;
    }
    Future<int> drawn() async {
      state(await engine.request('resync', {'reason': 'scene'}));
      final scene = (await step())['models']['scene'] as Map?;
      if (scene == null) throw StateError('A scene was asked for and none came');
      return ((scene['frame'] as Map)['nodes'] as List).where((node) => (node as Map)['kind'] == 'mesh').length;
    }
    String ms(int micros) => (micros / 1000).toStringAsFixed(2);
    String timings() {
      final sorted = [...stepMicros]..sort();
      if (sorted.isEmpty) return 'steps=0';
      return 'steps=${sorted.length} stepMedianMs=${ms(sorted[sorted.length ~/ 2])} '
          'stepP95Ms=${ms(sorted[(sorted.length * 0.95).floor()])} stepMaxMs=${ms(sorted.last)}';
    }
    // how fast this phone's engine runs the game is the evidence (#559), so it is said as it goes,
    // and a game too slow to bring its ground in ten minutes fails with what it measured
    final arriving = Stopwatch()..start();
    var meshes = 0;
    for (var round = 0; round < 80 && meshes < 40; round++) {
      for (var n = 0; n < 15; n++) { await step(); }
      meshes = await drawn();
      debugPrint('HOSTED_GAME_PROGRESS platform=${Platform.operatingSystem} openMs=$opened round=$round '
          'meshes=$meshes elapsedMs=${arriving.elapsedMilliseconds} ${timings()} ${jobs()}');
      if (arriving.elapsed > const Duration(minutes: 10)) break;
    }
    if (meshes < 40) {
      throw StateError('Only $meshes meshes of ground arrived in ${arriving.elapsedMilliseconds} ms '
          '(opening took $opened ms; ${timings()})');
    }
    final from = Map<String, dynamic>.from((await step())['models']['hero'] as Map);
    for (var n = 0; n < 45; n++) { await step(move: [0, 1]); }
    meshes = await drawn();
    final to = Map<String, dynamic>.from((await step())['models']['hero'] as Map);
    final walked = math.sqrt(math.pow((to['x'] as num) - (from['x'] as num), 2) + math.pow((to['z'] as num) - (from['z'] as num), 2));
    if (walked <= 1) throw StateError('The hero walked $walked tiles, from $from to $to');
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    final shot = await renderer.snapshot();
    await File('${store.path}/game-first.rgba').writeAsBytes(shot.rgba, flush: true);
    // the save comes back with the reply that asked for it, or with the next one
    final asked = state(await engine.request('resync', {'reason': 'save'}));
    final saved = ((asked['models'] as Map)['save'] ?? (await step())['models']['save']) as Map?;
    if (saved == null || (saved['state'] as Map?)?['playerId'] != to['playerId']) throw StateError('The game saved nothing of the hero');
    debugPrint('HOSTED_GAME_READY platform=${Platform.operatingSystem} openMs=$opened ${timings()} '
        'meshes=$meshes packets=$packets walked=${walked.toStringAsFixed(2)} framebuffer=${shot.width}x${shot.height} ${jobs()}');
    // the game is held open a while so the runner can measure the app's memory with it loaded (#559)
    await Future<void>.delayed(const Duration(seconds: 15));
  } finally {
    await engine.dispose();
  }
}

/// A scene decoded to exactly what was recorded, with real geometry, before any picture of it counts.
/// The checked-in interior keeps the precise shape it has always been held to.
void checkScene(String name, SceneFrame frame, Map<String, dynamic> recorded) {
  final decoded = <String, int>{};
  for (final node in frame.nodes) {
    final kind = node['kind'] as String;
    decoded[kind] = (decoded[kind] ?? 0) + 1;
  }
  final expected = recorded.map((kind, n) => MapEntry(kind, (n as num).toInt()));
  if (decoded.length != expected.length || expected.entries.any((entry) => decoded[entry.key] != entry.value)) {
    throw StateError('$name decoded to $decoded, recorded as $expected');
  }
  final meshes = frame.nodes.where((node) => node['kind'] == 'mesh').toList();
  final instanceGroups = frame.nodes.where((node) => node['kind'] == 'instances').toList();
  final instances = instanceGroups.where((node) => (node['instanceMatrices'] as List).isNotEmpty).toList();
  final lights = frame.nodes.where((node) => const ['ambient', 'hemisphere', 'directional', 'point'].contains(node['kind'])).length;
  final drawable = [...meshes, ...instances].where((node) => node['visible'] != false).toList();
  final populated = drawable.isNotEmpty && drawable.every((node) {
    final positions = ((node['attributes'] as Map?)?['position'] as Map?)?['values'] as List?;
    final indices = node['indices'] as List?;
    final matrices = node['instanceMatrices'] as List?;
    return positions != null && positions.length >= 9 &&
        (indices == null ? positions.length % 9 == 0 : indices.length >= 3 && indices.length % 3 == 0) &&
        (node['kind'] != 'instances' || (matrices != null && matrices.length >= 16 && matrices.length % 16 == 0));
  });
  if (lights == 0 || !populated) {
    throw StateError('$name preconditions missing: meshes=${meshes.length} instances=${instances.length} lights=$lights populated=$populated');
  }
  // Three shell meshes and 23 populated furniture groups; two empty HUD groups are dormant.
  if (name == 'interior-fixture' && (meshes.length != 3 || instanceGroups.length != 25 || instances.length != 23)) {
    throw StateError('Recorded interior preconditions missing: meshes=${meshes.length} instances=${instances.length} lights=$lights');
  }
}

Future<void> proveInstalledStateEngine() async {
  final identities = <String>{};
  for (var cycle = 0; cycle < 3; cycle++) {
    final engine = await StateEngine.open('installed-state:Ólafur 雪 🐺:$cycle');
    try {
      Map<String, dynamic> hero(Map<String, dynamic> reply) {
        if (reply['type'] != 'result') throw StateError('State engine request failed: $reply');
        return Map<String, dynamic>.from(reply['payload']['state']['models']['hero'] as Map);
      }
      final start = hero(await engine.request('start', {'mode': 'local', 'world': 'installed-state'}));
      if (!identities.add(start['playerId'] as String)) throw StateError('Fresh contexts reused a hero identity');
      if (start['inventory']['equipped']['hand'] != 'stick') throw StateError('Fresh kit missing');
      final off = hero(await engine.request('action', {'action': 'unequip', 'target': 'hand', 'args': null}));
      if (off['inventory']['equipped']['hand'] != null) throw StateError('Actual unequip did not change state');
      final on = hero(await engine.request('action', {'action': 'equip', 'target': 'stick', 'args': null}));
      if (on['inventory']['equipped']['hand'] != 'stick') throw StateError('Actual equip did not change state');
      final parked = hero(await engine.request('lifecycle', {'state': 'background', 'renderTimeMs': 0}));
      final stepped = hero(await engine.request('step', {'tick': 0, 'dtSeconds': 0.1, 'renderTimeMs': 100,
        'input': {'move': [0, 0], 'look': [0, 0], 'held': {'guard': false, 'run': false},
          'actions': [], 'owner': 'WORLD', 'busy': null}}));
      if (parked['time'] != stepped['time']) throw StateError('Parked state advanced');
      await engine.request('lifecycle', {'state': 'active', 'renderTimeMs': 100});
      final leftOff = hero(await engine.request('action', {'action': 'unequip', 'target': 'hand', 'args': null}));
      if (leftOff['inventory']['equipped']['hand'] != null) throw StateError('Isolation precondition missing');
      debugPrint('HOSTED_STATE_ENGINE_CYCLE cycle=$cycle sha=${engine.sourceSha} hero=${jsonEncode(on)}');
    } finally {
      await engine.dispose();
    }
    var rejected = false;
    try { await engine.request('resync', {'reason': 'retired'}); } catch (_) { rejected = true; }
    if (!rejected) throw StateError('Retired engine accepted a request');
  }
  await proveNativeOwnerBoundary();
  await proveInstalledHeroCheckpoint();
  debugPrint('HOSTED_STATE_ENGINE_READY platform=${Platform.operatingSystem} cycles=3 actions=unequip,equip parked=true isolated=true utf8=true nativeRetirement=true');
}

Future<void> proveInstalledHeroCheckpoint() async {
  final scope = StorageScope(domain: 'player', world: 'proof-${DateTime.now().microsecondsSinceEpoch}',
    seed: 3, player: 'local-hero');
  var fail = false;
  final first = await InstalledHeroSession.open('hero-save:first', scope, writeFailure: (stage) {
    if (fail && stage == WriteStage.beforeCommit) throw const FileSystemException('Hosted checkpoint interruption');
  });
  final original = await first.request('resync', {'reason': 'identity'});
  var duplicateRejected = false;
  try { await InstalledHeroSession.open('hero-save:duplicate', scope); }
  on StorageFailure catch (error) { duplicateRejected = error.code == StorageError.conflict; }
  if (!duplicateRejected) throw StateError('Concurrent hero slot owner accepted');
  final off = await first.request('action', {'action': 'unequip', 'target': 'hand', 'args': null});
  if (off['inventory']['equipped']['hand'] != null) throw StateError('Save precondition missing');
  await first.save();
  await first.request('action', {'action': 'equip', 'target': 'stick', 'args': null});
  await first.request('lifecycle', {'state': 'background', 'renderTimeMs': 0});
  fail = true;
  var rejected = false;
  try { await first.close(); } on StorageFailure { rejected = true; }
  if (!rejected) throw StateError('Failed file checkpoint released the VM');
  final live = await first.request('resync', {'reason': 'failed-save-kept-live'});
  if (live['inventory']['equipped']['hand'] != 'stick') throw StateError('Failed close discarded live state');
  var parked = false;
  try { await first.request('action', {'action': 'unequip', 'target': 'hand', 'args': null}); }
  on StateError { parked = true; }
  if (!parked) throw StateError('Failed close reactivated a backgrounded hero');
  final committed = (await first.store.load('hero')) as Map;
  if (committed['hero']['inventory']['equipped']['hand'] != null) throw StateError('Failed commit replaced valid slot');
  fail = false;
  await first.request('lifecycle', {'state': 'active', 'renderTimeMs': 0});
  await first.request('action', {'action': 'unequip', 'target': 'hand', 'args': null});
  await first.close();
  final second = await InstalledHeroSession.open('hero-save:continued', scope);
  final restored = await second.request('resync', {'reason': 'continued'});
  if (restored['playerId'] != original['playerId'] || restored['inventory']['equipped']['hand'] != null) {
    throw StateError('Fresh native VM did not restore committed hero');
  }
  await second.request('action', {'action': 'equip', 'target': 'stick', 'args': null});
  await second.close();
  final failed = await InstalledHeroSession.open('hero-save:transport-failure', scope);
  var transportRejected = false;
  try { await failed.request('action', {'action': 'equip', 'target': 'stick', 'args': 'x' * (1024 * 1024)}); }
  on PlatformException { transportRejected = true; }
  if (!transportRejected || !failed.engine.isRetired) throw StateError('Native request limit did not retire the uncertain owner');
  var closeRejected = false;
  try { await failed.close(); } on StateError { closeRejected = true; }
  if (!closeRejected) throw StateError('Retired owner claimed a successful save');
  final recovered = await InstalledHeroSession.open('hero-save:recovered', scope);
  final prior = await recovered.request('resync', {'reason': 'previous-file'});
  if (prior['playerId'] != original['playerId'] || prior['inventory']['equipped']['hand'] != 'stick') {
    throw StateError('Retired owner did not release the slot or preserve its checkpoint');
  }
  await recovered.close();
  debugPrint('HOSTED_HERO_CHECKPOINT_READY platform=${Platform.operatingSystem} identity=true equipment=true failedCloseKeptLive=true previousSlot=true retry=true retiredRecovery=true root=app-private');
}

Future<void> proveNativeOwnerBoundary() async {
  const channel = MethodChannel('world.ai/state-engine');
  final manifest = jsonDecode(await rootBundle.loadString('assets/engine/manifest.json')) as Map;
  final asset = await rootBundle.load('assets/engine/engine.js');
  final source = asset.buffer.asUint8List(asset.offsetInBytes, asset.lengthInBytes);
  var rejectedCorruption = false;
  try {
    await channel.invokeMethod<String>('create', {'session': 'corruption', 'source': source,
      'bundleSha256': '0' * 64});
  } on PlatformException { rejectedCorruption = true; }
  if (!rejectedCorruption) throw StateError('Native bundle integrity check missing');
  final token = await channel.invokeMethod<String>('create', {'session': 'native-owner', 'source': source,
    'bundleSha256': manifest['bundleSha256']});
  if (token == null) throw StateError('Native owner missing');
  await channel.invokeMethod<void>('dispose', {'token': token});
  await channel.invokeMethod<void>('dispose', {'token': token});
  var rejectedRetirement = false;
  try {
    await channel.invokeMethod<String>('request', {'token': token, 'request': jsonEncode({
      'version': 1, 'session': 'native-owner', 'sequence': 0, 'id': 'late', 'type': 'start',
      'payload': {'mode': 'local', 'world': 'installed-state'},
    })});
  } on PlatformException { rejectedRetirement = true; }
  if (!rejectedRetirement) throw StateError('Native retired owner accepted a request');
}
