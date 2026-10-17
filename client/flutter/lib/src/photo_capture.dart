import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';

import 'native_world_renderer.dart';

enum PhotoResult {
  shared('Photo shared'),
  cancelled('Photo sharing cancelled'),
  closed('Share sheet closed'),
  notReady('The picture is not ready yet. Please try again.'),
  failed('Could not share the photo. Please try again.');

  const PhotoResult(this.message);
  final String message;
}

/// A photograph of the native render target, without Flutter's controls. Neither taking it nor
/// handing it to another app changes the game, its camera or its saved records (#578).
class PhotoCapture {
  const PhotoCapture({this.channel = const MethodChannel('world.ai/photo')});
  final MethodChannel channel;

  Future<PhotoResult> captureAndShare(Future<RenderSnapshot?> Function() snapshot,
      {required bool Function() isCurrent}) async {
    try {
      final frame = await snapshot().timeout(const Duration(seconds: 10));
      if (!isCurrent()) return PhotoResult.cancelled;
      if (frame == null) return PhotoResult.notReady;
      final png = await _encode(frame);
      // The player can put the camera away while readback or encoding is still on its way.
      if (!isCurrent()) return PhotoResult.cancelled;
      final reply = await channel.invokeMethod<String>('share', {'png': png});
      return switch (reply) {
        'shared' => PhotoResult.shared,
        'cancelled' => PhotoResult.cancelled,
        'closed' => PhotoResult.closed,
        _ => PhotoResult.failed,
      };
    } catch (_) {
      return PhotoResult.failed;
    }
  }

  Future<Uint8List> _encode(RenderSnapshot frame) async {
    final buffer = await ui.ImmutableBuffer.fromUint8List(frame.rgba);
    try {
      final descriptor = ui.ImageDescriptor.raw(buffer, width: frame.width, height: frame.height,
        pixelFormat: ui.PixelFormat.rgba8888);
      try {
        final codec = await descriptor.instantiateCodec();
        try {
          final decoded = await codec.getNextFrame();
          try {
            final bytes = await decoded.image.toByteData(format: ui.ImageByteFormat.png);
            if (bytes == null) throw StateError('The rendered frame could not be encoded');
            return bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes);
          } finally {
            decoded.image.dispose();
          }
        } finally {
          codec.dispose();
        }
      } finally {
        descriptor.dispose();
      }
    } finally {
      buffer.dispose();
    }
  }
}
