import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'render_mesh.dart';

final class RenderCamera {
  const RenderCamera({
    required this.targetX,
    required this.targetY,
    required this.targetZ,
    this.yaw = .78,
    this.pitch = .72,
    this.zoom = 18,
  });
  final double targetX, targetY, targetZ, yaw, pitch, zoom;

  Map<String, double> toMessage() => <String, double>{
    'targetX': targetX, 'targetY': targetY, 'targetZ': targetZ,
    'yaw': yaw, 'pitch': pitch, 'zoom': zoom,
  };
}

final class CutawayState {
  const CutawayState({required this.enabled, required this.heroX, required this.heroY, required this.heroZ});
  final bool enabled;
  final double heroX, heroY, heroZ;

  Map<String, Object> toMessage() => <String, Object>{
    'enabled': enabled, 'heroX': heroX, 'heroY': heroY, 'heroZ': heroZ,
  };
}

/// Owns one native GLES/Metal renderer whose output Flutter composites as an opaque texture.
final class NativeWorldRenderer {
  NativeWorldRenderer._(this.textureId, this._channel);

  static const MethodChannel _defaultChannel = MethodChannel('world.ai/renderer');
  final int textureId;
  final MethodChannel _channel;
  bool _disposed = false;

  static Future<NativeWorldRenderer> create({required int width, required int height, MethodChannel? channel}) async {
    final bridge = channel ?? _defaultChannel;
    final id = await bridge.invokeMethod<int>('create', <String, int>{'width': width, 'height': height});
    if (id == null) throw StateError('Native renderer did not return a texture id');
    return NativeWorldRenderer._(id, bridge);
  }

  Future<void> resize(int width, int height) => _invoke('resize', <String, Object>{'width': width, 'height': height});

  Future<void> putMesh(RenderMesh mesh) => _invoke('putMesh', <String, Object>{
    'meshId': mesh.id,
    'vertices': mesh.vertices,
    'indices': mesh.indices,
    'stride': RenderMesh.floatsPerVertex,
  });

  Future<void> removeMesh(String meshId) => _invoke('removeMesh', <String, Object>{'meshId': meshId});
  Future<void> setCamera(RenderCamera camera) => _invoke('camera', camera.toMessage());
  Future<void> setCutaway(CutawayState cutaway) => _invoke('cutaway', cutaway.toMessage());

  Future<void> _invoke(String method, Map<String, Object> arguments) {
    if (_disposed) throw StateError('Renderer $textureId has been disposed');
    return _channel.invokeMethod<void>(method, <String, Object>{'textureId': textureId, ...arguments});
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _channel.invokeMethod<void>('dispose', <String, int>{'textureId': textureId});
  }
}

/// Sizes the native render target to physical pixels while leaving all HUD layout in Flutter.
final class NativeWorldView extends StatefulWidget {
  const NativeWorldView({super.key, required this.onCreated});
  final FutureOr<void> Function(NativeWorldRenderer renderer) onCreated;

  @override
  State<NativeWorldView> createState() => _NativeWorldViewState();
}

final class _NativeWorldViewState extends State<NativeWorldView> {
  NativeWorldRenderer? _renderer;
  Size _logicalSize = Size.zero;
  int? _width, _height;

  @override
  Widget build(BuildContext context) => LayoutBuilder(builder: (context, constraints) {
    final size = constraints.biggest;
    if (size.isFinite && size != _logicalSize) {
      _logicalSize = size;
      WidgetsBinding.instance.addPostFrameCallback((_) => _sizeRenderer(context));
    }
    final renderer = _renderer;
    return renderer == null
        ? const ColoredBox(color: Color(0xff080b18))
        : Texture(textureId: renderer.textureId, filterQuality: FilterQuality.none);
  });

  Future<void> _sizeRenderer(BuildContext context) async {
    if (!mounted || _logicalSize.isEmpty) return;
    final ratio = MediaQuery.devicePixelRatioOf(context);
    final width = (_logicalSize.width * ratio).round().clamp(1, 4096);
    final height = (_logicalSize.height * ratio).round().clamp(1, 4096);
    if (width == _width && height == _height) return;
    _width = width; _height = height;
    if (_renderer == null) {
      final renderer = await NativeWorldRenderer.create(width: width, height: height);
      if (!mounted) { await renderer.dispose(); return; }
      _renderer = renderer;
      setState(() {});
      await widget.onCreated(renderer);
    } else {
      await _renderer!.resize(width, height);
    }
  }

  @override
  void dispose() {
    _renderer?.dispose();
    super.dispose();
  }
}
