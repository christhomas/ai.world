import 'package:flutter/foundation.dart';

enum InputOwner { world, book, typing }
typedef InputSink = void Function(Map<String, Object?> input);

/// UI input boundary only. The host validates/applies requests and owns gameplay rules.
class InputOwnerController extends ChangeNotifier {
  InputOwnerController(this.send);
  final InputSink send;
  InputOwner owner = InputOwner.world;
  String? busy;
  bool _inactive = false;
  final Map<Object, Map<String, Object>> _holds = {};
  bool get acceptsWorld => !_inactive && owner == InputOwner.world && busy == null;

  void hold(Object token, {List<double> move = const [0, 0], List<double> look = const [0, 0], bool guard = false, bool run = false}) {
    if (!acceptsWorld) return;
    if ([...move, ...look].any((n) => !n.isFinite || n < -1 || n > 1) || move.length != 2 || look.length != 2) {
      throw ArgumentError('Input vectors must be normalized pairs');
    }
    _holds[token] = {'move': List<double>.of(move), 'look': List<double>.of(look), 'guard': guard, 'run': run};
    _emit();
  }
  void release(Object token) { _holds.remove(token); _emit(); }
  void action(String action) { if (acceptsWorld) _emit(actions: [action]); }
  void focus(InputOwner next, {String? busy}) {
    if (![null, 'reading', 'talking', 'framing', 'typing'].contains(busy)) throw ArgumentError('Unknown host busy mode');
    _holds.clear();
    owner = next;
    this.busy = busy;
    _emit();
    notifyListeners();
  }
  void lifecycle(bool active) { _holds.clear(); _inactive = !active; _emit(); notifyListeners(); }
  void cancelAll() { _holds.clear(); _emit(); }
  void _emit({List<String> actions = const []}) {
    final held = acceptsWorld ? _holds.values.toList() : <Map<String, Object>>[];
    List<double> vector(String name) {
      final moved = held.where((v) => (v[name] as List<double>).any((n) => n != 0)).toList();
      return moved.isEmpty ? [0, 0] : List<double>.of(moved.last[name] as List<double>);
    }
    send({'move': vector('move'), 'look': vector('look'),
      'held': {'guard': held.any((v) => v['guard'] == true), 'run': held.any((v) => v['run'] == true)},
      'actions': acceptsWorld ? List<String>.of(actions) : <String>[],
      'owner': owner.name.toUpperCase(), 'busy': busy});
  }
}
