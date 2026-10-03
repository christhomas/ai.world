import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'input_owner.dart';
import 'ledger_tokens.dart';

enum SessionSurface { loading, ready, reconnecting, recoverableError, fatalError }
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
  void finishTyping() { input.focus(route == null ? InputOwner.world : InputOwner.book, busy: route == null ? null : 'reading'); notifyListeners(); }
  void selectTheme(LedgerTheme next) { theme = next; notifyListeners(); }
}

/// Pass the same persistent world widget/session from the composition owner.
/// Only registered pages have navigation controls; this shell invents no gameplay actions.
class LedgerShell extends StatefulWidget {
  const LedgerShell({super.key, required this.world, required this.controller, required this.pages,
    this.readings = '', this.clock = '', this.bearings = '', this.place = '', this.actionCard,
    this.typingBuilder, this.surface = SessionSurface.ready, this.message = '', this.onReconnect,
    this.onWorldComposition});
  final Widget world;
  final LedgerController controller;
  final Map<String, LedgerPageBuilder> pages;
  final String readings, clock, bearings, place, message;
  final Widget? actionCard;
  final WidgetBuilder? typingBuilder;
  final SessionSurface surface;
  final VoidCallback? onReconnect;
  final ValueChanged<Rect>? onWorldComposition;
  @override
  State<LedgerShell> createState() => _LedgerShellState();
}

class _LedgerShellState extends State<LedgerShell> with WidgetsBindingObserver {
  Rect? _composition;
  final FocusScopeNode _worldFocus = FocusScopeNode(debugLabel: 'WORLD');
  final FocusScopeNode _bookFocus = FocusScopeNode(debugLabel: 'BOOK');
  final FocusScopeNode _typingFocus = FocusScopeNode(debugLabel: 'TYPING');
  @override
  void initState() { super.initState(); WidgetsBinding.instance.addObserver(this); widget.controller.addListener(_changed); widget.controller.input.addListener(_changed); if (widget.surface != SessionSurface.ready) widget.controller.input.lifecycle(false); }
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
      widget.controller.addListener(_changed); widget.controller.input.addListener(_changed);
    }
    if (old.surface != widget.surface) widget.controller.input.lifecycle(widget.surface == SessionSurface.ready);
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => widget.controller.input.lifecycle(state == AppLifecycleState.resumed);
  @override
  void dispose() {
    widget.controller.removeListener(_changed); widget.controller.input.removeListener(_changed);
    WidgetsBinding.instance.removeObserver(this);
    _worldFocus.dispose(); _bookFocus.dispose(); _typingFocus.dispose(); super.dispose();
  }

  Widget _button(String label, VoidCallback callback, LedgerTokens t, {double height = 44}) =>
    SizedBox(height: height, width: 44, child: TextButton(
      style: TextButton.styleFrom(foregroundColor: t.ink, backgroundColor: t.surface, padding: EdgeInsets.zero,
        minimumSize: const Size(44, 44), shape: const RoundedRectangleBorder()),
      onPressed: callback, child: Text(label, maxLines: 1, overflow: TextOverflow.clip)));
  Widget _slab(String text, LedgerTokens t) => ColoredBox(color: t.surface,
    child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), child: Text(text, style: TextStyle(color: t.ink, fontSize: 11))));

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
        SafeArea(child: Stack(fit: StackFit.expand, children: [
          Positioned(left: 0, top: 0, child: _slab(widget.readings, t)),
          Positioned(right: 0, top: 0, child: _slab(widget.clock, t)),
          if (widget.place.isNotEmpty) Positioned(top: 16, left: 160, right: 160,
            child: Center(child: _slab(widget.place, t))),
          Positioned(bottom: 0, left: 132, right: widget.actionCard == null ? 12 : 212,
            child: Center(child: _slab(widget.bearings, t))),
          if (!showBook) Positioned(left: 0, top: 62, bottom: 144,
            child: SingleChildScrollView(child: Column(children: [
              for (final name in widget.pages.keys.take(4)) _button(name, () => c.open(name), t),
            ]))),
          if (widget.actionCard != null) Positioned(right: 0, bottom: 0, width: 208,
            child: IgnorePointer(ignoring: parked, child: ExcludeSemantics(excluding: parked, child: widget.actionCard!))),
          if (parked && !showBook) Positioned(left: 56, bottom: 64, child: _slab('CONTROLS PARKED', t)),
          if (showBook) Positioned(left: 0, top: 0, bottom: 0, width: bookWidth,
            child: FocusScope(node: _bookFocus, autofocus: true, onKeyEvent: (_, event) {
              if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.back(); return KeyEventResult.handled; }
              return KeyEventResult.ignored;
            }, child: Focus(onKeyEvent: (_, event) {
              if (event is KeyDownEvent && event.logicalKey == LogicalKeyboardKey.escape) { c.back(); return KeyEventResult.handled; }
              return KeyEventResult.ignored;
            }, child: AnimatedContainer(key: const ValueKey('ledger-book'),
              duration: MediaQuery.disableAnimationsOf(context) ? Duration.zero : const Duration(milliseconds: 150),
              color: t.page, child: Row(children: [
                SizedBox(width: 44, child: ColoredBox(color: t.surface, child: Column(children: [
                  Expanded(child: SingleChildScrollView(child: Column(children: [
                    for (final name in widget.pages.keys.take(4)) _button(name, () => c.open(name), t, height: 48),
                  ]))),
                  _button('Back', c.back, t), _button('Close', c.close, t, height: 52),
                ]))),
                Expanded(child: DefaultTextStyle(style: TextStyle(color: t.pageInk, fontSize: 14.5),
                  child: widget.pages[c.route]?.call(context, t) ?? Center(child: Text('Page unavailable', style: TextStyle(color: t.pageInk))))),
              ]))))),
          if (showBook && safeWidth > bookWidth + 120) Positioned(left: bookWidth, right: 0, bottom: 0,
            child: _slab('CONTROLS PARKED · CLOSE PUTS THE BOOK AWAY', t)),
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
        const SizedBox(width: 12), Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: tokens.pageInk))),
        Text(consequence, style: TextStyle(color: tokens.pageDim, fontSize: 11)), const SizedBox(width: 8),
        Text(verb, style: TextStyle(color: tokens.pageInk, fontSize: 11, fontWeight: FontWeight.w600)),
      ]))))));
}

class LedgerThemePicker extends StatelessWidget {
  const LedgerThemePicker({super.key, required this.controller});
  final LedgerController controller;
  @override
  Widget build(BuildContext context) => ListView(children: [for (final theme in LedgerTheme.values)
    SizedBox(height: 64, child: TextButton(onPressed: () => controller.selectTheme(theme),
      style: TextButton.styleFrom(foregroundColor: LedgerTokens.all[controller.theme]!.pageInk),
      child: Row(children: [Container(width: 84, height: 40, color: LedgerTokens.all[theme]!.surface,
        alignment: Alignment.center, child: Text('AaBb 72', style: TextStyle(color: LedgerTokens.all[theme]!.ink))),
        const SizedBox(width: 12), Expanded(child: Text(theme.name)), Text(controller.theme == theme ? 'ON' : 'USE IT')])))]);
}
