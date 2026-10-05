package world.ai.ai_world_flutter

import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object NativeStateEngine {
    init { System.loadLibrary("ai_world_state_engine") }
    external fun create(source: ByteArray, session: ByteArray): Long
    external fun request(handle: Long, request: ByteArray): ByteArray
    external fun dispose(handle: Long)
}

/** Native handles stay on the owner executor. Flutter receives only opaque tokens and UTF-8 JSON. */
class StateEngineBridge(messenger: BinaryMessenger) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, "world.ai/state-engine")
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val retired = AtomicBoolean(false)
    private val engines = mutableMapOf<String, Long>()
    init { channel.setMethodCallHandler(this) }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (retired.get()) { result.error("state-engine", "Engine bridge retired", null); return }
        executor.execute {
            try {
                check(!retired.get()) { "Engine bridge retired" }
                val response: Any? = when (call.method) {
                    "create" -> {
                        check(engines.size < 4) { "Engine capacity reached" }
                        val source = requireNotNull(call.argument<ByteArray>("source"))
                        val session = requireNotNull(call.argument<String>("session"))
                        val expected = requireNotNull(call.argument<String>("bundleSha256"))
                        require(source.size <= 8 * 1024 * 1024 && session.isNotEmpty() && session.length <= 256)
                        val digest = MessageDigest.getInstance("SHA-256").digest(source).joinToString("") { "%02x".format(it.toInt() and 255) }
                        require(digest == expected) { "Corrupted bundled engine" }
                        val handle = NativeStateEngine.create(source, session.toByteArray(Charsets.UTF_8))
                        check(handle != 0L) { "Cannot initialize bundled state engine; see native log" }
                        val token = UUID.randomUUID().toString()
                        engines[token] = handle
                        token
                    }
                    "request" -> {
                        val token = requireNotNull(call.argument<String>("token"))
                        val handle = requireNotNull(engines[token]) { "Engine retired" }
                        val request = requireNotNull(call.argument<String>("request")).toByteArray(Charsets.UTF_8)
                        require(request.size <= 1024 * 1024) { "Request too large" }
                        val bytes = NativeStateEngine.request(handle, request)
                        check(bytes.isNotEmpty()) { "Native engine returned no response" }
                        val text = String(bytes, 1, bytes.size - 1, Charsets.UTF_8)
                        check(bytes[0] == 0.toByte()) { text }
                        text
                    }
                    "dispose" -> {
                        val token = requireNotNull(call.argument<String>("token"))
                        engines.remove(token)?.let(NativeStateEngine::dispose)
                        null
                    }
                    else -> { main.post { result.notImplemented() }; return@execute }
                }
                main.post {
                    if (retired.get()) result.error("state-engine", "Engine bridge retired", null)
                    else result.success(response)
                }
            } catch (error: Exception) {
                main.post { result.error("state-engine", error.message ?: "Native engine failure", null) }
            }
        }
    }

    fun dispose() {
        if (!retired.compareAndSet(false, true)) return
        channel.setMethodCallHandler(null)
        executor.execute {
            engines.values.forEach(NativeStateEngine::dispose)
            engines.clear()
        }
        executor.shutdown()
    }
}
