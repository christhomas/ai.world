import 'package:ai_world_flutter/ai_world_flutter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

const identity = <double>[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
Map<String, dynamic> node(int id, {Object? parent, int? part, double x = 0, bool visible = true}) => {
  'id': id, if (part != null) 'part': part, 'parent': parent,
  'kind': 'mesh', 'world': [...identity]..[12] = x, 'visible': visible,
  'castShadow': false, 'receiveShadow': false, 'geometryId': 'g1',
  'material': {'intent': 'lit', 'colour': 0xffffff, 'side': 'front'},
};
Map<String, dynamic> packet(int generation, {bool full = false,
    List<Map<String, dynamic>> nodes = const [], List<Map<String, dynamic>> changes = const [],
    List<String> removed = const [], List<String>? order}) => {
  'version': 1, 'generation': generation, 'full': full,
  'frame': {'camera': {'orthographic': true, 'projection': identity, 'world': identity},
    'renderTimeMs': generation * 20, 'background': 0, 'fog': null, 'nodes': nodes},
  'changes': changes, 'removed': removed, if (order != null) 'order': order,
  'geometries': {if (full) 'g1': {
    'attributes': {'position': {'size': 3, 'values': <num>[0, 0, 0, 1, 0, 0, 0, 1, 0]}},
    'indices': <int>[0, 1, 2],
  }}, 'released': <String>[], 'withheld': 0,
};
SceneFrame read(SceneGeometryCache cache, Map<String, dynamic> json) =>
    SceneFrame.fromJson(json, geometryCache: cache);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('transforms and visibility preserve unchanged nodes and geometry', () {
    final cache = SceneGeometryCache();
    final first = read(cache, packet(1, full: true, nodes: [node(1), node(2)], order: ['1', '2']));
    expect(first.nodes, hasLength(2));
    final moved = [...identity]..[12] = 4;
    final changed = read(cache, packet(2, changes: [{'id': 1, 'world': moved, 'visible': false}]));
    expect(changed.nodes, hasLength(2));
    expect(changed.nodes[0]['world'], moved);
    expect(changed.nodes[0]['visible'], false);
    expect(changed.nodes[1], first.nodes[1]);
    expect(changed.nodes[0]['attributes'], first.nodes[0]['attributes']);
    expect(read(cache, packet(3)).nodes, changed.nodes);
  });

  test('removal and insertion preserve stable parents and distinguish expanded parts', () {
    final cache = SceneGeometryCache();
    read(cache, packet(1, full: true, nodes: [node(1), node(2, parent: '1'), node(3, part: 0), node(3, part: 1)],
      order: ['1', '2', '3.0', '3.1']));
    final changed = read(cache, packet(2, removed: ['3.0'], nodes: [node(4)], order: ['4', '1', '2', '3.1']));
    expect(changed.nodes.map((node) => node['id']), [4, 1, 2, 3]);
    expect(changed.nodes[2]['parent'], 1);
    expect(changed.nodes.last['part'], 1);
    expect(read(cache, packet(3)).nodes, changed.nodes);
  });

  for (final bad in <String, Map<String, dynamic>>{
    'gap': packet(3),
    'stale': packet(1, changes: [{'id': 1, 'visible': false}]),
    'out of order': packet(0),
    'missing node': packet(2, changes: [{'id': 99, 'visible': false}]),
    'missing removal': packet(2, removed: ['99']),
    'missing parent': packet(2, nodes: [node(3, parent: '99')], order: ['1', '3']),
    'missing geometry': packet(2, nodes: [{...node(1), 'geometryId': 'missing'}]),
    'live geometry released': {...packet(2), 'released': ['g1']},
    'bad transform': packet(2, changes: [{'id': 1, 'world': [1]}]),
    'duplicate order': packet(2, order: ['1', '1']),
    'unsupported version': {...packet(2), 'version': 2},
  }.entries) {
    test('${bad.key} refuses the entire packet and requires full resync', () {
      final cache = SceneGeometryCache();
      final before = read(cache, packet(1, full: true, nodes: [node(1)], order: ['1']));
      expect(() => read(cache, bad.value), throwsFormatException);
      // Even a subsequent contiguous delta is unsafe after a rejected packet.
      expect(() => read(cache, packet(2)), throwsFormatException);
      final recovered = read(cache, packet(5, full: true, nodes: [node(2)], order: ['2']));
      expect(recovered.nodes.single['id'], 2);
      expect(before.nodes.single['id'], 1, reason: 'a rejected packet cannot mutate the displayed scene');
      expect(() => read(cache, packet(4, full: true, nodes: [node(9)], order: ['9'])), throwsFormatException);
    });
  }

  test('a reset cache cannot apply a delta before a full scene', () {
    final cache = SceneGeometryCache();
    expect(() => read(cache, packet(8)), throwsFormatException);
    expect(read(cache, packet(9, full: true, nodes: [node(1)], order: ['1'])).nodes, hasLength(1));
  });

  test('deterministic steps draw the same final buffers as full scenes', () async {
    const deltaChannel = MethodChannel('world.ai/delta-replay');
    const fullChannel = MethodChannel('world.ai/full-replay');
    final buffers = <String, Map<String, Object?>>{};
    final calls = <String, List<MethodCall>>{'delta': [], 'full': []};
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final entry in {'delta': deltaChannel, 'full': fullChannel}.entries) {
      buffers[entry.key] = {};
      messenger.setMockMethodCallHandler(entry.value, (call) async {
        calls[entry.key]!.add(call);
        if (call.method == 'create') return 7;
        if (call.method == 'applyScene') {
          final args = call.arguments as Map;
          if (args['full'] == true) buffers[entry.key]!.clear();
          for (final id in args['removed'] as List) { buffers[entry.key]!.remove(id); }
          for (final mesh in (args['meshes'] as List).cast<Map>()) {
            buffers[entry.key]![mesh['meshId'] as String] = mesh;
          }
        }
        return null;
      });
      addTearDown(() => messenger.setMockMethodCallHandler(entry.value, null));
    }
    final deltaRenderer = await NativeWorldRenderer.create(width: 320, height: 180, channel: deltaChannel);
    final fullRenderer = await NativeWorldRenderer.create(width: 320, height: 180, channel: fullChannel);
    final deltas = FlutterFramePipeline(deltaRenderer), full = FlutterFramePipeline(fullRenderer);
    final cache = SceneGeometryCache();
    for (var step = 1; step <= 12; step++) {
      final nodes = [node(1, x: step.toDouble(), visible: step % 3 != 0), if (step < 8) node(2)];
      final order = [for (final n in nodes) '${n['id']}'];
      final delta = step == 1 ? packet(step, full: true, nodes: nodes, order: order) : packet(step,
        changes: [{'id': 1, 'world': nodes.first['world'], 'visible': nodes.first['visible']}],
        removed: step == 8 ? ['2'] : [], order: step == 8 ? order : null);
      await deltas.draw(read(cache, delta));
      await full.draw(read(SceneGeometryCache(), packet(step, full: true, nodes: nodes, order: order)));
      expect(buffers['delta'], isNotEmpty, reason: 'the scene must actually reach the native bridge');
      expect(buffers['delta'], buffers['full'], reason: 'step $step');
    }
    final submitted = calls['delta']!.where((call) => call.method != 'create');
    expect(submitted.map((call) => call.method).toSet(), {'applyScene'}, reason: 'a complete scene is one atomic native submission');
    expect((submitted.last.arguments as Map)['generation'], 12);
    await deltaRenderer.dispose();
    await fullRenderer.dispose();
  });
}
