// Hosted renderer replay only. This does not implement or certify installed gameplay.
import 'dart:convert';
import 'dart:io';
import 'package:ai_world_flutter/ai_world_flutter.dart';
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
        if (Platform.isIOS) await proveInstalledStateEngine();
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
    final engine = await StateEngine.open('installed-state:$cycle');
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
  debugPrint('HOSTED_STATE_ENGINE_READY cycles=3 actions=unequip,equip parked=true isolated=true');
}
