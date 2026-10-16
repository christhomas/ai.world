package world.ai.ai_world_flutter

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var rendererBridge: WorldRendererBridge? = null
    private var stateEngineBridge: StateEngineBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        rendererBridge = WorldRendererBridge(flutterEngine.renderer, flutterEngine.dartExecutor.binaryMessenger)
        stateEngineBridge = StateEngineBridge(flutterEngine.dartExecutor.binaryMessenger, applicationContext)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        stateEngineBridge?.dispose()
        stateEngineBridge = null
        rendererBridge?.dispose()
        rendererBridge = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
