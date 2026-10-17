/// The native renderers' colour pipeline, decided once for both of them (#499).
///
/// It is three.js r185's, as the web draws it: `WebGLRenderer` leaves `outputColorSpace` at sRGB
/// and `toneMapping` at none, and nothing in `src/render` changes either. So:
///
/// - every authored hex is sRGB, and is decoded to linear before light touches it — material and
///   emissive colours as `Color.setHex` decodes them, lights the same way, then scaled by their
///   intensity as `WebGLLights` does. That decoding happens here, in Dart, and nowhere else: the
///   bridges receive linear numbers for everything they light.
/// - vertex and instance colours are linear already, as three.js takes a colour attribute.
/// - the bridges apply three.js's Lambert BRDF (albedo / pi) to each direct light and to the
///   indirect light, then add emissive. The fragment shader encodes that sum to sRGB before writing
///   to a plain 8-bit target. Blending happens on encoded values, as in the web's default framebuffer.
/// - every light in a frame is sent, and each bridge adds up the lights of each kind as
///   `WebGLLights` does (#512): ambient and hemisphere on the host, exactly, and up to four
///   directional lights in the shader, of which the first that casts a shadow takes it.
/// - the background and the fog colour are the exceptions, because three.js hands both to the GPU
///   in the output colour space: the clear colour is the hex itself, and fog is mixed toward the
///   hex after the encoding (`fog_fragment` follows `colorspace_fragment`). The bridges take those
///   two hexes as they are.
library;

import 'dart:math' as math;

/// One authored sRGB hex as linear RGB, the way three.js's `Color.setHex` decodes it.
/// `src/render/graphmount.ts` uses setHex for material colours and hex lights, and setRGB for
/// computed lights. Keep three.js's CPU SRGBToLinear constants and operation order here too.
List<double> linearFromHex(int hex) => <double>[
  _decode((hex >> 16) & 255),
  _decode((hex >> 8) & 255),
  _decode(hex & 255),
];

double _decode(int bits) {
  final value = bits / 255;
  return value < 0.04045
      ? value * 0.0773993808
      : math.pow(value * 0.9478672986 + 0.0521327014, 2.4).toDouble();
}

/// A frame light as the native bridges take it.
///
/// Alongside the node itself: `linear`, its colour in linear RGB with its intensity applied, the
/// unclamped `linearColour` preferred to the hex as `bindLightMount` prefers it; `linearGround`,
/// the same for a hemisphere's ground; and for a point light its `distance` and `decay`, with
/// three.js's defaults where the frame gives none.
Map<String, Object?> nativeLight(Map<String, dynamic> node) {
  final intensity = (node['intensity'] as num?)?.toDouble() ?? 0;
  List<double> radiance(Object? linear, Object? hex) => <double>[
    for (final channel
        in linear is List
            ? linear.map((value) => (value as num).toDouble())
            : linearFromHex((hex as num?)?.toInt() ?? 0xffffff))
      channel * intensity,
  ];
  final kind = node['kind'];
  return <String, Object?>{
    ...node,
    'linear': radiance(node['linearColour'], node['colour']),
    if (kind == 'hemisphere')
      'linearGround': radiance(node['linearGroundColour'], node['groundColour']),
    if (kind == 'point') ...<String, Object?>{
      'distance': (node['distance'] as num?)?.toDouble() ?? 0,
      'decay': (node['decay'] as num?)?.toDouble() ?? 2,
    },
  };
}
