import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import 'audio/synth.dart';
import 'network/world_socket_link.dart';
import 'scene_frame.dart';
import 'state_engine.dart';
import 'storage/checkpoint_store.dart';

/// Which game: the world it is played in and the slot it is kept in.
@immutable
class GameSlot {
  const GameSlot({required this.slot, required this.seed, this.kind = 'road', this.name = 'Traveller', this.server});
  /// Printable ASCII, at most 48 characters: it names the slot's files.
  final String slot;
  final int seed;
  /// `road` or `endless`, the two countries the game grows.
  final String kind;
  final String name;
  /// A shared world's address (`wss://…`) to join instead of a private world (#565).
  final String? server;

  StorageScope scope(String domain) => StorageScope(domain: domain, world: slot, seed: seed, player: 'local-hero', kind: kind);
}

/// Opens a shared world's socket for a session; the app's own is `NativeWorldSocketLink`.
typedef ParcelSocketFactory = ParcelSocket Function(Uri url,
    {required void Function() onOpen, required void Function(Object parcel) onMessage, required void Function(String why) onClose});

/// The app's own socket. Only a debug build may reach a world without TLS, and then only on this
/// machine or the local network; a release build speaks `wss` or nothing.
ParcelSocket nativeParcelSocket(Uri url,
    {required void Function() onOpen, required void Function(Object parcel) onMessage, required void Function(String why) onClose}) =>
  NativeWorldSocketLink(config: WorldSocketConfig(endpoint: url, allowInsecureDevelopment: kDebugMode),
    onOpen: onOpen, onMessage: onMessage, onClose: onClose, onStatus: (_) {});

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
  GameSession._(this.slot, this.engine, this.saves, this.world, this._records, this._pipeline, this._sockets, this._sound);

  final GameSlot slot;
  final StateEngine engine;
  final CheckpointStore saves;
  final CheckpointStore world;
  final Map<String, String> _records;
  final FlutterFramePipeline? _pipeline;
  final ParcelSocketFactory _sockets;
  /// Where the game's sounds are played, and what makes them (#578).
  final SoundOutput _sound;
  final Synth _synth = Synth();
  /// What draws the frames, for the installed-app journeys to read back and refuse a blank one.
  @visibleForTesting
  FlutterFramePipeline? get pipeline => _pipeline;
  /// The shared world's socket the game asked for, and which of its connections that was.
  ParcelSocket? _socket;
  int _connection = 0;
  final SceneGeometryCache _geometry = SceneGeometryCache();
  /// What the game last said: the HUD, the conversation, the hero, who owns the input.
  final ValueNotifier<Map<String, dynamic>> presentation = ValueNotifier(const {});
  /// A failure the player should be told about, such as a save that could not be written.
  final ValueNotifier<String?> trouble = ValueNotifier(null);
  /// Every face the game has painted this session, by the key a conversation names it by.
  final Map<String, Map<String, dynamic>> portraits = {};
  /// The journal as the game last sent it; it is sent only when it changes.
  Map<String, dynamic> journal = const {};
  /// The roster as the game last sent it, while the roster page asks for it.
  Map<String, dynamic> roster = const {};
  /// The floor the hero is on while he is underground; null above ground.
  Map<String, dynamic>? floor;
  /// The map's ground and roads, sent once (`src/world/map-ground.ts`).
  Map<String, dynamic>? mapPicture;
  /// The map's markers and title as last sent, and every chunk walked and province charted so far.
  Map<String, dynamic> map = const {};
  final Set<String> walked = {}, charted = {};
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
      FlutterFramePipeline? pipeline, MethodChannel? channel, AssetBundle? assets,
      ParcelSocketFactory sockets = nativeParcelSocket, SoundOutput? sound}) async {
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
      'server': ?slot.server,
    }, channel: channel, assets: assets);
    final session = GameSession._(slot, engine, saves, world, records, pipeline, sockets, sound ?? NativeSound());
    try {
      session._take(await engine.request('start', {'mode': slot.server == null ? 'local' : 'remote', 'world': slot.slot}));
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
  Future<void> act(String action, {String? target, Object? args}) async {
    if (_closed) return;
    _take(await engine.request('action', {'action': action, 'target': target, 'args': args}));
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
    final register = models['roster'];
    if (register is Map) roster = Map<String, dynamic>.from(register);
    if (models.containsKey('floor')) {
      final below = models['floor'];
      floor = below is Map ? Map<String, dynamic>.from(below) : null;
    }
    final picture = models['mapPicture'];
    if (picture is Map) mapPicture = Map<String, dynamic>.from(picture);
    final mapped = models['map'];
    if (mapped is Map) {
      map = Map<String, dynamic>.from(mapped);
      walked.addAll(((mapped['walked'] as List?) ?? const []).map((key) => '$key'));
      charted.addAll(((mapped['charted'] as List?) ?? const []).map((id) => '$id'));
    }
    _relay(models);
    // the sounds the game made since the last reply, made here and played at the game's volume
    final sounds = models['sounds'];
    if (sounds is List && !_closing) {
      final volume = (((models['hud'] as Map?)?['volume'] as num?) ?? 0.6).toDouble().clamp(0.0, 1.0);
      for (final voices in sounds.cast<List>()) {
        unawaited(_sound.play(_synth.render(voices.cast<Map>(), volume: volume), _synth.rate));
      }
    }
    final scene = models['scene'];
    if (scene is Map && _pipeline != null && !_closing) {
      unawaited(_pipeline.draw(SceneFrame.fromJson(Map<String, dynamic>.from(scene), geometryCache: _geometry)));
    }
    presentation.value = state;
    return state;
  }

  /// A shared world's socket, as the game asks for it: opened, sent on, closed (#565).
  void _relay(Map<String, dynamic> models) {
    final asked = models['link'];
    if (asked is Map && asked['connect'] is String) {
      _connect('${asked['connect']}', (asked['generation'] as num).toInt());
    } else if (asked is Map && asked['close'] != null) {
      _disconnect();
    }
    final outbox = models['outbox'];
    final socket = _socket;
    if (outbox is! List || socket == null) return;
    final connection = _connection;
    for (final parcel in outbox.cast<Map>()) {
      final Object sent = parcel['text'] ?? base64Decode('${parcel['binary']}');
      unawaited(socket.send(sent).catchError((Object error) {
        // a parcel the socket would not take is a connection that is no use: the game hears it closed,
        // then the socket is let go
        if (connection != _connection) return;
        unawaited(_tell(connection, 'close', '$error'));
        _disconnect();
      }));
    }
  }

  void _connect(String url, int connection) {
    _disconnect();
    _connection = connection;
    try {
      final socket = _sockets(Uri.parse(url),
        onOpen: () => unawaited(_tell(connection, 'open')),
        onMessage: (parcel) => unawaited(_tell(connection, 'message', parcel)),
        onClose: (why) => unawaited(_tell(connection, 'close', why)));
      _socket = socket;
      unawaited(socket.start().catchError((Object error) => _tell(connection, 'close', '$error')));
    } catch (error) {
      // an address the app will not open, such as a cleartext one in a release build
      unawaited(_tell(connection, 'close', '$error'));
    }
  }

  /// Let the socket go, and with it its connection: anything it says afterwards is not passed on.
  void _disconnect() {
    final socket = _socket;
    _socket = null;
    _connection = 0;
    if (socket != null) unawaited(socket.close());
  }

  /// What the socket did, told to the game, unless the game has moved on to another connection.
  Future<void> _tell(int connection, String event, [Object? data]) async {
    if (_closed || connection != _connection) return;
    final message = event == 'message';
    try {
      _take(await engine.request('parcel', {
        'generation': connection, 'event': event,
        'text': message && data is String ? data : null,
        'binary': message && data is! String ? base64Encode(data as List<int>) : null,
        'why': event == 'close' ? '${data ?? 'closed'}' : null,
      }));
    } catch (error) {
      trouble.value = 'The shared world could not be heard: $error';
    }
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
      _disconnect();
      await engine.dispose();
    }
  }
}
