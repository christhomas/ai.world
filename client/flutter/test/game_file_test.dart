import 'dart:convert';

import 'package:ai_world_flutter/src/storage/game_file.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final game = GameFile(
    slot: const {'slot': 'local-1', 'seed': 9, 'kind': 'road', 'name': 'Rowan'},
    hero: const {'state': {'playerId': 'hero', 'gold': 12, 'pack': ['rope', 'lamp']}},
    world: const {'worlds/1/rooms': '{"a":1}', 'worlds/1/clock': '42'},
    exported: DateTime.fromMillisecondsSinceEpoch(1760000000000),
  );
  List<int> bytes(String text) => utf8.encode(text);
  Map<String, dynamic> envelope() => jsonDecode(game.encode()) as Map<String, dynamic>;
  String sealed(Object body) {
    final text = jsonEncode(body);
    return jsonEncode({'format': 'ai-world-game', 'version': 1, 'checksum': gameFileChecksum(text), 'body': text});
  }
  Map<String, Object?> whole() => {'slot': game.slot, 'hero': game.hero, 'world': game.world, 'exported': 1};

  Matcher refused(String containing) =>
    throwsA(isA<GameFileRefused>().having((r) => r.message, 'message', contains(containing)));

  test('a game read back from its file is the game written', () {
    final read = GameFile.decode(bytes(game.encode()));
    expect(read.slot, game.slot);
    expect(read.hero, game.hero);
    expect(read.world, game.world);
    expect(read.exported, game.exported);
  });

  test('the file names its format and version, and carries a checksum of what it holds', () {
    final file = envelope();
    expect(file.keys, unorderedEquals(['format', 'version', 'checksum', 'body']));
    expect(file['format'], 'ai-world-game');
    expect(file['version'], 1);
    expect(file['checksum'], gameFileChecksum(file['body'] as String));
    expect(jsonDecode(file['body'] as String), {'slot': game.slot, 'hero': game.hero, 'world': game.world,
      'exported': 1760000000000});
  });

  test('a file cut short is refused as incomplete', () {
    final text = game.encode();
    for (final length in [1, text.length ~/ 3, text.length ~/ 2, text.length - 1]) {
      expect(() => GameFile.decode(bytes(text.substring(0, length))), refused('damaged or incomplete'),
        reason: 'cut at $length of ${text.length}');
    }
    expect(() => GameFile.decode(const []), refused('empty'));
  });

  test('a file changed after it was written is refused by its checksum', () {
    final file = envelope();
    file['body'] = (file['body'] as String).replaceFirst('"gold":12', '"gold":99');
    expect(() => GameFile.decode(bytes(jsonEncode(file))), refused('checksum'));
  });

  test('bytes that are not text, and JSON that is not a game, are refused', () {
    expect(() => GameFile.decode(const [0xff, 0xfe, 0x00, 0x7b]), refused('damaged or incomplete'));
    expect(() => GameFile.decode(bytes('{"theme":"stone"}')), refused('not an AI World game'));
    expect(() => GameFile.decode(bytes('[1,2,3]')), refused('not an AI World game'));
  });

  test('a version that is no version is refused as damaged', () {
    for (final version in [0, -1, '1', 1.5, null]) {
      final file = envelope()..['version'] = version;
      expect(() => GameFile.decode(bytes(jsonEncode(file))), refused('damaged or incomplete'), reason: '$version');
    }
  });

  test('a file from a newer format is refused as newer, whatever else it holds', () {
    // a newer app may have changed the body and the checksum too, so neither is judged by this one
    final file = {'format': 'ai-world-game', 'version': 2, 'body': {'something': 'new'}, 'sealed': true};
    expect(() => GameFile.decode(bytes(jsonEncode(file))), refused('newer AI World (format 2)'));
    expect(() => GameFile.decode(bytes(jsonEncode(envelope()..['version'] = 7))), refused('Update the app'));
  });

  test('a file of the right checksum but the wrong shape is refused', () {
    final complete = whole();
    for (final broken in <Object>[
      {...complete}..remove('world'),
      {...complete, 'hero': null},
      {...complete, 'world': {'worlds/1': 3}},
      {...complete, 'slot': 'local-1'},
      {...complete, 'exported': 'yesterday'},
      {...complete, 'extra': true},
      'just a string',
    ]) {
      expect(() => GameFile.decode(bytes(sealed(broken))), refused('damaged or incomplete'), reason: '$broken');
    }
    expect(GameFile.decode(bytes(sealed(complete))).world, game.world, reason: 'the whole one is read');
    final extra = envelope()..['note'] = 'hi';
    expect(() => GameFile.decode(bytes(jsonEncode(extra))), refused('damaged or incomplete'));
  });

  test('a hero must hold a saved state map, not just a non-null value', () {
    for (final hero in <Object>[true, 7, 'hero', [], {}, {'state': null}, {'state': []}, {'state': 'hero'}]) {
      expect(() => GameFile.decode(bytes(sealed({...whole(), 'hero': hero}))), refused('damaged or incomplete'), reason: '$hero');
    }
    expect(GameFile.decode(bytes(sealed({...whole(), 'hero': {'state': {}}}))).hero, {'state': {}});
  });

  test('export dates outside the DateTime range are refused as damaged', () {
    for (final exported in [-8640000000000001, 8640000000000001]) {
      expect(() => GameFile.decode(bytes(sealed({...whole(), 'exported': exported}))), refused('damaged or incomplete'));
    }
    for (final exported in [-8640000000000000, 8640000000000000]) {
      expect(GameFile.decode(bytes(sealed({...whole(), 'exported': exported}))).exported.millisecondsSinceEpoch, exported);
    }
  });

  test('hero maps and lists obey the store depth limit, with the root at zero', () {
    for (final lists in [false, true]) {
      Map<String, Object?> heroAt(int depth) {
        Object value = 'end';
        for (var n = 0; n < depth - 2; n++) { value = lists ? [value] : {'next': value}; }
        return {'state': {'nested': value}};
      }
      final allowed = heroAt(32);
      expect(GameFile.decode(bytes(sealed({...whole(), 'hero': allowed}))).hero, allowed);
      expect(() => GameFile.decode(bytes(sealed({...whole(), 'hero': heroAt(33)}))), refused('damaged or incomplete'));
    }
  });

  test('a file far larger than any game is refused before it is read', () {
    expect(gameFileLimit, 16 * 1024 * 1024);
    expect(() => GameFile.decode(utf8.encode(' ' * (gameFileLimit + 1))), refused('too large'));
  });
}
