import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'input_owner.dart';
import 'ledger_glyphs.dart';
import 'ledger_tokens.dart';

enum SessionSurface { loading, ready, reconnecting, recoverableError, fatalError }

/// The four book tabs' pictures: the verbatim glyphs of `src/ui/glyphs.ts`. A page registered
/// under another name has its name on the tab instead.
const ledgerTabGlyphs = <String, LedgerGlyph>{
  'pack': LedgerGlyph.pack, 'journal': LedgerGlyph.book, 'map': LedgerGlyph.map, 'options': LedgerGlyph.sliders,
};
typedef LedgerPageBuilder = Widget Function(BuildContext context, LedgerTokens tokens);

class LedgerController extends ChangeNotifier {
  LedgerController(this.input);
  final InputOwnerController input;
  LedgerTheme theme = LedgerTheme.stone;
  final List<String> _routes = [];
  String? get route => _routes.isEmpty ? null : _routes.last;
  void open(String route) { _routes.add(route); input.focus(InputOwner.book, busy: 'reading'); notifyListeners(); }
  void back() { if (_routes.isNotEmpty) _routes.removeLast(); input.focus(route == null ? InputOwner.world : InputOwner.book, busy: route == null ? null : 'reading'); notifyListeners(); }
  void close() { _routes.clear(); input.focus(InputOwner.world); notifyListeners(); }
  void typing() { input.focus(InputOwner.typing, busy: 'typing'); notifyListeners(); }
  /// Somebody is talking (#574): the world's controls park under the words, and the words take the
  /// touches until the conversation is over. The engine says when; this only follows it.
  void talking(bool open) {
    if (open == (input.busy == 'talking')) return;
    if (open) {
      input.focus(InputOwner.book, busy: 'talking');
    } else {
      input.focus(route == null ? InputOwner.world : InputOwner.book, busy: route == null ? null : 'reading');
    }
    notifyListeners();
  }
  void finishTyping() { input.focus(route == null ? InputOwner.world : InputOwner.book, busy: route == null ? null : 'reading'); notifyListeners(); }
  void selectTheme(LedgerTheme next) { theme = next; notifyListeners(); }
}

/// Pass the same persistent world widget/session from the composition owner.
/// Only registered pages have navigation controls; this shell invents no gameplay actions.
class LedgerShell extends StatefulWidget {
  const LedgerShell({super.key, required this.world, required this.controller, required this.pages,
    this.readings = '', this.clock = '', this.bearings = '', this.place = '', this.actionCard,
    this.typingBuilder, this.surface = SessionSurface.ready, this.message = '', this.onReconnect,
    this.onWorldComposition, this.conversation, this.photo});
  final Widget world;
  final LedgerController controller;
  final Map<String, LedgerPageBuilder> pages;
  final String readings, clock, bearings, place, message;
  final Widget? actionCard;
  final WidgetBuilder? typingBuilder;
  final SessionSurface surface;
  final VoidCallback? onReconnect;
  final ValueChanged<Rect>? onWorldComposition;
  /// What is being said: it stays on the glass over the world, between the thumb's home and the
  /// action corner, so words and choices are never the same list (design/mobile/README.md, "A shop").
  final Widget? conversation;
  /// The app's shutter, in place of the HUD while the native world keeps drawing.
  final Widget? photo;
  @override
  State<LedgerShell> createState() => _LedgerShellState();
}

class _LedgerShellState extends State<LedgerShell> with WidgetsBindingObserver {
  Rect? _composition;
  final FocusScopeNode _worldFocus = FocusScopeNode(debugLabel: 'WORLD');
  final FocusScopeNode _bookFocus = FocusScopeNode(debugLabel: 'BOOK');
  final FocusScopeNode _typingFocus = FocusScopeNode(debugLabel: 'TYPING');
  @override
  void initState() { super.initState(); _syncInput(); WidgetsBinding.instance.addObserver(this); widget.controller.addListener(_changed); widget.controller.input.addListener(_changed); }
  void _syncInput() {
    widget.controller.input.session(widget.surface == SessionSurface.ready);
    final state = WidgetsBinding.instance.lifecycleState;
    widget.controller.input.lifecycle(state == null || state == AppLifecycleState.resumed);
  }
  void _changed() {
    if (!mounted) return;
    setState(() {});
    final owner = widget.controller.input.owner;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) (owner == InputOwner.world ? _worldFocus : owner == InputOwner.book ? _bookFocus : _typingFocus).requestFocus();
    });
  }
  @override
  void didUpdateWidget(LedgerShell old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(_changed); old.controller.input.removeListener(_changed);
      _syncInput();
      widget.controller.addListener(_changed); widget.controller.input.addListener(_changed);
    }
    if (old.surface != widget.surface) widget.controller.input.session(widget.surface == SessionSurface.ready);
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => widget.controller.input.lifecycle(state == AppLifecycleState.resumed);
  @override
  void dispose() {
    widget.controller.removeListener(_changed); widget.controller.input.removeListener(_changed);
    WidgetsBinding.instance.removeObserver(this);
    _worldFocus.dispose(); _bookFocus.dispose(); _typingFocus.dispose(); super.dispose();
  }

  Widget _button(String label, VoidCallback callback, LedgerTokens t, {double height = 44, LedgerGlyph? glyph,
      Color? colour, Color? fill}) =>
    SizedBox(key: ValueKey('ledger-$label'), height: height, width: 44, child: Semantics(button: true, label: label, excludeSemantics: true, child: TextButton(
      style: TextButton.styleFrom(foregroundColor: colour ?? t.ink, backgroundColor: fill ?? t.surface, padding: EdgeInsets.zero,
        minimumSize: const Size(44, 44), shape: const RoundedRectangleBorder()),
      onPressed: callback,
      child: glyph != null ? LedgerIcon(glyph, color: colour ?? t.ink)
        : Text(label, maxLines: 1, overflow: TextOverflow.clip, style: t.numbers(9, colour ?? t.ink)))));
  Widget _tab(String name, LedgerController c, LedgerTokens t, {double height = 44}) {
    final open = c.route == name;
    return _button(name, () => c.open(name), t, height: height, glyph: ledgerTabGlyphs[name],
      colour: open ? t.pageInk : t.ink, fill: open ? t.page : null);
  }
  /// A slab of stone in a reserved band: mono 11px, 1px tracking, on an opaque surface so small
  /// type never sits on the world alone.
  Widget _slab(String text, LedgerTokens t) => ColoredBox(color: t.surface,
    child: Padding(padding: const EdgeInsets.fromLTRB(12, 7, 12, 8), child: Text(text, style: t.numbers(11, t.ink))));

  @override
  Widget build(BuildContext context) {
    final c = widget.controller, t = LedgerTokens.all[c.theme]!;
    final parked = !c.input.acceptsWorld || widget.surface != SessionSurface.ready;
    final showBook = c.route != null;
    return LayoutBuilder(builder: (context, constraints) {
      final inset = MediaQuery.paddingOf(context);
      final safeWidth = math.max(0.0, constraints.maxWidth - inset.horizontal);
      final bookWidth = math.min(LedgerTokens.book, safeWidth);
      final composition = Rect.fromLTWH(inset.left + (showBook ? bookWidth : 44), inset.top,
        math.max(0.0, safeWidth - (showBook ? bookWidth : 44)), math.max(0.0, constraints.maxHeight - inset.vertical));
      if (composition != _composition) {
        _composition = composition;
        WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) widget.onWorldComposition?.call(composition); });
      }
      return Stack(fit: StackFit.expand, children: [
        ExcludeSemantics(excluding: parked, child: IgnorePointer(ignoring: parked,
          child: FocusScope(node: _worldFocus, autofocus: true, canRequestFocus: !parked, child: widget.world))),
        SafeArea(child: widget.surface == SessionSurface.ready && widget.photo != null ? widget.photo! : Stack(fit: StackFit.expand, children: [
          Positioned(left: 0, top: 0, child: _slab(widget.readings, t)),
          Positioned(right: 0, top: 0, child: _slab(widget.clock, t)),
          if (widget.place.isNotEmpty) Positioned(top: 16, left: 160, right: 160,
            child: Center(child: ColoredBox(color: t.surface, child: Padding(padding: const EdgeInsets.fromLTRB(20, 4, 10, 6),
              child: Text(widget.place.toUpperCase(), maxLines: 1, overflow: TextOverflow.ellipsis,
                style: t.face(18, t.ink, weight: FontWeight.w500, spacing: 10)))))),
          Positioned(bottom: 0, left: 132, right: widget.actionCard == null ? 12 : 212,
            child: Center(child: _slab(widget.bearings, t))),
          if (!showBook) Positioned(left: 0, top: 62, bottom: 144,
            child: SingleChildScrollView(child: Column(children: [
              for (final name in widget.pages.keys.take(4)) _tab(name, c, t),
            ]))),
          if (widget.conversation != null && !showBook) Positioned(left: 136, right: 216, bottom: 40,
            child: IgnorePointer(ignoring: parked && c.input.busy != 'talking', child: Align(alignment: Alignment.bottomCenter, child: widget.conversation!))),
          if (widget.actionCard != null) Positioned(right: 0, bottom: 0, width: 208,
            child: IgnorePointer(ignoring: parked, child: ExcludeSemantics(excluding: parked, child: widget.actionCard!))),
          if (parked && !showBook && c.input.busy != 'talking') Positioned(left: 56, bottom: 64, child: _slab('CONTROLS PARKED', t)),
          if (showBook) Positioned(left: 0, top: 0, bottom: 0, width: bookWidth,
            child: FocusScope(node: _bookFocus, autofocus: true, onKeyEvent: (_, event) {
              if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.back(); return KeyEventResult.handled; }
              return KeyEventResult.ignored;
            }, child: Focus(onKeyEvent: (_, event) {
              if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.back(); return KeyEventResult.handled; }
              return KeyEventResult.ignored;
            }, child: TweenAnimationBuilder<double>(
              // the book arrives from the left, as a page turned in; at once when motion is reduced
              tween: Tween(begin: 1, end: 0),
              duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
              curve: Curves.easeOut,
              builder: (context, away, book) => FractionalTranslation(translation: Offset(-away, 0), child: book),
              child: AnimatedContainer(key: const ValueKey('ledger-book'),
              duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
              color: t.page, child: Row(children: [
                SizedBox(width: 44, child: ColoredBox(color: t.surface, child: Column(children: [
                  Expanded(child: SingleChildScrollView(child: Column(children: [
                    for (final name in widget.pages.keys.take(4)) _tab(name, c, t, height: 48),
                  ]))),
                  _button('Back', c.back, t, glyph: LedgerGlyph.turnLeft),
                  DecoratedBox(decoration: BoxDecoration(border: Border(top: BorderSide(color: t.rule))),
                    child: _button('Close', c.close, t, height: 52, glyph: LedgerGlyph.close, colour: t.accent)),
                ]))),
                Expanded(child: DefaultTextStyle(style: t.face(14.5, t.pageInk),
                  child: widget.pages[c.route]?.call(context, t) ?? Center(child: Text('Page unavailable', style: TextStyle(color: t.pageInk))))),
              ])))))),
          if (showBook && safeWidth > bookWidth + 120) Positioned(left: bookWidth, right: 0, bottom: 0,
            child: _slab('CONTROLS PARKED · ✕ PUTS THE BOOK AWAY', t)),
          if (c.input.owner == InputOwner.typing && widget.typingBuilder != null)
            Positioned.fill(child: ColoredBox(color: t.surface, child: FocusScope(node: _typingFocus, autofocus: true,
              onKeyEvent: (_, event) {
                if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.finishTyping(); return KeyEventResult.handled; }
                return KeyEventResult.ignored;
              },
              child: Focus(onKeyEvent: (_, event) {
                if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.finishTyping(); return KeyEventResult.handled; }
                return KeyEventResult.ignored;
              }, child: widget.typingBuilder!(context))))),
          if (widget.surface != SessionSurface.ready) Positioned.fill(child: ColoredBox(color: t.surface,
            child: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(widget.message.isEmpty ? widget.surface.name : widget.message, style: TextStyle(color: t.ink)),
              if (widget.onReconnect != null && [SessionSurface.reconnecting, SessionSurface.recoverableError].contains(widget.surface))
                SizedBox(height: 44, child: TextButton(onPressed: widget.onReconnect, child: Text('Reconnect', style: TextStyle(color: t.ink)))),
            ])))),
        ])),
      ]);
    });
  }
}

class LedgerRow extends StatelessWidget {
  const LedgerRow({super.key, required this.name, required this.tokens, this.consequence = '', this.verb = '', this.onPressed, this.chip = const Color(0xff8a6a3d)});
  final String name, consequence, verb;
  final LedgerTokens tokens;
  final Color chip;
  final VoidCallback? onPressed;
  @override
  Widget build(BuildContext context) => SizedBox(height: 44, child: Semantics(button: onPressed != null,
    child: InkWell(onTap: onPressed, child: DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: tokens.rule))),
      child: Padding(padding: const EdgeInsets.only(left: 12, right: 12), child: Row(children: [
        Transform.rotate(angle: math.pi / 4, child: ColoredBox(color: chip, child: const SizedBox(width: 13, height: 13))),
        const SizedBox(width: 12), Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tokens.face(14.5, tokens.pageInk))),
        // a consequence gives way before the name or the verb does, on one line
        Flexible(child: Text(consequence, maxLines: 1, overflow: TextOverflow.ellipsis, style: tokens.numbers(11, tokens.pageDim, spacing: 0))),
        const SizedBox(width: 8),
        Text(verb, style: tokens.numbers(11, tokens.pageInk, weight: FontWeight.w600, spacing: 0)),
      ]))))));
}

/// What each theme is, in the design's own words (design/mobile/AIWorldMobile.dc.html, 13a).
const ledgerThemeNotes = <LedgerTheme, String>{
  LedgerTheme.stone: 'Dark glass over the world: the one that reads over a sunlit field and a cave floor.',
  LedgerTheme.vellum: "A cartographer's document: warm vellum, brown ink, sealing-wax red.",
  LedgerTheme.steel: 'Chamfered instrument plates, condensed caps, enamel blue and signal red.',
  LedgerTheme.hairline: 'One mono family, 1px rules, no fills except one solid white verb block.',
};

/// Options → theme (13a): one 64px row per theme, its swatch drawn in that theme. The list is the
/// preview; a tap applies it at once.
class LedgerThemePicker extends StatelessWidget {
  const LedgerThemePicker({super.key, required this.controller});
  final LedgerController controller;
  @override
  Widget build(BuildContext context) {
    final page = LedgerTokens.all[controller.theme]!;
    return ListView(children: [
      Padding(padding: const EdgeInsets.fromLTRB(12, 9, 12, 8),
        child: Text('THEME · HOW THE INTERFACE IS DRESSED', style: page.numbers(9, page.pageDim, spacing: 2))),
      for (final theme in LedgerTheme.values) _row(theme, page),
    ]);
  }

  Widget _row(LedgerTheme theme, LedgerTokens page) {
    final own = LedgerTokens.all[theme]!;
    final on = controller.theme == theme;
    return SizedBox(key: ValueKey('theme-${theme.name}'), height: 64, child: Semantics(button: true, selected: on,
      label: '${theme.name} theme', child: InkWell(onTap: () => controller.selectTheme(theme),
      child: DecoratedBox(decoration: BoxDecoration(border: Border(bottom: BorderSide(color: page.rule))),
        child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [
          // the swatch: its surface, its 1px rule, a 4px accent bar, its face and ink, its action block
          Container(width: 84, height: 40, decoration: BoxDecoration(color: own.surface, border: Border.all(color: own.rule)),
            child: Row(children: [
              Container(width: 4, color: own.accent),
              Expanded(child: Center(child: Text('AaBb 72', style: own.face(12, own.ink)))),
              Container(width: 26, color: own.action),
            ])),
          const SizedBox(width: 12),
          Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(theme.name[0].toUpperCase() + theme.name.substring(1), style: page.face(17, page.pageInk).copyWith(fontFamily: 'EBGaramond')),
            // the note gives way to the row's height on a narrow page rather than overflowing it
            Flexible(child: Text(ledgerThemeNotes[theme]!, maxLines: 2, overflow: TextOverflow.ellipsis, style: page.numbers(9.5, page.pageDim, spacing: 0))),
          ])),
          const SizedBox(width: 8),
          // ink on the page and the page on ink, so both read on every theme's page
          on ? ColoredBox(color: page.pageInk, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text('ON ✓', style: page.numbers(10, page.page))))
            : Text('USE IT', style: page.numbers(10, page.pageInk).copyWith(decoration: TextDecoration.underline)),
        ]))))));
  }
}
