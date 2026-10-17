package world.ai.ai_world_flutter

import android.os.Handler
import android.os.Looper
import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object NativeStateEngine {
    init { System.loadLibrary("ai_world_state_engine") }
    external fun create(source: ByteArray, entry: ByteArray, session: ByteArray, options: ByteArray?,
        memoryMb: Int, budgetMs: Int, replyMb: Int): Long
    external fun request(handle: Long, request: ByteArray): ByteArray
    external fun dispose(handle: Long)
}

/**
 * What each bundled engine is allowed. The hero alone is small and quick; the whole game holds a
 * world, takes a while to open one, and answers with the ground it streams.
 */
private data class EngineLimits(val memoryMb: Int, val budgetMs: Int, val replyMb: Int)
private val LIMITS = mapOf(
    "AiWorldStateEngine" to EngineLimits(64, 5_000, 1),
    // a runaway guard, not a performance target: QuickJS interprets the whole game without a JIT and
    // took more than a minute to open a world on the hosted emulator, so the proof reports what it
    // measured instead of an interrupt (#559, #563)
    "AiWorldGameEngine" to EngineLimits(768, 300_000, 32),
)

/** One engine and the one thread it lives and dies on, which is never another engine's (#559). */
private class Owned(val handle: Long, val executor: java.util.concurrent.ExecutorService)

/**
 * Native handles stay on their owner's executor. Flutter receives only opaque tokens and UTF-8 JSON.
 *
 * Every engine has a thread of its own, so a game's world can run in a second engine beside the
 * game, as the page runs it in a Web Worker beside the page, without either waiting on the other.
 */
class StateEngineBridge(messenger: BinaryMessenger, context: Context) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, "world.ai/state-engine")
    /** For what belongs to no engine: the storage root, and the count of engines. */
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val retired = AtomicBoolean(false)
    private val engines = java.util.concurrent.ConcurrentHashMap<String, Owned>()
    private val storageRoot = java.io.File(context.applicationContext.filesDir, "ai-world")
    init { channel.setMethodCallHandler(this) }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (retired.get()) { result.error("state-engine", "Engine bridge retired", null); return }
        when (call.method) {
            "storageRoot" -> on(executor, result) {
                check(storageRoot.isDirectory || storageRoot.mkdirs()) { "Cannot create app-private storage" }
                storageRoot.canonicalPath
            }
            "create" -> {
                // a new engine is made on its own new thread, and stays there
                val own = Executors.newSingleThreadExecutor()
                on(own, result, onFailure = { own.shutdown() }) {
                    check(engines.size < 4) { "Engine capacity reached" }
                    val source = requireNotNull(call.argument<ByteArray>("source"))
                    val session = requireNotNull(call.argument<String>("session"))
                    val expected = requireNotNull(call.argument<String>("bundleSha256"))
                    val entry = call.argument<String>("entry") ?: "AiWorldStateEngine"
                    val limits = requireNotNull(LIMITS[entry]) { "Unknown bundled engine $entry" }
                    require(source.size <= 32 * 1024 * 1024 && session.isNotEmpty() && session.length <= 256)
                    val digest = MessageDigest.getInstance("SHA-256").digest(source).joinToString("") { "%02x".format(it.toInt() and 255) }
                    require(digest == expected) { "Corrupted bundled engine" }
                    // the hero engine is handed a saved hero; the game engine its options
                    val options = (call.argument<String>("options") ?: call.argument<String>("savedHero"))?.toByteArray(Charsets.UTF_8)
                    require(options == null || options.size <= 8 * 1024 * 1024) { "Engine options too large" }
                    val handle = NativeStateEngine.create(source, entry.toByteArray(Charsets.UTF_8),
                        session.toByteArray(Charsets.UTF_8), options, limits.memoryMb, limits.budgetMs, limits.replyMb)
                    check(handle != 0L) { "Cannot initialize bundled state engine; see native log" }
                    val token = UUID.randomUUID().toString()
                    engines[token] = Owned(handle, own)
                    token
                }
            }
            "request" -> {
                val token = call.argument<String>("token") ?: run { result.error("state-engine", "No engine named", null); return }
                val owned = engines[token] ?: run { result.error("state-engine", "Engine retired", null); return }
                on(owned.executor, result) {
                    check(engines[token] === owned) { "Engine retired" }
                    val request = requireNotNull(call.argument<String>("request")).toByteArray(Charsets.UTF_8)
                    // a parcel of ground from a world engine can be large; the contract bounds it at 8 MiB
                    require(request.size <= 16 * 1024 * 1024) { "Request too large" }
                    val bytes = NativeStateEngine.request(owned.handle, request)
                    check(bytes.isNotEmpty()) { "Native engine returned no response" }
                    val text = String(bytes, 1, bytes.size - 1, Charsets.UTF_8)
                    check(bytes[0] == 0.toByte()) { text }
                    text
                }
            }
            "dispose" -> {
                val token = call.argument<String>("token") ?: run { result.success(null); return }
                val owned = engines.remove(token) ?: run { result.success(null); return }
                on(owned.executor, result) {
                    NativeStateEngine.dispose(owned.handle)
                    null
                }
                owned.executor.shutdown()
            }
            else -> result.notImplemented()
        }
    }

    /** Run on an engine's own thread, and answer Flutter on the main one. */
    private fun on(where: java.util.concurrent.ExecutorService, result: MethodChannel.Result,
                   onFailure: () -> Unit = {}, work: () -> Any?) {
        try {
            where.execute {
                try {
                    check(!retired.get()) { "Engine bridge retired" }
                    val response = work()
                    main.post {
                        if (retired.get()) result.error("state-engine", "Engine bridge retired", null)
                        else result.success(response)
                    }
                } catch (error: Exception) {
                    onFailure()
                    main.post { result.error("state-engine", error.message ?: "Native engine failure", null) }
                }
            }
        } catch (gone: java.util.concurrent.RejectedExecutionException) {
            // the engine was let go while this was on its way to it
            result.error("state-engine", "Engine retired", null)
        }
    }

    fun dispose() {
        if (!retired.compareAndSet(false, true)) return
        channel.setMethodCallHandler(null)
        // each engine is let go on its own thread, as it lived
        for ((token, owned) in engines) {
            engines.remove(token)
            owned.executor.execute { NativeStateEngine.dispose(owned.handle) }
            owned.executor.shutdown()
        }
        executor.shutdown()
    }
}
