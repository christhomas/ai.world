import 'package:ai_world_flutter/src/game_session.dart';
import 'package:ai_world_flutter/src/invite.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('follows an invite the page hands out, to the world and the country it names', () {
    final (invite, why) = WorldInvite.parse(' https://ai.world.example/?seed=42&server=wss%3A%2F%2Fworlds.example%3A8787 ');
    expect(why, isNull);
    expect(invite!.server, 'wss://worlds.example:8787');
    expect(invite.seed, 42);
    expect(invite.kind, 'endless', reason: 'a link that does not say grows endless country, as the page does');
    expect(WorldInvite.parse('https://x.example/?seed=1&world=road&server=wss://w.example').$1!.kind, 'road');
    final slot = invite.slot(name: 'Rowan');
    expect(slot.slot, 'shared-42-worlds.example');
    expect(slot.server, 'wss://worlds.example:8787');
    expect(slot.name, 'Rowan');
    expect(WorldInvite.parse('https://x.example/?seed=7&server=wss://${'w' * 80}.example').$1!.slot().slot.length,
      lessThanOrEqualTo(48), reason: 'a slot names files, so it stays short');
  });

  test('says why a link cannot be followed, rather than opening the wrong world', () {
    String? why(String text) => WorldInvite.parse(text).$2;
    expect(why('not a link'), contains('invite link'));
    expect(why('https://x.example/?seed=3'), contains('no world server'));
    expect(why('https://x.example/?seed=3&server=https://w.example'), contains('wss://'));
    expect(why('https://x.example/?server=wss://w.example'), contains('which world'));
  });

  test('a named world is the server\'s to describe, and is kept by its name on that server (#565)', () {
    final (invite, why) = WorldInvite.parse('https://ai.world.example/?world=Hollowmere&server=wss%3A%2F%2Fworlds.example%3A8787%2Fplay');
    expect(why, isNull);
    expect(invite!.name, 'Hollowmere');
    expect(invite.seed, isNull, reason: 'nobody has asked the server yet');
    expect(() => invite.slot(), throwsStateError);
    expect(WorldInvite.endpoint(invite.server, 'Hollowmere').toString(), 'https://worlds.example:8787/world?name=Hollowmere');
    expect(WorldInvite.endpoint('ws://localhost:8787', 'Åsgård Vale').toString(), 'http://localhost:8787/world?name=%C3%85sg%C3%A5rd+Vale');

    final slot = invite.described({'name': 'Hollowmere', 'seed': 907, 'kind': 'road', 'layers': []}).slot(name: 'Rowan');
    expect(slot.seed, 907);
    expect(slot.kind, 'road');
    expect(slot.world, 'Hollowmere');
    expect(slot.server, 'wss://worlds.example:8787/play');
    expect(slot.slot, startsWith('named-'));
    expect(slot.slot, endsWith('-worlds.example'));
    expect(GameSlot.fromJson(slot.json)?.world, 'Hollowmere', reason: 'kept with the game, so Continue asks again');

    String slotFor(String name) => WorldInvite(server: 'wss://worlds.example', seed: null, name: name)
      .described({'name': name, 'seed': 1}).slot().slot;
    expect(slotFor('HOLLOWMERE'), slotFor('hollowmere'), reason: 'the page keys a name lowercased');
    expect(slotFor('Hollowmere'), isNot(slotFor('Ashford')));
    expect(slotFor('Åsgård'), isNot(slotFor('Asgard')), reason: 'a name in any script is its own world');
    expect(slotFor('x' * 300).length, lessThanOrEqualTo(48));
    expect(() => invite.described({'error': 'No world called Hollowmere'}), throwsA(isA<WorldRefused>()));
  });

  test('a kept slot that names a world without a server is not trusted', () {
    expect(GameSlot.fromJson({'slot': 'named-1', 'seed': 1, 'kind': 'road', 'world': 'Hollowmere'}), isNull);
    expect(GameSlot.fromJson({'slot': 'named-1', 'seed': 1, 'kind': 'road', 'server': 'wss://w.example', 'world': 4}), isNull);
  });
}
