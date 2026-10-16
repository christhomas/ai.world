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
    expect(why('https://x.example/?world=Hollowmere&server=wss://w.example'), contains('Hollowmere'));
  });
}
