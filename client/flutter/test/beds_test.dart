import 'dart:math' as math;
import 'dart:typed_data';

import 'package:ai_world_flutter/src/audio/beds.dart';
import 'package:flutter_test/flutter_test.dart';

/// The game's `hud.beds`, as `src/platform/headless-game.ts` says them.
Map<String, Object> beds({double wind = 0, double water = 0, double drone = 0, double freq = 110}) => {
  'wind': wind, 'water': {'gain': water, 'centre': 1500, 'q': 0.5}, 'drone': {'freq': freq, 'gain': drone},
};

double rms(Iterable<int> samples) {
  var sum = 0.0, n = 0;
  for (final s in samples) { sum += (s / 32767) * (s / 32767); n++; }
  return math.sqrt(sum / math.max(1, n));
}

void main() {
  test('nothing to hear is nothing handed over', () {
    expect(Beds().render(beds()), isNull);
    expect(Beds().render(beds(wind: 0.07, water: 0.1, drone: 0.025), volume: 0), isNull, reason: 'turned all the way down');
  });

  test('a stretch runs past the next one\'s start, rising in and falling away under its neighbours', () {
    final b = Beds(random: math.Random(1));
    final stretch = b.render(beds(wind: 0.07))!;
    expect(stretch.length, ((Beds.every + Beds.overlap) * b.rate).round());
    final edge = (0.005 * b.rate).round(), middle = stretch.length ~/ 2;
    expect(rms(stretch.take(edge)), lessThan(rms(stretch.skip(middle).take(edge * 20)) / 4), reason: 'it rises in');
    expect(rms(stretch.skip(stretch.length - edge)), lessThan(rms(stretch.skip(middle).take(edge * 20)) / 4), reason: 'it falls away');
  });

  test('the wind is louder in the snow than on the plains, and water louder at a fall than a brook', () {
    final plains = Beds(random: math.Random(2)).render(beds(wind: 0.025))!;
    final snow = Beds(random: math.Random(2)).render(beds(wind: 0.07))!;
    expect(rms(snow), greaterThan(rms(plains) * 2));
    final brook = Beds(random: math.Random(3)).render(beds(water: 0.035))!;
    final fall = Beds(random: math.Random(3)).render(beds(water: 0.195))!;
    expect(rms(fall), greaterThan(rms(brook) * 3));
  });

  test('the drone hums at the pitch the game says, and carries on from one stretch to the next', () {
    final b = Beds();
    final first = b.render(beds(drone: 0.025, freq: 110))!;
    final second = b.render(beds(drone: 0.025, freq: 110))!;
    // two sines a few cents apart sum to one at about their pitch: count where it crosses nought
    int crossings(Int16List s, int from, int to) {
      var n = 0;
      for (var i = from + 1; i < to; i++) { if ((s[i - 1] < 0) != (s[i] < 0)) n++; }
      return n;
    }
    final second0 = (0.2 * b.rate).round(), second1 = (0.8 * b.rate).round();
    expect(crossings(first, second0, second1) / 2 / 0.6, closeTo(110, 3));
    // under the overlap, with each one's fade taken off, the next stretch says what this one's next
    // second would have: it carries on from where this one was rather than starting the hum afresh
    final at = (Beds.every * b.rate).round(), half = (Beds.overlap / 2 * b.rate).round();
    double rising(int k) => math.sin(math.pi / 2 * (k / b.rate) / Beds.overlap);
    double falling(int k) => math.sin(math.pi / 2 * ((first.length - at - k) / b.rate) / Beds.overlap);
    for (final k in [half - 700, half, half + 900]) {
      expect(first[at + k] / falling(k), closeTo(second[k] / rising(k), 4), reason: 'sample $k of the overlap');
    }
  });
}
