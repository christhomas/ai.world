// Hosted renderer replay only. This does not implement or certify installed gameplay.
import 'dart:convert';
import 'dart:io';
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
        final packet = jsonDecode(hostedFixture) as Map<String, dynamic>;
        // Consumers implementing the captured clock use this exact epoch on both passes.
        (packet['frame'] as Map)['renderTimeMs'] = 1000.0;
        final frame = SceneFrame.fromJson(packet, geometryCache: SceneGeometryCache());
        final meshes = frame.nodes.where((node) => node['kind'] == 'mesh').toList();
        final instanceGroups = frame.nodes.where((node) => node['kind'] == 'instances').toList();
        final instances = instanceGroups.where((node) => (node['instanceMatrices'] as List).isNotEmpty).toList();
        final lights = frame.nodes.where((node) => const ['ambient', 'hemisphere', 'directional', 'point'].contains(node['kind'])).length;
        // Three shell meshes and 23 populated furniture groups; two empty HUD groups are dormant.
        // Validate real geometry and transforms before allowing any image assertion.
        final drawable = [...meshes, ...instances];
        final populated = drawable.every((node) {
          final positions = ((node['attributes'] as Map?)?['position'] as Map?)?['values'] as List?;
          final indices = node['indices'] as List?;
          final matrices = node['instanceMatrices'] as List?;
          return node['visible'] == true && positions != null && positions.length >= 9 &&
              (indices == null ? positions.length % 9 == 0 : indices.length >= 3 && indices.length % 3 == 0) &&
              (node['kind'] != 'instances' || (matrices != null && matrices.length >= 16 && matrices.length % 16 == 0));
        });
        if (meshes.length != 3 || instanceGroups.length != 25 || instances.length != 23 || lights == 0 || !populated) {
          throw StateError('Recorded interior preconditions missing: meshes=${meshes.length} instances=${instances.length} lights=$lights populated=$populated');
        }
        await FlutterFramePipeline(renderer).draw(frame);
        debugPrint('HOSTED_NATIVE_READY meshes=${meshes.length} instances=${instances.length} lights=$lights');
      } catch (error, stack) {
        debugPrint('HOSTED_NATIVE_FAILED $error\n$stack');
        rethrow;
      }
    })),
  ));
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
  fail = true;
  var rejected = false;
  try { await first.close(); } on StorageFailure { rejected = true; }
  if (!rejected) throw StateError('Failed file checkpoint released the VM');
  final live = await first.request('resync', {'reason': 'failed-save-kept-live'});
  if (live['inventory']['equipped']['hand'] != 'stick') throw StateError('Failed close discarded live state');
  final committed = (await first.store.load('hero')) as Map;
  if (committed['hero']['inventory']['equipped']['hand'] != null) throw StateError('Failed commit replaced valid slot');
  fail = false;
  await first.request('action', {'action': 'unequip', 'target': 'hand', 'args': null});
  await first.close();
  final second = await InstalledHeroSession.open('hero-save:continued', scope);
  final restored = await second.request('resync', {'reason': 'continued'});
  if (restored['playerId'] != original['playerId'] || restored['inventory']['equipped']['hand'] != null) {
    throw StateError('Fresh native VM did not restore committed hero');
  }
  await second.request('action', {'action': 'equip', 'target': 'stick', 'args': null});
  await second.close();
  debugPrint('HOSTED_HERO_CHECKPOINT_READY platform=${Platform.operatingSystem} identity=true equipment=true failedCloseKeptLive=true previousSlot=true retry=true root=app-private');
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
