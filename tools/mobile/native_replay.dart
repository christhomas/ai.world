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
        final nodes = (packet['frame'] as Map)['nodes'] as List;
        final meshes = nodes.where((node) => (node as Map)['kind'] == 'mesh').length;
        final lights = nodes.where((node) => const ['ambient', 'hemisphere', 'directional', 'point'].contains((node as Map)['kind'])).length;
        if (meshes < 10 || lights == 0) throw StateError('Recorded interior preconditions missing');
        await FlutterFramePipeline(renderer).draw(SceneFrame.fromJson(packet, geometryCache: SceneGeometryCache()));
        debugPrint('HOSTED_NATIVE_READY meshes=$meshes lights=$lights');
      } catch (error, stack) {
        debugPrint('HOSTED_NATIVE_FAILED $error\n$stack');
        rethrow;
      }
    })),
  ));
}
