import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

import 'colour.dart';
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
    'targetX': targetX,
    'targetY': targetY,
    'targetZ': targetZ,
    'yaw': yaw,
    'pitch': pitch,
    'zoom': zoom,
  };
}

final class CutawayState {
  const CutawayState({
    required this.enabled,
    required this.heroX,
    required this.heroY,
    required this.heroZ,
  });
  final bool enabled;
  final double heroX, heroY, heroZ;

  Map<String, Object> toMessage() => <String, Object>{
    'enabled': enabled,
    'heroX': heroX,
    'heroY': heroY,
    'heroZ': heroZ,
  };
}

/// Owns one native GLES/Metal renderer whose output Flutter composites as an opaque texture.
final class NativeWorldRenderer {
  NativeWorldRenderer._(this.textureId, this._channel);

  static const MethodChannel _defaultChannel = MethodChannel(
    'world.ai/renderer',
  );
  final int textureId;
  final MethodChannel _channel;
  bool _disposed = false;

  static Future<NativeWorldRenderer> create({
    required int width,
    required int height,
    MethodChannel? channel,
  }) async {
    final bridge = channel ?? _defaultChannel;
    final id = await bridge.invokeMethod<int>('create', <String, int>{
      'width': width,
      'height': height,
    });
    if (id == null) {
      throw StateError('Native renderer did not return a texture id');
    }
    return NativeWorldRenderer._(id, bridge);
  }

  Future<void> resize(int width, int height) =>
      _invoke('resize', <String, Object>{'width': width, 'height': height});

  Future<void> putMesh(RenderMesh mesh) => _invoke('putMesh', <String, Object>{
    'meshId': mesh.id,
    'vertices': mesh.vertices,
    'indices': mesh.indices,
    'stride': RenderMesh.floatsPerVertex,
    'castShadow': mesh.castShadow,
    'receiveShadow': mesh.receiveShadow,
    'opacity': mesh.opacity,
    // linear, as the bridges add it to linear light; see colour.dart
    'emissive': linearFromHex(mesh.emissive),
    'blend': mesh.blend,
    'depthWrite': mesh.depthWrite,
    'depthTest': mesh.depthTest,
    'doubleSided': mesh.doubleSided,
    'backSide': mesh.backSide,
    'renderOrder': mesh.renderOrder,
    'transparent': mesh.transparent,
  });

  Future<void> removeMesh(String meshId) =>
      _invoke('removeMesh', <String, Object>{'meshId': meshId});
  Future<void> setCamera(RenderCamera camera) =>
      _invoke('camera', camera.toMessage());
  Future<void> setCutaway(CutawayState cutaway) =>
      _invoke('cutaway', cutaway.toMessage());

  Future<void> setSceneFrame({
    required Float32List projection,
    required Float32List world,
    required int background,
    double? renderTimeMs,
    Map<String, dynamic>? fog,
    Map<String, dynamic>? coast,
    required List<Map<String, dynamic>> nodes,
  }) {
    final message = <String, Object>{
      'projection': projection,
      'world': world,
      'background': background,
      'lights': nodes,
    };
    if (renderTimeMs != null) {
      if (!renderTimeMs.isFinite || renderTimeMs < 0) {
        throw const FormatException('Scene animation time must be finite nonnegative milliseconds');
      }
      message['renderTimeMs'] = renderTimeMs;
    }
    if (fog != null) message['fog'] = fog;
    if (coast != null) {
      message['coast'] = <String, Object>{
        'x0': coast['x0'] as num,
        'z0': coast['z0'] as num,
        'span': coast['span'] as num,
        'size': coast['size'] as int,
        'range': coast['range'] as num? ?? 64,
        'values': Uint8List.fromList((coast['values'] as List).cast<int>()),
      };
    }
    return _invoke('sceneFrame', message);
  }

  Future<void> _invoke(String method, Map<String, Object> arguments) {
    if (_disposed) throw StateError('Renderer $textureId has been disposed');
    return _channel.invokeMethod<void>(method, <String, Object>{
      'textureId': textureId,
      ...arguments,
    });
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    await _channel.invokeMethod<void>('dispose', <String, int>{
      'textureId': textureId,
    });
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
  int? _targetWidth, _targetHeight;
  int? _width, _height;
  bool _sizing = false;
  bool _retired = false;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final size = constraints.biggest;
      final ratio = MediaQuery.devicePixelRatioOf(context);
      if (size.isFinite && !size.isEmpty) {
        final width = (size.width * ratio).round().clamp(1, 4096);
        final height = (size.height * ratio).round().clamp(1, 4096);
        if (width != _targetWidth || height != _targetHeight) {
          _targetWidth = width;
          _targetHeight = height;
          WidgetsBinding.instance.addPostFrameCallback((_) => _sizeRenderer());
        }
      }
      final renderer = _renderer;
      return renderer == null
          ? const ColoredBox(color: Color(0xff080b18))
          : Texture(
              textureId: renderer.textureId,
              filterQuality: FilterQuality.none,
            );
    },
  );

  Future<void> _sizeRenderer() async {
    if (!mounted || _retired || _sizing) return;
    _sizing = true;
    try {
      while (mounted && !_retired) {
        final width = _targetWidth;
        final height = _targetHeight;
        if (width == null || height == null ||
            (width == _width && height == _height)) {
          return;
        }
        final current = _renderer;
        if (current == null) {
          final renderer = await NativeWorldRenderer.create(
            width: width,
            height: height,
          );
          if (!mounted || _retired) {
            await renderer.dispose();
            return;
          }
          _renderer = renderer;
          _width = width;
          _height = height;
          setState(() {});
          await widget.onCreated(renderer);
        } else {
          await current.resize(width, height);
          _width = width;
          _height = height;
        }
        // Layout changes during either await update the target. Only this owner
        // creates/resizes, and it applies the latest target on its next turn.
      }
    } catch (error, stack) {
      if (mounted && !_retired) {
        FlutterError.reportError(FlutterErrorDetails(
          exception: error,
          stack: stack,
          library: 'native world renderer',
          context: ErrorDescription('while sizing the native world texture'),
        ));
      }
    } finally {
      _sizing = false;
    }
  }

  @override
  void dispose() {
    _retired = true;
    final renderer = _renderer;
    _renderer = null;
    if (renderer != null) unawaited(renderer.dispose());
    super.dispose();
  }
}
