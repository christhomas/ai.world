// Hosted renderer replay only. This does not implement or certify installed gameplay.
import 'dart:convert';
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
        final packet = jsonDecode(hostedFixture) as Map<String, dynamic>;
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
