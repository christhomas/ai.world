import 'dart:math' as math;
import 'dart:typed_data';

import 'package:ai_world_flutter/src/audio/synth.dart';
import 'package:flutter_test/flutter_test.dart';

/// `src/game/sound-recipes.ts`'s chime, as the engine sends it.
const chime = [
  {'tone': 660, 'dur': 0.12, 'wave': 'sine', 'gain': 0.12, 'at': 0},
  {'tone': 990, 'dur': 0.16, 'wave': 'sine', 'gain': 0.12, 'at': 0.11},
];

double peak(Int16List samples, [int from = 0, int? to]) {
  var most = 0;
  for (var i = from; i < (to ?? samples.length); i++) {
    most = math.max(most, samples[i].abs());
  }
  return most / 32767;
}

void main() {
  final synth = Synth(random: math.Random(3));

  test('a sound lasts as long as its last voice, swells, and dies away to silence', () {
    final samples = synth.render(chime);
    expect(samples.length, ((0.11 + 0.16 + 0.05) * 44100).ceil());
    expect(peak(samples), closeTo(0.12, 0.02), reason: 'as loud as its gain, no louder');
    expect(peak(samples, 0, 44), lessThan(0.06), reason: 'it swells over ten milliseconds rather than clicking on');
    expect(peak(samples, samples.length - 441), lessThan(0.001), reason: 'and it is gone by the end');
  });

  test('a tone is at its pitch, and a slide ends where it slides to', () {
    int crossings(Int16List s, int from, int to) {
      var n = 0;
      for (var i = from + 1; i < to; i++) {
        if ((s[i - 1] < 0) != (s[i] < 0)) n++;
      }
      return n;
    }
    final a = synth.render(const [{'tone': 440, 'dur': 0.5, 'wave': 'sine', 'gain': 0.5, 'at': 0}]);
    // twice a cycle, over a tenth of a second in the middle
    expect(crossings(a, 4410, 8820) / 2, closeTo(44, 1));
    final slid = synth.render(const [{'tone': 400, 'dur': 0.5, 'wave': 'sine', 'gain': 0.5, 'at': 0, 'slide': 100}]);
    expect(crossings(slid, 0, 2205), greaterThan(crossings(slid, 17640, 19845) * 2), reason: 'a falling note falls');
  });

  test('a burst is noise in its band, and the volume scales everything down to nothing', () {
    final hiss = synth.render(const [{'burst': 900, 'dur': 0.5, 'q': 0.6, 'gain': 0.16, 'at': 0}]);
    expect(peak(hiss, 0, 4410), greaterThan(0.01));
    expect(peak(hiss, 0, 4410), lessThan(0.5));
    expect(peak(synth.render(chime, volume: 0)), 0);
  });

  test('a later voice starts when it says it does', () {
    final late = synth.render(const [{'tone': 660, 'dur': 0.1, 'wave': 'square', 'gain': 0.3, 'at': 0.2}]);
    expect(peak(late, 0, 8800), 0, reason: 'nothing before its start');
    expect(peak(late, 8820 + 441), greaterThan(0.1));
  });
}
