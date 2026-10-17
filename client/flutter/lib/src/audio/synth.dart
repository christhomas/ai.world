import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/services.dart';

/// The game's sounds made here, from what the game says each is made of (#578;
/// `src/game/sound-recipes.ts`), the way the page's Web Audio makes them: a tone swells to its gain in
/// ten milliseconds and dies away exponentially, its pitch sliding exponentially if it slides; a burst
/// is white noise through a band-pass filter, dying away exponentially from its gain. There are no
/// sample files, on the page or here.
class Synth {
  Synth({this.rate = 44100, math.Random? random}) : _random = random ?? math.Random();
  final int rate;
  final math.Random _random;

  /// Web Audio's exponential ramps cannot reach nought, so they ramp to this instead.
  static const double floor = 0.0001;

  /// One sound's voices, mixed into mono 16-bit samples at this volume (nought to one).
  Int16List render(List<Map> voices, {double volume = 1}) {
    var end = 0.0;
    for (final v in voices) {
      end = math.max(end, (v['at'] as num).toDouble() + (v['dur'] as num).toDouble() + 0.05);
    }
    final mix = Float64List((end * rate).ceil());
    for (final v in voices) {
      if (v.containsKey('tone')) {
        _tone(mix, v);
      } else {
        _burst(mix, v);
      }
    }
    final out = Int16List(mix.length);
    for (var i = 0; i < mix.length; i++) {
      out[i] = ((mix[i] * volume).clamp(-1.0, 1.0) * 32767).round();
    }
    return out;
  }

  void _tone(Float64List mix, Map v) {
    final f0 = (v['tone'] as num).toDouble(), dur = (v['dur'] as num).toDouble(), gain = (v['gain'] as num).toDouble();
    final slide = (v['slide'] as num?)?.toDouble();
    // how long it takes to swell: ten milliseconds, or a plucked note's fortieth of a second
    final rise = (v['rise'] as num?)?.toDouble() ?? 0.01;
    final start = ((v['at'] as num).toDouble() * rate).round();
    final length = ((dur + 0.02) * rate).round();
    final fall = math.max(dur - rise, 0.001);
    var phase = 0.0;
    for (var i = 0; i < length && start + i < mix.length; i++) {
      final t = i / rate;
      final f = slide == null ? f0 : f0 * math.pow(slide / f0, math.min(t, dur) / dur);
      phase += f / rate;
      phase -= phase.floorToDouble();
      final g = t < rise ? floor * math.pow(gain / floor, t / rise)
        : t < dur ? gain * math.pow(floor / gain, (t - rise) / fall) : floor;
      mix[start + i] += _wave(v['wave'], phase) * g;
    }
  }

  static double _wave(Object? wave, double phase) => switch (wave) {
    'square' => phase < 0.5 ? 1.0 : -1.0,
    'triangle' => 1 - 4 * (phase - 0.5).abs(),
    'sawtooth' => 2 * phase - 1,
    _ => math.sin(2 * math.pi * phase),
  };

  void _burst(Float64List mix, Map v) {
    final freq = (v['burst'] as num).toDouble(), dur = (v['dur'] as num).toDouble();
    final q = (v['q'] as num).toDouble(), gain = (v['gain'] as num).toDouble();
    final start = ((v['at'] as num).toDouble() * rate).round();
    final length = ((dur + 0.05) * rate).round();
    // a band-pass biquad with a constant 0 dB peak, which is Web Audio's `bandpass`
    final w0 = 2 * math.pi * freq / rate, alpha = math.sin(w0) / (2 * q);
    final a0 = 1 + alpha, a1 = -2 * math.cos(w0), a2 = 1 - alpha;
    var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0;
    for (var i = 0; i < length && start + i < mix.length; i++) {
      final t = i / rate;
      final x = _random.nextDouble() * 2 - 1;
      final y = (alpha * x - alpha * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      final g = t < dur ? gain * math.pow(floor / gain, t / dur) : floor;
      mix[start + i] += y * g;
    }
  }
}

/// Where a sound is played: the app's own native audio (`world.ai/sound`), or a test's stand-in.
abstract interface class SoundOutput {
  Future<void> play(Int16List samples, int rate);
}

/// The phone's audio: AudioTrack on Android, AVAudioEngine on iOS (see the native SoundBridge). A sound
/// that cannot be played is let go: the game goes on without it.
class NativeSound implements SoundOutput {
  NativeSound([this._channel = const MethodChannel('world.ai/sound')]);
  final MethodChannel _channel;

  @override
  Future<void> play(Int16List samples, int rate) async {
    try {
      await _channel.invokeMethod<void>('play', {'pcm': samples.buffer.asUint8List(samples.offsetInBytes, samples.lengthInBytes), 'rate': rate});
    } on PlatformException {
      // no audio this time; nothing about the game depends on hearing it
    } on MissingPluginException {
      // a host with no audio, such as a widget test
    }
  }
}
