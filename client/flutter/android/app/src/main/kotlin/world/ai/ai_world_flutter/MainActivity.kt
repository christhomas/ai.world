package world.ai.ai_world_flutter

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var rendererBridge: WorldRendererBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        rendererBridge = WorldRendererBridge(flutterEngine.renderer, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        rendererBridge?.dispose()
        rendererBridge = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
