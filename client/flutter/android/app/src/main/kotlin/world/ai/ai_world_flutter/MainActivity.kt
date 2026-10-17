package world.ai.ai_world_flutter

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var rendererBridge: WorldRendererBridge? = null
    private var stateEngineBridge: StateEngineBridge? = null
    private var soundBridge: SoundBridge? = null
    private var photoShareBridge: PhotoShareBridge? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        rendererBridge = WorldRendererBridge(flutterEngine.renderer, flutterEngine.dartExecutor.binaryMessenger)
        stateEngineBridge = StateEngineBridge(flutterEngine.dartExecutor.binaryMessenger, applicationContext)
        soundBridge = SoundBridge(flutterEngine.dartExecutor.binaryMessenger)
        photoShareBridge = PhotoShareBridge(this, flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (photoShareBridge?.onActivityResult(requestCode) == true) return
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        photoShareBridge?.dispose()
        photoShareBridge = null
        soundBridge?.dispose()
        soundBridge = null
        stateEngineBridge?.dispose()
        stateEngineBridge = null
        rendererBridge?.dispose()
        rendererBridge = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
