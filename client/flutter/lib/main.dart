import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ai_world_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const AiWorldClient());
}

class AiWorldClient extends StatelessWidget {
  const AiWorldClient({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
    debugShowCheckedModeBanner: false,
    home: Scaffold(body: _RendererSmoke()),
  );
}

class _RendererSmoke extends StatefulWidget {
  const _RendererSmoke();
  @override
  State<_RendererSmoke> createState() => _RendererSmokeState();
}

class _RendererSmokeState extends State<_RendererSmoke> {
  NativeWorldRenderer? renderer;
  bool cutaway = true;

  Future<void> _ready(NativeWorldRenderer value) async {
    renderer = value;
    final chunk = _oneChunk();
    final meshes = const ChunkMesher().build(chunk, seed: 72);
    if (meshes.land case final land?) await value.putMesh(land);
    if (meshes.water case final water?) await value.putMesh(water);
    final hero = CreatureRig.fromJson('hero', _heroModel).instantiate(
      instanceId: 'local', x: 8, y: 1, z: 8,
    );
    await value.putMesh(hero);
    await value.putMesh(_wall());
    await value.setCamera(const RenderCamera(targetX: 8, targetY: 0, targetZ: 8));
    await value.setCutaway(const CutawayState(enabled: true, heroX: 8, heroY: 1, heroZ: 8));
  }

  @override
  Widget build(BuildContext context) => Stack(fit: StackFit.expand, children: [
    NativeWorldView(onCreated: _ready),
    const SafeArea(child: Align(
      alignment: Alignment.topCenter,
      child: Padding(
        padding: EdgeInsets.only(top: 16),
        child: Text('THE CROSSROADS', style: TextStyle(color: Color(0xffffd76a), fontSize: 18, letterSpacing: 10)),
      ),
    )),
    SafeArea(child: Align(
      alignment: Alignment.bottomRight,
      child: Semantics(
        button: true,
        label: cutaway ? 'Disable cutaway' : 'Enable cutaway',
        child: InkWell(
          onTap: () async {
            final next = !cutaway;
            setState(() => cutaway = next);
            await renderer?.setCutaway(CutawayState(enabled: next, heroX: 8, heroY: 1, heroZ: 8));
          },
          child: Container(
            width: 208, height: 62,
            decoration: BoxDecoration(
              color: const Color(0xcc060916),
              border: Border.all(color: const Color(0x66d6ddff)),
            ),
            alignment: Alignment.center,
            child: Text(cutaway ? 'CUTAWAY ON' : 'CUTAWAY OFF', style: const TextStyle(color: Colors.white, letterSpacing: 2)),
          ),
        ),
      ),
    )),
  ]);
}

ChunkParcel _oneChunk() {
  const size = ChunkParcel.apronSize;
  final count = size * size;
  final heights = Float32List(count);
  final corners = Float32List(count * 4);
  final types = Uint8List(count);
  final biomes = Uint8List(count);
  final water = Float32List(count);
  for (var z = -1; z <= 16; z++) {
    for (var x = -1; x <= 16; x++) {
      final i = (z + 1) * size + x + 1;
      final h = (x > 10 || z > 11) ? 0.5 : 1.0;
      heights[i] = h;
      for (var k = 0; k < 4; k++) corners[i * 4 + k] = h;
      types[i] = (x >= 6 && x <= 9) ? TileType.road.index : TileType.ground.index;
      if (z == 4 && x >= 1 && x <= 5) {
        types[i] = TileType.water.index;
        water[i] = 0.72;
      }
    }
  }
  return ChunkParcel(
    cx: 0, cz: 0, size: size, empty: false,
    height: heights, propRot: Float32List(count), shore: Float32List(count),
    corners: corners, water: water, type: types, biome: biomes,
    prop: Uint8List(count), sloped: Uint8List(count),
  );
}

RenderMesh _wall() {
  const color = <double>[0.32, 0.22, 0.12];
  final vertices = Float32List.fromList([
    for (final point in const <List<double>>[[5,0,5],[5,5,5],[11,5,5],[11,0,5]])
      ...<double>[...point,0,0,1,...color,RenderMesh.cuttableMaterial,0,0,0,0],
  ]);
  return RenderMesh(id: 'smoke:wall', vertices: vertices, indices: Int32List.fromList(const [0,1,2,0,2,3]));
}

const _heroModel = '''
{"from":"biped","with":{"skin":"#ffdab9","hair":"#ffffff","shirtTint":0,"pantsColor":"#334466"},"parts":[{"box":[0.33,0.12,0.33],"at":[0,1.575,0],"color":"#2fb36a","anim":"head","pivot":[0,1.2,0]}]}
''';
