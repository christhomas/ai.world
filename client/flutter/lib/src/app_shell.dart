import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'game_session.dart';
import 'invite.dart';
import 'screens/company_page.dart';
import 'screens/console_page.dart';
import 'screens/conversation_band.dart';
import 'screens/journal_page.dart';
import 'screens/map_page.dart';
import 'screens/options_page.dart';
import 'screens/roster_page.dart';
import 'screens/pack_page.dart';
import 'native_world_renderer.dart';
import 'scene_frame.dart';
import 'shell/input_owner.dart';
import 'shell/ledger_action_card.dart';
import 'shell/ledger_shell.dart';
import 'shell/ledger_stick.dart';
import 'shell/ledger_tokens.dart';
import 'shell/more_controls.dart';
import 'shell/name_plates.dart';
import 'state_engine.dart';
import 'storage/checkpoint_store.dart';

enum _Phase { title, opening, playing }

/// The installed game (#570, #571, #572): a title to start or continue from, then the game itself
/// behind the Ledger shell. This is the one owner of the world view, the session, the controls and
/// the routes; screens register pages with it rather than building their own.
class AppShell extends StatefulWidget {
  const AppShell({super.key, this.storageRoot, this.engineChannel, this.assets});
  /// App-private storage; the native host's when not given.
  final Directory? storageRoot;
  final MethodChannel? engineChannel;
  final AssetBundle? assets;
  @override
  State<AppShell> createState() => _AppShellState();
}

/// The game being played, for the installed-app journeys (`integration_test/`, #584) to watch. They
/// read it and never act through it: every move they make is a touch on the screen.
@visibleForTesting
final playing = ValueNotifier<GameSession?>(null);

class _AppShellState extends State<AppShell> with TickerProviderStateMixin, WidgetsBindingObserver {
  _Phase _phase = _Phase.title;
  Directory? _root;
  CheckpointStore? _settings;
  GameSlot? _last;
  GameSession? _session;
  String? _trouble;
  late final InputOwnerController _input = InputOwnerController((value) => _session?.hold(value));
  late final LedgerController _ledger = LedgerController(_input)..addListener(_keepTheme);
  Widget? _world;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_openSettings());
  }

  Future<void> _openSettings() async {
    try {
      final root = widget.storageRoot ?? Directory(await StateEngine.storageRoot());
      final settings = await CheckpointStore.open(root,
        const StorageScope(domain: 'settings', world: 'app', seed: 0, player: 'local-hero', kind: 'road'));
      final last = await settings.load('last') as Map?;
      final theme = await settings.load('theme');
      final volume = await settings.load('volume');
      GameSlot? slot;
      if (last != null) {
        slot = GameSlot(slot: last['slot'] as String, seed: last['seed'] as int, kind: last['kind'] as String,
          name: last['name'] as String? ?? 'Traveller', server: last['server'] as String?);
        if (!await GameSession.kept(slot, root: root)) slot = null;
      }
      if (!mounted) return;
      setState(() {
        _root = root;
        _settings = settings;
        _last = slot;
        final chosen = LedgerTheme.values.where((t) => t.name == theme).firstOrNull;
        _keptTheme = chosen ?? _ledger.theme;
        if (volume is num) _volume = volume.toDouble();
        if (chosen != null) _ledger.selectTheme(chosen);
      });
    } catch (error) {
      if (mounted) setState(() => _trouble = 'Storage is unavailable: $error');
    }
  }

  /// How loud the game is: the game's own volume, remembered by the app and given to each game it opens.
  double? _volume;
  void _setVolume(double level) {
    _volume = level;
    unawaited(_session?.act('volume', args: {'level': level}));
    unawaited(_settings?.commit('volume', level).catchError((Object _) {}));
  }

  LedgerTheme? _keptTheme;
  void _keepTheme() {
    if (_ledger.theme == _keptTheme) return;
    _keptTheme = _ledger.theme;
    unawaited(_settings?.commit('theme', _ledger.theme.name).catchError((Object _) {}));
  }

  /// A new game in a slot of its own, so starting one never overwrites another.
  void _newGame() {
    final seed = math.Random().nextInt(0x7fffffff);
    _open(GameSlot(slot: 'local-${DateTime.now().millisecondsSinceEpoch}', seed: seed, name: 'Traveller'));
  }

  /// A shared world, from the invite link somebody sent (#565, #572).
  bool _joining = false;
  final _invite = TextEditingController();
  void _join() {
    final (invite, why) = WorldInvite.parse(_invite.text);
    if (invite == null) { setState(() => _trouble = why); return; }
    _open(invite.slot());
  }

  void _open(GameSlot slot) {
    setState(() {
      _phase = _Phase.opening;
      _trouble = null;
      _last = slot;
      // one world view for the whole game, kept across every route and theme
      _world = NativeWorldView(key: const ValueKey('world'), onCreated: (renderer) => _start(slot, renderer));
    });
    unawaited(_settings?.commit('last', {'slot': slot.slot, 'seed': slot.seed, 'kind': slot.kind, 'name': slot.name,
        'server': ?slot.server})
      .catchError((Object _) {}));
  }

  Future<void> _start(GameSlot slot, NativeWorldRenderer renderer) async {
    try {
      final size = MediaQuery.sizeOf(context);
      final session = await GameSession.open(slot, root: _root!, viewport: size,
        pipeline: FlutterFramePipeline(renderer), channel: widget.engineChannel, assets: widget.assets);
      if (!mounted) { await session.close(); return; }
      session.trouble.addListener(() => setState(() => _trouble = session.trouble.value));
      // a conversation parks the world's controls, as the game does on the page
      session.presentation.addListener(() => _ledger.talking(session.presentation.value['busy'] == 'talking'));
      session.run(this);
      // the volume the player chose last time, which a new game would otherwise not know
      if (_volume case final volume?) unawaited(session.act('volume', args: {'level': volume}));
      setState(() { _session = session; _phase = _Phase.playing; });
      playing.value = session;
    } catch (error) {
      if (mounted) setState(() { _phase = _Phase.title; _world = null; _trouble = 'Could not open the game: $error'; });
    }
  }

  Future<void> _leave() async {
    final session = _session;
    _ledger.close();
    setState(() { _session = null; _phase = _Phase.title; _world = null; });
    playing.value = null;
    try {
      await session?.close();
    } catch (error) {
      if (mounted) setState(() => _trouble = 'Your game could not be saved: $error');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final session = _session;
    if (session == null) return;
    final active = state == AppLifecycleState.resumed;
    unawaited(session.lifecycle(active).catchError((Object _) {}));
    // going away is when a phone may stop the app without asking, so the game is kept as it goes
    if (state == AppLifecycleState.paused) unawaited(session.save().catchError((Object _) {}));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_session?.close());
    _invite.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = LedgerTokens.all[_ledger.theme]!;
    if (_phase == _Phase.title) return _title(t);
    final session = _session;
    if (session == null) {
      return Stack(fit: StackFit.expand, children: [
        _world ?? const SizedBox.shrink(),
        ColoredBox(color: t.surface, child: Center(child: Text('Opening the world…', style: t.face(17, t.ink)))),
      ]);
    }
    return ValueListenableBuilder<Map<String, dynamic>>(valueListenable: session.presentation, builder: (context, state, _) {
      final models = Map<String, dynamic>.from(state['models'] as Map? ?? const {});
      final hud = Map<String, dynamic>.from(models['hud'] as Map? ?? const {});
      final hero = Map<String, dynamic>.from(models['hero'] as Map? ?? const {});
      final breath = Map<String, dynamic>.from(hud['breath'] as Map? ?? const {});
      final talk = models['conversation'] as Map?;
      final hp = (hero['hp'] as num?) ?? 0, maxHp = math.max(1, (hero['maxHp'] as num?) ?? 1);
      final wind = ((breath['wind'] as num?) ?? 1).toDouble();
      final action = hud['action'] as String?;
      return LedgerShell(
        world: Stack(fit: StackFit.expand, children: [
          _world!,
          // other players' names, where the game says they hang over their heads
          NamePlates(plates: (hud['plates'] as List? ?? const []).cast<Map>(), tokens: t),
          LedgerStick(input: _input, health: hp / maxHp, breath: wind,
            onZoom: (by) => unawaited(session.act('zoom', args: {'by': by.clamp(-5000.0, 5000.0)}))),
          // the rest of the keyboard, under the clock, as the page's touch controls keep it; the
          // console is among them, and typing parks the world as it does on the page
          Positioned(top: 40, right: 8, child: MoreControls(tokens: t, onAction: (action) {
            if (action == 'console') {
              _ledger.typing();
            } else if (action == 'company') {
              // the travellers are a page of the app's own, as the roster is
              _ledger.open('company');
            } else {
              unawaited(session.act(action));
            }
          })),
        ]),
        controller: _ledger,
        typingBuilder: (context) => ConsolePage(lines: (hud['chat'] as List? ?? const []).cast<Map>(), tokens: t,
          say: (text) => unawaited(session.act('say', args: {'text': text})), done: _ledger.finishTyping),
        // the four tabs, in the design's order; a screen registers its page here (#573–#575)
        pages: {
          'pack': (context, tokens) => PackPage(pack: Map<String, dynamic>.from(models['pack'] as Map? ?? const {}), tokens: tokens,
            take: (id) => unawaited(session.act('take', target: id)), stow: (slot) => unawaited(session.act('stow', target: slot))),
          'journal': (context, tokens) => JournalPage(journal: session.journal, tokens: tokens),
          'map': (context, tokens) => MapPage(picture: session.mapPicture, map: session.map, walked: session.walked,
            charted: session.charted, hero: hero, tokens: tokens, floor: session.floor),
          'options': (context, tokens) => OptionsPage(slot: session.slot, tokens: tokens, controller: _ledger,
            leave: () => unawaited(_leave()), seeThrough: () => unawaited(session.act('seeThrough')),
            volume: ((hud['volume'] as num?) ?? 0.6).toDouble(), setVolume: _setVolume),
          // past the four tabs: reached from Options
          'roster': (context, tokens) => RosterPage(roster: session.roster, tokens: tokens,
            read: (by) => unawaited(session.act('read', target: by == null ? null : 'roster:$by'))),
          // and from the more controls
          'company': (context, tokens) => CompanyPage(company: session.company, tokens: tokens,
            read: (what) => unawaited(session.act('read', target: what))),
        },
        place: '${hud['area'] ?? ''}',
        readings: '${hp.round()}/${maxHp.round()} · ${(wind * 100).round()} BREATH',
        clock: _clock(hero),
        bearings: _trouble ?? '${hero['gold'] ?? 0} GOLD',
        message: _trouble ?? '',
        conversation: talk == null ? null : ConversationBand(talk: Map<String, dynamic>.from(talk), portraits: session.portraits, tokens: t,
          onAdvance: () => unawaited(session.act('interact')),
          onChoose: (row) => unawaited(session.act('choose', target: '$row')),
          onNudge: (row, dir) => unawaited(session.act('nudge', target: '$row:$dir'))),
        actionCard: LedgerActionCard(input: _input, tokens: t,
          subject: action == null ? 'NOTHING IN REACH' : action.toUpperCase(),
          verbs: action == null ? const {} : {'TALK · USE': () => unawaited(session.act('interact'))},
          onPrimaryPress: () => unawaited(session.act('attack'))),
      );
    });
  }

  String _clock(Map<String, dynamic> hero) {
    final minutes = ((((hero['time'] as num?) ?? 0) * 24 * 60).floor()) % (24 * 60);
    final hh = '${minutes ~/ 60}'.padLeft(2, '0'), mm = '${minutes % 60}'.padLeft(2, '0');
    return '$hh:$mm · DAY ${hero['day'] ?? 1} · ${'${hero['season'] ?? ''}'.toUpperCase()}';
  }

  Widget _title(LedgerTokens t) => ColoredBox(color: t.surface, child: SafeArea(child: Center(child: Column(
    mainAxisSize: MainAxisSize.min, children: [
      Text('AI WORLD', style: t.face(27, t.ink, weight: FontWeight.w500, spacing: 10)),
      const SizedBox(height: 24),
      if (_last != null) _titleButton('Continue', t, () => _open(_last!), const ValueKey('continue')),
      _titleButton('New game', t, _root == null ? null : _newGame, const ValueKey('new-game')),
      if (!_joining) _titleButton('Join a world', t, _root == null ? null : () => setState(() => _joining = true), const ValueKey('join'))
      else ...[
        SizedBox(width: 240, child: TextField(key: const ValueKey('invite'), controller: _invite, autocorrect: false,
          keyboardType: TextInputType.url, style: t.numbers(12, t.ink, spacing: 0),
          decoration: InputDecoration(hintText: 'Paste the invite link', hintStyle: t.numbers(12, t.dim, spacing: 0)),
          onSubmitted: (_) => _join())),
        const SizedBox(height: 8),
        _titleButton('Join', t, _join, const ValueKey('join-world')),
      ],
      if (_trouble != null) Padding(padding: const EdgeInsets.only(top: 16),
        child: Text(_trouble!, style: t.numbers(11, t.dim, spacing: 0))),
    ]))));

  Widget _titleButton(String label, LedgerTokens t, VoidCallback? onPressed, Key key) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: SizedBox(key: key, width: 240, height: 44, child: TextButton(onPressed: onPressed,
      style: TextButton.styleFrom(backgroundColor: t.action, foregroundColor: t.actionInk, shape: const RoundedRectangleBorder()),
      child: Text(label.toUpperCase(), style: t.numbers(12.5, t.actionInk, spacing: 2)))));
}
