import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import 'scene_frame.dart';
import 'state_engine.dart';
import 'storage/checkpoint_store.dart';

/// Which game: the world it is played in and the slot it is kept in.
@immutable
class GameSlot {
  const GameSlot({required this.slot, required this.seed, this.kind = 'road', this.name = 'Traveller'});
  /// Printable ASCII, at most 48 characters: it names the slot's files.
  final String slot;
  final int seed;
  /// `road` or `endless`, the two countries the game grows.
  final String kind;
  final String name;

  StorageScope scope(String domain) => StorageScope(domain: domain, world: slot, seed: seed, player: 'local-hero', kind: kind);
}

/// Nothing held: the input the session sends when nobody is touching anything.
const stillInput = <String, Object?>{
  'move': [0, 0], 'look': [0, 0], 'held': {'guard': false, 'run': false}, 'actions': <String>[], 'owner': 'WORLD', 'busy': null,
};

/// The whole game in this app (#563, #564, #577).
///
/// The bundled engine (`src/mobile/game-engine.ts`) is stepped at the display's pace with whatever
/// the controls hold; the frames it draws go to the native renderer; and the hero's save and the
/// private world's own records are kept in app-private storage, each in its own namespace, so a
/// game left is a game continued and nothing of one slot reaches another. Nothing is fetched and
/// nothing runs anywhere but on the phone.
class GameSession {
  GameSession._(this.slot, this.engine, this.saves, this.world, this._records, this._pipeline);

  final GameSlot slot;
  final StateEngine engine;
  final CheckpointStore saves;
  final CheckpointStore world;
  final Map<String, String> _records;
  final FlutterFramePipeline? _pipeline;
  final SceneGeometryCache _geometry = SceneGeometryCache();
  /// What the game last said: the HUD, the conversation, the hero, who owns the input.
  final ValueNotifier<Map<String, dynamic>> presentation = ValueNotifier(const {});
  /// A failure the player should be told about, such as a save that could not be written.
  final ValueNotifier<String?> trouble = ValueNotifier(null);
  /// Every face the game has painted this session, by the key a conversation names it by.
  final Map<String, Map<String, dynamic>> portraits = {};
  /// The journal as the game last sent it; it is sent only when it changes.
  Map<String, dynamic> journal = const {};
  Map<String, Object?> _input = stillInput;
  Ticker? _ticker;
  Duration _last = Duration.zero;
  int _tick = -1;
  double _time = 0;
  bool _stepping = false;
  bool _closed = false;
  /// Closing: the renderer may already be gone, so nothing more is drawn.
  bool _closing = false;
  int _sinceScene = 0;
  /// Frames are drawn every this many steps: a frame is the whole scene, and the phone's renderer
  /// keeps drawing the last one between them.
  int sceneEvery = 2;
  Timer? _keeping;

  /// Open the slot's game: continue it if it was kept, start it if not.
  static Future<GameSession> open(GameSlot slot, {required Directory root, required Size viewport,
      FlutterFramePipeline? pipeline, MethodChannel? channel, AssetBundle? assets}) async {
    final saves = await CheckpointStore.open(root, slot.scope('player'));
    final world = await CheckpointStore.open(root, slot.scope('world'));
    final saved = await saves.load('save');
    final records = <String, String>{
      for (final entry in ((await world.load('records') as Map?) ?? const {}).entries) '${entry.key}': '${entry.value}',
    };
    final engine = await StateEngine.openGame('game:${slot.slot}', {
      'seed': slot.seed, 'kind': slot.kind, 'slot': slot.slot, 'name': slot.name,
      'viewport': {'width': viewport.width, 'height': viewport.height},
      'saved': ?saved,
      'world': records,
    }, channel: channel, assets: assets);
    final session = GameSession._(slot, engine, saves, world, records, pipeline);
    try {
      session._take(await engine.request('start', {'mode': 'local', 'world': slot.slot}));
      return session;
    } catch (_) {
      await engine.dispose();
      rethrow;
    }
  }

  /// Whether the slot holds a game to continue.
  static Future<bool> kept(GameSlot slot, {required Directory root}) async =>
    await (await CheckpointStore.open(root, slot.scope('player'))).load('save') != null;

  /// Step at the display's pace from now on.
  void run(TickerProvider vsync) {
    _ticker?.dispose();
    _ticker = vsync.createTicker(_frame)..start();
  }

  /// What the controls hold now, in the shared contract's shape; `InputOwnerController` sends this.
  void hold(Map<String, Object?> input) { _input = Map<String, Object?>.of(input); }

  /// A one-shot player action by name, or `choose` a row of the conversation.
  Future<void> act(String action, {String? target}) async {
    if (_closed) return;
    _take(await engine.request('action', {'action': action, 'target': target, 'args': null}));
  }

  /// The app has gone to the background, or come back.
  Future<void> lifecycle(bool active) async {
    if (_closed) return;
    _take(await engine.request('lifecycle', {'state': active ? 'active' : 'background', 'renderTimeMs': _time}));
  }

  Future<void> _frame(Duration elapsed) async {
    if (_stepping || _closed) return;
    final dt = ((elapsed - _last).inMicroseconds / 1e6).clamp(0.0, 0.1);
    if (dt < 1 / 120) return;
    _last = elapsed;
    _stepping = true;
    try {
      await step(dt);
    } catch (error) {
      trouble.value = 'The game stopped: $error';
      _ticker?.stop();
    } finally {
      _stepping = false;
    }
  }

  /// One step of `dt` seconds with what the controls hold, and the frame it drew when one is due.
  Future<Map<String, dynamic>> step(double dt) async {
    if (++_sinceScene >= sceneEvery) {
      _sinceScene = 0;
      _take(await engine.request('resync', {'reason': 'scene'}));
    }
    _tick++;
    _time += dt * 1000;
    final input = _input;
    // a one-shot action is sent once, however many frames the finger stays down
    if ((input['actions'] as List?)?.isNotEmpty ?? false) _input = {..._input, 'actions': <String>[]};
    return _take(await engine.request('step', {'tick': _tick, 'dtSeconds': dt, 'renderTimeMs': _time, 'input': input}));
  }

  Map<String, dynamic> _take(Map<String, dynamic> reply) {
    if (reply['type'] != 'result') throw StateError('The game refused a request: ${reply['payload']}');
    final state = Map<String, dynamic>.from(reply['payload']['state'] as Map);
    final models = Map<String, dynamic>.from(state['models'] as Map);
    final save = models['save'];
    if (save != null) {
      saves.commit('save', save).catchError((Object error) { trouble.value = 'Could not save: $error'; });
    }
    final records = models['world'];
    if (records is Map) {
      records.forEach((name, text) => _records['$name'] = '$text');
      // the world writes often and a little at a time; it is kept at most every couple of seconds
      _keeping ??= Timer(const Duration(seconds: 2), () { _keeping = null; _keepWorld(); });
    }
    // a face is sent once, the first time somebody wears it, and named by key after that
    final faces = models['portraits'];
    if (faces is Map) faces.forEach((key, face) => portraits['$key'] = Map<String, dynamic>.from(face as Map));
    final read = models['journal'];
    if (read is Map) journal = Map<String, dynamic>.from(read);
    final scene = models['scene'];
    if (scene is Map && _pipeline != null && !_closing) {
      unawaited(_pipeline.draw(SceneFrame.fromJson(Map<String, dynamic>.from(scene), geometryCache: _geometry)));
    }
    presentation.value = state;
    return state;
  }

  Future<void> _keepWorld() => world.commit('records', Map<String, String>.of(_records))
    .catchError((Object error) { trouble.value = 'Could not keep the world: $error'; });

  /// Save the hero and the world now, and wait until both are on disk.
  Future<void> save() async {
    // every reply can carry the save: this one when the game writes it at once, the next one when
    // the write finishes after the request has returned
    _take(await engine.request('resync', {'reason': 'save'}));
    _tick++;
    _take(await engine.request('step', {'tick': _tick, 'dtSeconds': 0.001, 'renderTimeMs': _time += 1, 'input': stillInput}));
    _keeping?.cancel();
    _keeping = null;
    await _keepWorld();
    await saves.flush();
    await world.flush();
  }

  /// Save, and let everything go.
  Future<void> close() async {
    if (_closed || _closing) return;
    _closing = true;
    _ticker?.dispose();
    _ticker = null;
    try {
      await save();
    } finally {
      _closed = true;
      await engine.dispose();
    }
  }
}
