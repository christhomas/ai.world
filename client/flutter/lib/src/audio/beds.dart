import 'dart:math' as math;
import 'dart:typed_data';

/// The beds under every other sound (#578; `BEDS` in `src/game/sound-recipes.ts`): the wind, the
/// water in earshot and the soundtrack's drone, which on the page are Web Audio voices that never
/// stop and are only turned up and down. The game says how loud each is now (`hud.beds`); this
/// makes them here, as the page's nodes make them:
///
/// - wind is white noise through a low-pass whose corner wanders ±180 Hz about 400 at 0.13 Hz;
/// - water is white noise through a band-pass at the centre and Q the game says;
/// - the drone is two sines, six cents flat and seven sharp of the frequency the game says.
///
/// The phone's audio plays a sound it is handed and lets it go, so the beds are handed over a second
/// at a time: each stretch runs a tenth of a second past the next one's start, rising in under the
/// one before and falling away under the one after, so a frame late is not a gap.
class Beds {
  Beds({this.rate = 44100, math.Random? random}) : _random = random ?? math.Random();
  final int rate;
  final math.Random _random;

  /// How often a stretch is handed over, and how far each runs under the next.
  static const double every = 1.0, overlap = 0.1;

  /// Quieter than this, a bed is not worth making.
  static const double silent = 0.0005;

  // where the wind's sway and the drone's two sines had got to, so each stretch carries on from the last
  double _sway = 0, _flat = 0, _sharp = 0;
  final _wind = _Biquad(), _water = _Biquad();

  /// The next stretch of the beds at these levels, `every + overlap` seconds long; null when there
  /// is nothing to hear.
  Int16List? render(Map beds, {double volume = 1}) {
    final wind = ((beds['wind'] as num?) ?? 0).toDouble() * volume;
    final water = (beds['water'] as Map?) ?? const {};
    final wet = ((water['gain'] as num?) ?? 0).toDouble() * volume;
    final drone = (beds['drone'] as Map?) ?? const {};
    final hum = ((drone['gain'] as num?) ?? 0).toDouble() * volume;
    final freq = ((drone['freq'] as num?) ?? 0).toDouble();
    final length = ((every + overlap) * rate).round(), carry = (every * rate).round();
    if (wind < silent && wet < silent && (hum < silent || freq <= 0)) {
      // nothing to hear, and nothing to carry on from: the next stretch starts afresh
      _sway += 2 * math.pi * 0.13 * every;
      return null;
    }
    if (wet >= silent) _water.bandPass(((water['centre'] as num?) ?? 1500).toDouble(), ((water['q'] as num?) ?? 0.5).toDouble(), rate);
    final flatStep = freq * math.pow(2, -6 / 1200) / rate, sharpStep = freq * math.pow(2, 7 / 1200) / rate;
    final out = Int16List(length);
    var sway = _sway, flat = _flat, sharp = _sharp;
    for (var i = 0; i < length; i++) {
      var y = 0.0;
      if (wind >= silent) {
        // the corner is moved every 64 samples, which is far finer than anybody hears a 0.13 Hz sway
        if (i % 64 == 0) _wind.lowPass(400 + 180 * math.sin(sway), 0.7, rate);
        y += _wind.next(_random.nextDouble() * 2 - 1) * wind;
      }
      if (wet >= silent) y += _water.next(_random.nextDouble() * 2 - 1) * wet;
      if (hum >= silent && freq > 0) y += (math.sin(2 * math.pi * flat) + math.sin(2 * math.pi * sharp)) * hum;
      sway += 2 * math.pi * 0.13 / rate;
      flat = (flat + flatStep) % 1;
      sharp = (sharp + sharpStep) % 1;
      if (i == carry - 1) { _sway = sway; _flat = flat; _sharp = sharp; }
      // in under the stretch before and out under the one after, each at equal power
      final t = i / rate, end = (length - i) / rate;
      final fade = t < overlap ? math.sin(math.pi / 2 * t / overlap) : end < overlap ? math.sin(math.pi / 2 * end / overlap) : 1.0;
      out[i] = ((y * fade).clamp(-1.0, 1.0) * 32767).round();
    }
    return out;
  }
}

/// One second-order filter, as Web Audio's `lowpass` and `bandpass` are, keeping its state between stretches.
class _Biquad {
  double _b0 = 1, _b1 = 0, _b2 = 0, _a1 = 0, _a2 = 0, _x1 = 0, _x2 = 0, _y1 = 0, _y2 = 0;

  void lowPass(double freq, double q, int rate) {
    final w0 = 2 * math.pi * freq / rate, alpha = math.sin(w0) / (2 * q), cos = math.cos(w0), a0 = 1 + alpha;
    _b0 = (1 - cos) / 2 / a0; _b1 = (1 - cos) / a0; _b2 = (1 - cos) / 2 / a0; _a1 = -2 * cos / a0; _a2 = (1 - alpha) / a0;
  }

  /// With a constant 0 dB peak, as the page's water and the synth's bursts are.
  void bandPass(double freq, double q, int rate) {
    final w0 = 2 * math.pi * freq / rate, alpha = math.sin(w0) / (2 * q), cos = math.cos(w0), a0 = 1 + alpha;
    _b0 = alpha / a0; _b1 = 0; _b2 = -alpha / a0; _a1 = -2 * cos / a0; _a2 = (1 - alpha) / a0;
  }

  double next(double x) {
    final y = _b0 * x + _b1 * _x1 + _b2 * _x2 - _a1 * _y1 - _a2 * _y2;
    _x2 = _x1; _x1 = x; _y2 = _y1; _y1 = y;
    return y;
  }
}
