import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'ai_world_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  runApp(const AiWorldClient());
}

class AiWorldClient extends StatelessWidget {
  const AiWorldClient({super.key});

  @override
  Widget build(BuildContext context) => const MaterialApp(
    debugShowCheckedModeBanner: false,
    home: Scaffold(body: _WorldFeed()),
  );
}

class _WorldFeed extends StatefulWidget {
  const _WorldFeed();
  @override
  State<_WorldFeed> createState() => _WorldFeedState();
}

class _WorldFeedState extends State<_WorldFeed> {
  static const address = String.fromEnvironment(
    'SCENE_FEED_URL',
    defaultValue: 'ws://10.0.2.2:8788',
  );
  WebSocket? _socket;
  StreamSubscription<dynamic>? _subscription;
  List<int>? _latest;
  bool _applying = false;
  String _status = 'Connecting to scene feed';

  Future<void> _ready(NativeWorldRenderer renderer) async {
    try {
      final socket = await WebSocket.connect(address);
      if (!mounted) {
        await socket.close();
        return;
      }
      _socket = socket;
      final pipeline = FlutterFramePipeline(renderer);
      setState(() => _status = 'Waiting for scene');
      _subscription = socket.listen(
        (message) {
          if (message is! List<int>) return;
          _latest = message;
          if (!_applying) unawaited(_consume(pipeline));
        },
        onDone: () {
          if (mounted) setState(() => _status = 'Scene feed disconnected');
        },
        onError: (Object error) {
          if (mounted) setState(() => _status = 'Scene feed error: $error');
        },
      );
    } catch (error) {
      if (mounted) {
        setState(() => _status = 'Scene feed unavailable at $address: $error');
      }
    }
  }

  Future<void> _consume(FlutterFramePipeline pipeline) async {
    _applying = true;
    try {
      while (mounted && _latest != null) {
        final message = _latest!;
        _latest = null;
        try {
          final frame = SceneFrame.fromJson(
            jsonDecode(utf8.decode(gzip.decode(message)))
                as Map<String, dynamic>,
          );
          await pipeline.draw(frame);
          if (mounted && _status.isNotEmpty) setState(() => _status = '');
        } catch (error) {
          if (mounted) setState(() => _status = 'Scene error: $error');
        }
      }
    } finally {
      _applying = false;
    }
  }

  @override
  void dispose() {
    _latest = null;
    _subscription?.cancel();
    _socket?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      NativeWorldView(onCreated: _ready),
      if (_status.isNotEmpty)
        SafeArea(
          child: Align(
            alignment: Alignment.topCenter,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                _status,
                style: const TextStyle(color: Colors.white, fontSize: 16),
              ),
            ),
          ),
        ),
    ],
  );
}
