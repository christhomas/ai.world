package world.ai.ai_world_flutter

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLExt
import android.opengl.GLES30
import android.opengl.Matrix
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.view.TextureRegistry
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.cos
import kotlin.math.sin

class WorldRendererBridge(
    private val textures: TextureRegistry,
    messenger: BinaryMessenger,
) : MethodChannel.MethodCallHandler {
    private val channel = MethodChannel(messenger, "world.ai/renderer")
    private val renderers = mutableMapOf<Long, GLWorldRenderer>()

    init { channel.setMethodCallHandler(this) }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "create" -> {
                    val width = call.argument<Int>("width") ?: 1
                    val height = call.argument<Int>("height") ?: 1
                    val entry = textures.createSurfaceTexture()
                    try {
                        entry.surfaceTexture().setDefaultBufferSize(width, height)
                        renderers[entry.id()] = GLWorldRenderer(entry, width, height)
                        result.success(entry.id())
                    } catch (failure: Throwable) {
                        entry.release()
                        throw failure
                    }
                }
                "resize" -> renderer(call).resize(call.argument<Int>("width")!!, call.argument<Int>("height")!!).also { result.success(null) }
                "putMesh" -> {
                    val vertices = call.argument<FloatArray>("vertices") ?: error("vertices missing")
                    val indices = call.argument<IntArray>("indices") ?: error("indices missing")
                    renderer(call).putMesh(call.argument<String>("meshId")!!, vertices, indices,
                        call.argument<Boolean>("castShadow") ?: true,
                        call.argument<Boolean>("receiveShadow") ?: true,
                        call.number("opacity"), call.argument<String>("blend") ?: "opaque",
                        call.argument<Int>("emissive") ?: 0,
                        call.argument<Boolean>("depthWrite") ?: true,
                        call.argument<Boolean>("depthTest") ?: true,
                        call.argument<Boolean>("doubleSided") ?: false,
                        call.argument<Boolean>("backSide") ?: false)
                    result.success(null)
                }
                "removeMesh" -> renderer(call).removeMesh(call.argument<String>("meshId")!!).also { result.success(null) }
                "camera" -> renderer(call).camera(
                    call.number("targetX"), call.number("targetY"), call.number("targetZ"),
                    call.number("yaw"), call.number("pitch"), call.number("zoom"),
                ).also { result.success(null) }
                "sceneFrame" -> {
                    val projection = call.argument<FloatArray>("projection") ?: error("projection missing")
                    val world = call.argument<FloatArray>("world") ?: error("world missing")
                    check(projection.size == 16 && world.size == 16) { "scene camera matrices must have 16 elements" }
                    val lights = call.argument<List<Map<String, Any>>>("lights") ?: emptyList()
                    renderer(call).sceneFrame(projection, world, call.argument<Int>("background") ?: 0x080b18,
                        lights, call.argument<Map<String, Any>>("coast"), call.argument<Map<String, Any>>("fog"))
                    result.success(null)
                }
                "cutaway" -> renderer(call).cutaway(
                    call.argument<Boolean>("enabled") == true,
                    call.number("heroX"), call.number("heroY"), call.number("heroZ"),
                ).also { result.success(null) }
                "dispose" -> {
                    val id = call.argument<Number>("textureId")!!.toLong()
                    renderers.remove(id)?.dispose()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        } catch (failure: Throwable) {
            result.error("renderer", failure.message, null)
        }
    }

    private fun renderer(call: MethodCall): GLWorldRenderer =
        renderers[call.argument<Number>("textureId")?.toLong()] ?: error("renderer is not alive")

    fun dispose() {
        channel.setMethodCallHandler(null)
        renderers.values.forEach(GLWorldRenderer::dispose)
        renderers.clear()
    }
}

private fun MethodCall.number(name: String): Float = (argument<Number>(name) ?: error("$name missing")).toFloat()

private data class Mesh(val vertices: FloatArray, val indices: IntArray,
    val castShadow: Boolean, val receiveShadow: Boolean, val opacity: Float, val emissive: Int,
    val blend: String, val depthWrite: Boolean, val depthTest: Boolean, val doubleSided: Boolean, val backSide: Boolean)
private data class GpuMesh(val vertex: Int, val index: Int, val count: Int,
    val castShadow: Boolean, val receiveShadow: Boolean, val opacity: Float, val emissive: Int,
    val blend: String, val depthWrite: Boolean, val depthTest: Boolean, val doubleSided: Boolean, val backSide: Boolean)

private class GLWorldRenderer(
    private val entry: TextureRegistry.SurfaceTextureEntry,
    width: Int,
    height: Int,
) {
    private val thread = HandlerThread("ai-world-gles-${entry.id()}").apply { start() }
    private val handler = Handler(thread.looper)
    private val surface = Surface(entry.surfaceTexture())
    private val pending = linkedMapOf<String, Mesh>()
    private val gpu = linkedMapOf<String, GpuMesh>()
    private var viewportWidth = width
    private var viewportHeight = height
    private var program = 0
    private var shadowProgram = 0
    private var shadowTexture = 0
    private var coastTexture = 0
    private var coastArea = floatArrayOf(0f, 0f, 0f)
    private var shadowFrameBuffer = 0
    private var target = floatArrayOf(8f, 0f, 8f)
    private var yaw = .78f
    private var pitch = .72f
    private var zoom = 18f
    private var cutOn = 1f
    private var hero = floatArrayOf(8f, 1f, 8f)
    private var sceneProjection: FloatArray? = null
    private var sceneWorld: FloatArray? = null
    private var background = 0x080b18
    private var lightDirection = floatArrayOf(-.42f, .82f, -.38f)
    private var ambientLight = floatArrayOf(.35f, .35f, .35f)
    private var skyLight = floatArrayOf(0f, 0f, 0f)
    private var groundLight = floatArrayOf(0f, 0f, 0f)
    private var sunLight = floatArrayOf(.65f, .65f, .65f)
    private var pointPosition = floatArrayOf(0f, 0f, 0f)
    private var pointLight = floatArrayOf(0f, 0f, 0f)
    private var pointRange = 0f
    private var fogColour = floatArrayOf(0f, 0f, 0f)
    private var fogRange = floatArrayOf(0f, 0f)
    private var sunCastsShadow = true
    private var display = EGL14.EGL_NO_DISPLAY
    private var context = EGL14.EGL_NO_CONTEXT
    private var eglSurface = EGL14.EGL_NO_SURFACE
    private val glReleased = AtomicBoolean(false)
    private val disposed = AtomicBoolean(false)
    @Volatile private var running = true

    init {
        val ready = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        if (!handler.post {
            try {
                initialize()
            } catch (cause: Throwable) {
                try { releaseGl() } catch (cleanup: Throwable) { cause.addSuppressed(cleanup) }
                failure.set(cause)
            } finally {
                ready.countDown()
            }
            if (failure.get() == null) {
                drawLoop()
                if (!running) releaseGl()
            }
        }) {
            running = false
            thread.quitSafely()
            surface.release()
            error("Could not start renderer thread")
        }
        if (!ready.await(STARTUP_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            running = false
            thread.quitSafely()
            surface.release()
            error("Renderer initialization timed out")
        }
        failure.get()?.let {
            running = false
            thread.quitSafely()
            surface.release()
            throw it
        }
    }

    fun resize(width: Int, height: Int) = post {
        viewportWidth = width.coerceIn(1, 4096)
        viewportHeight = height.coerceIn(1, 4096)
        entry.surfaceTexture().setDefaultBufferSize(viewportWidth, viewportHeight)
    }
    fun putMesh(id: String, vertices: FloatArray, indices: IntArray,
        castShadow: Boolean, receiveShadow: Boolean, opacity: Float, blend: String, emissive: Int,
        depthWrite: Boolean, depthTest: Boolean, doubleSided: Boolean, backSide: Boolean) = post {
        pending[id] = Mesh(vertices, indices, castShadow, receiveShadow, opacity, emissive, blend, depthWrite, depthTest, doubleSided, backSide)
    }
    fun removeMesh(id: String) = post {
        pending.remove(id)
        gpu.remove(id)?.let { GLES30.glDeleteBuffers(2, intArrayOf(it.vertex, it.index), 0) }
    }
    fun camera(x: Float, y: Float, z: Float, yaw: Float, pitch: Float, zoom: Float) = post {
        sceneProjection = null; sceneWorld = null
        target = floatArrayOf(x, y, z); this.yaw = yaw; this.pitch = pitch; this.zoom = zoom.coerceIn(4f, 80f)
    }
    fun sceneFrame(projection: FloatArray, world: FloatArray, sky: Int,
        lights: List<Map<String, Any>>, coast: Map<String, Any>?, fog: Map<String, Any>?) = post {
        sceneProjection = projection.copyOf(); sceneWorld = world.copyOf(); background = sky
        target = floatArrayOf(world[12] - world[8] * 30f, world[13] - world[9] * 30f, world[14] - world[10] * 30f)
        fun colour(node: Map<String, Any>?, key: String = "colour"): FloatArray {
            val rgb = (node?.get(key) as? Number)?.toInt() ?: 0
            val strength = (node?.get("intensity") as? Number)?.toFloat() ?: 0f
            return floatArrayOf(((rgb shr 16) and 255) / 255f * strength,
                ((rgb shr 8) and 255) / 255f * strength, (rgb and 255) / 255f * strength)
        }
        val ambient = lights.firstOrNull { it["kind"] == "ambient" && it["visible"] != false }
        val hemisphere = lights.firstOrNull { it["kind"] == "hemisphere" && it["visible"] != false }
        val sun = lights.firstOrNull { it["kind"] == "directional" && it["visible"] != false }
        val point = lights.firstOrNull { it["kind"] == "point" && it["visible"] != false }
        ambientLight = colour(ambient)
        skyLight = colour(hemisphere)
        groundLight = colour(hemisphere, "groundColour")
        sunLight = colour(sun)
        sunCastsShadow = sun?.get("castShadow") == true
        pointLight = colour(point)
        pointRange = (point?.get("distance") as? Number)?.toFloat() ?: 0f
        if (fog != null) {
            val rgb = (fog["colour"] as Number).toInt()
            fogColour = floatArrayOf(((rgb shr 16) and 255) / 255f,
                ((rgb shr 8) and 255) / 255f, (rgb and 255) / 255f)
            fogRange = floatArrayOf((fog["near"] as Number).toFloat(), (fog["far"] as Number).toFloat())
        } else fogRange = floatArrayOf(0f, 0f)
        (point?.get("world") as? List<*>)?.let { matrix ->
            if (matrix.size == 16) pointPosition = floatArrayOf(
                (matrix[12] as Number).toFloat(), (matrix[13] as Number).toFloat(), (matrix[14] as Number).toFloat())
        }
        if (sun != null) {
            val matrix = (sun["world"] as? List<*>)?.map { (it as Number).toFloat() }
            val point = (sun["target"] as? List<*>)?.map { (it as Number).toFloat() }
            if (matrix?.size == 16 && point?.size == 3) {
                val x = matrix[12] - point[0]; val y = matrix[13] - point[1]; val z = matrix[14] - point[2]
                val length = kotlin.math.sqrt(x*x + y*y + z*z)
                if (length > 0f) lightDirection = floatArrayOf(x/length, y/length, z/length)
            }
        }
        val samples = coast?.get("values") as? ByteArray
        val size = (coast?.get("size") as? Number)?.toInt() ?: 0
        if (samples != null && size > 0 && samples.size == size * size) {
            if (coastTexture == 0) {
                val names = IntArray(1); GLES30.glGenTextures(1, names, 0); coastTexture = names[0]
            }
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, coastTexture)
            GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_R8, size, size, 0,
                GLES30.GL_RED, GLES30.GL_UNSIGNED_BYTE,
                ByteBuffer.allocateDirect(samples.size).apply { put(samples); position(0) })
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
            GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
            coastArea = floatArrayOf((coast["x0"] as Number).toFloat(),
                (coast["z0"] as Number).toFloat(), 1f / (coast["span"] as Number).toFloat())
        } else coastArea = floatArrayOf(0f, 0f, 0f)
    }
    fun cutaway(on: Boolean, x: Float, y: Float, z: Float) = post { cutOn = if (on) 1f else 0f; hero = floatArrayOf(x, y, z) }

    private fun post(block: () -> Unit) { if (running) handler.post(block) }

    private fun initialize() {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(display != EGL14.EGL_NO_DISPLAY) { "No EGL display" }
        check(EGL14.eglInitialize(display, IntArray(2), 0, IntArray(2), 0)) { "EGL initialization failed" }
        val configs = arrayOfNulls<android.opengl.EGLConfig>(1)
        val count = IntArray(1)
        val attributes = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_DEPTH_SIZE, 24, EGL14.EGL_RENDERABLE_TYPE, EGLExt.EGL_OPENGL_ES3_BIT_KHR, EGL14.EGL_NONE,
        )
        check(EGL14.eglChooseConfig(display, attributes, 0, configs, 0, 1, count, 0) && count[0] > 0) { "No GLES3 EGL configuration" }
        context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
        check(context != EGL14.EGL_NO_CONTEXT) { "Could not create GLES3 context" }
        eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0)
        check(eglSurface != EGL14.EGL_NO_SURFACE) { "Could not create EGL window surface" }
        check(EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)) { "Could not bind GLES surface" }
        program = link(VERTEX_SHADER, FRAGMENT_SHADER)
        shadowProgram = link(SHADOW_VERTEX_SHADER, SHADOW_FRAGMENT_SHADER)
        createShadowTarget()
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        GLES30.glEnable(GLES30.GL_CULL_FACE)
    }

    private fun createShadowTarget() {
        val names = IntArray(1)
        GLES30.glGenTextures(1, names, 0); shadowTexture = names[0]
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadowTexture)
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_DEPTH_COMPONENT24, 1024, 1024, 0, GLES30.GL_DEPTH_COMPONENT, GLES30.GL_UNSIGNED_INT, null)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_COMPARE_MODE, GLES30.GL_COMPARE_REF_TO_TEXTURE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_COMPARE_FUNC, GLES30.GL_LEQUAL)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glGenFramebuffers(1, names, 0); shadowFrameBuffer = names[0]
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, shadowFrameBuffer)
        GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_DEPTH_ATTACHMENT, GLES30.GL_TEXTURE_2D, shadowTexture, 0)
        GLES30.glDrawBuffers(1, intArrayOf(GLES30.GL_NONE), 0)
        check(GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) == GLES30.GL_FRAMEBUFFER_COMPLETE) { "Shadow framebuffer incomplete" }
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
    }

    private fun upload() {
        pending.forEach { (id, mesh) ->
            gpu.remove(id)?.let { GLES30.glDeleteBuffers(2, intArrayOf(it.vertex, it.index), 0) }
            val names = IntArray(2); GLES30.glGenBuffers(2, names, 0)
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, names[0])
            GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, mesh.vertices.size * 4, mesh.vertices.buffer(), GLES30.GL_STATIC_DRAW)
            GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, names[1])
            GLES30.glBufferData(GLES30.GL_ELEMENT_ARRAY_BUFFER, mesh.indices.size * 4, mesh.indices.buffer(), GLES30.GL_STATIC_DRAW)
            gpu[id] = GpuMesh(names[0], names[1], mesh.indices.size,
                mesh.castShadow, mesh.receiveShadow, mesh.opacity, mesh.emissive, mesh.blend, mesh.depthWrite, mesh.depthTest, mesh.doubleSided, mesh.backSide)
        }
        pending.clear()
    }

    private fun drawLoop() {
        if (!running) return
        upload()
        val now = (System.nanoTime() / 1_000_000_000.0).toFloat()
        val matrices = matrices()
        if (sunCastsShadow) drawShadow(matrices.second, now)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        GLES30.glViewport(0, 0, viewportWidth, viewportHeight)
        GLES30.glClearColor(((background shr 16) and 255) / 255f, ((background shr 8) and 255) / 255f, (background and 255) / 255f, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
        GLES30.glUseProgram(program)
        uniformMatrix(program, "uMvp", matrices.first)
        uniformMatrix(program, "uLightMvp", matrices.second)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uHero"), 1, hero, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uLook"), 1, matrices.third, 0)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uCutOn"), cutOn)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uTime"), now)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uLightDir"), 1, lightDirection, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uAmbient"), 1, ambientLight, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uSky"), 1, skyLight, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uGround"), 1, groundLight, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uSun"), 1, sunLight, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uPointPos"), 1, pointPosition, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uPoint"), 1, pointLight, 0)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uPointRange"), pointRange)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uCameraPos"), 1, sceneWorld?.copyOfRange(12, 15) ?: floatArrayOf(0f, 0f, 0f), 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uFogColour"), 1, fogColour, 0)
        GLES30.glUniform2fv(GLES30.glGetUniformLocation(program, "uFogRange"), 1, fogRange, 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadowTexture)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uShadow"), 0)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, coastTexture)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uCoast"), 1)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uCoastArea"), 1, coastArea, 0)
        drawMeshes(program, false)
        EGL14.eglSwapBuffers(display, eglSurface)
        handler.postDelayed(::drawLoop, 16)
    }

    private fun drawShadow(lightMvp: FloatArray, time: Float) {
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, shadowFrameBuffer)
        GLES30.glViewport(0, 0, 1024, 1024)
        GLES30.glClear(GLES30.GL_DEPTH_BUFFER_BIT)
        GLES30.glUseProgram(shadowProgram)
        uniformMatrix(shadowProgram, "uMvp", lightMvp)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(shadowProgram, "uTime"), time)
        drawMeshes(shadowProgram, true)
    }

    private fun drawMeshes(activeProgram: Int, shadow: Boolean) {
        gpu.values.forEach { mesh ->
            if (shadow && !mesh.castShadow) return@forEach
            if (shadow) {
                if (mesh.doubleSided) GLES30.glDisable(GLES30.GL_CULL_FACE) else {
                    GLES30.glEnable(GLES30.GL_CULL_FACE)
                    GLES30.glCullFace(if (mesh.backSide) GLES30.GL_FRONT else GLES30.GL_BACK)
                }
            }
            if (!shadow) {
                GLES30.glDepthMask(mesh.depthWrite)
                if (mesh.depthTest) GLES30.glEnable(GLES30.GL_DEPTH_TEST) else GLES30.glDisable(GLES30.GL_DEPTH_TEST)
                if (mesh.doubleSided) GLES30.glDisable(GLES30.GL_CULL_FACE) else {
                    GLES30.glEnable(GLES30.GL_CULL_FACE)
                    GLES30.glCullFace(if (mesh.backSide) GLES30.GL_FRONT else GLES30.GL_BACK)
                }
                if (mesh.blend == "opaque") GLES30.glDisable(GLES30.GL_BLEND) else {
                    GLES30.glEnable(GLES30.GL_BLEND)
                    GLES30.glBlendFunc(GLES30.GL_SRC_ALPHA,
                        if (mesh.blend == "additive") GLES30.GL_ONE else GLES30.GL_ONE_MINUS_SRC_ALPHA)
                }
                GLES30.glUniform1f(GLES30.glGetUniformLocation(activeProgram, "uOpacity"), mesh.opacity)
                val rgb = mesh.emissive
                GLES30.glUniform3f(GLES30.glGetUniformLocation(activeProgram, "uEmissive"),
                    ((rgb shr 16) and 255) / 255f, ((rgb shr 8) and 255) / 255f, (rgb and 255) / 255f)
                GLES30.glUniform1f(GLES30.glGetUniformLocation(activeProgram, "uReceiveShadow"),
                    if (mesh.receiveShadow && sunCastsShadow) 1f else 0f)
            }
            GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, mesh.vertex)
            GLES30.glBindBuffer(GLES30.GL_ELEMENT_ARRAY_BUFFER, mesh.index)
            val stride = 14 * 4
            attribute(activeProgram, "aPosition", 3, stride, 0)
            attribute(activeProgram, "aNormal", 3, stride, 3 * 4)
            attribute(activeProgram, "aColor", 3, stride, 6 * 4)
            attribute(activeProgram, "aMaterial", 1, stride, 9 * 4)
            attribute(activeProgram, "aJoint", 1, stride, 10 * 4)
            attribute(activeProgram, "aPivot", 3, stride, 11 * 4)
            GLES30.glDrawElements(GLES30.GL_TRIANGLES, mesh.count, GLES30.GL_UNSIGNED_INT, 0)
        }
        if (!shadow) { GLES30.glDepthMask(true); GLES30.glDisable(GLES30.GL_BLEND); GLES30.glEnable(GLES30.GL_DEPTH_TEST) }
        GLES30.glEnable(GLES30.GL_CULL_FACE)
        GLES30.glCullFace(GLES30.GL_BACK)
    }

    private fun attribute(activeProgram: Int, name: String, size: Int, stride: Int, offset: Int) {
        val location = GLES30.glGetAttribLocation(activeProgram, name)
        if (location < 0) return
        GLES30.glEnableVertexAttribArray(location)
        GLES30.glVertexAttribPointer(location, size, GLES30.GL_FLOAT, false, stride, offset)
    }

    private fun matrices(): Triple<FloatArray, FloatArray, FloatArray> {
        val cp = cos(pitch)
        val eyeDistance = zoom * 1.35f
        val eye = floatArrayOf(target[0] + cos(yaw) * cp * eyeDistance, target[1] + sin(pitch) * eyeDistance, target[2] + sin(yaw) * cp * eyeDistance)
        val view = FloatArray(16); Matrix.setLookAtM(view, 0, eye[0], eye[1], eye[2], target[0], target[1], target[2], 0f, 1f, 0f)
        val projection = FloatArray(16); val aspect = viewportWidth.toFloat() / viewportHeight
        Matrix.orthoM(projection, 0, -zoom * aspect / 2, zoom * aspect / 2, -zoom / 2, zoom / 2, .1f, 300f)
        val mvp = FloatArray(16); Matrix.multiplyMM(mvp, 0, projection, 0, view, 0)
        val lightView = FloatArray(16); Matrix.setLookAtM(lightView, 0,
            target[0]+lightDirection[0]*64, target[1]+lightDirection[1]*64, target[2]+lightDirection[2]*64,
            target[0], target[1], target[2], 0f,1f,0f)
        val lightProjection = FloatArray(16); Matrix.orthoM(lightProjection,0,-32f,32f,-32f,32f,.1f,120f)
        val lightMvp = FloatArray(16); Matrix.multiplyMM(lightMvp,0,lightProjection,0,lightView,0)
        val look = floatArrayOf(target[0]-eye[0], target[1]-eye[1], target[2]-eye[2]); val length = kotlin.math.sqrt(look.sumOf { (it*it).toDouble() }).toFloat()
        for(i in look.indices) look[i] /= length
        val frameProjection = sceneProjection; val frameWorld = sceneWorld
        if (frameProjection != null && frameWorld != null) {
            val inverse = FloatArray(16)
            check(Matrix.invertM(inverse, 0, frameWorld, 0)) { "scene camera matrix is singular" }
            Matrix.multiplyMM(mvp, 0, frameProjection, 0, inverse, 0)
            look[0] = -frameWorld[8]; look[1] = -frameWorld[9]; look[2] = -frameWorld[10]
        }
        return Triple(mvp, lightMvp, look)
    }

    fun dispose() {
        if (!disposed.compareAndSet(false, true)) return
        running = false
        handler.removeCallbacksAndMessages(null)
        val done = CountDownLatch(1)
        val cleanupPosted = thread.isAlive && handler.post {
            try { releaseGl() } finally { done.countDown() }
        }
        if (cleanupPosted) done.await(DISPOSAL_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        thread.quitSafely()
        surface.release()
        entry.release()
    }

    private fun releaseGl() {
        if (!glReleased.compareAndSet(false, true)) return
        val hasDisplay = display != EGL14.EGL_NO_DISPLAY
        val hasContext = context != EGL14.EGL_NO_CONTEXT
        val hasSurface = eglSurface != EGL14.EGL_NO_SURFACE
        if (hasDisplay && hasContext && hasSurface) {
            EGL14.eglMakeCurrent(display, eglSurface, eglSurface, context)
            gpu.values.forEach { GLES30.glDeleteBuffers(2, intArrayOf(it.vertex, it.index), 0) }
            if (program != 0) GLES30.glDeleteProgram(program)
            if (shadowProgram != 0) GLES30.glDeleteProgram(shadowProgram)
            if (shadowTexture != 0) GLES30.glDeleteTextures(1, intArrayOf(shadowTexture), 0)
            if (shadowFrameBuffer != 0) GLES30.glDeleteFramebuffers(1, intArrayOf(shadowFrameBuffer), 0)
            if (coastTexture != 0) GLES30.glDeleteTextures(1, intArrayOf(coastTexture), 0)
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        }
        if (hasDisplay && hasSurface) EGL14.eglDestroySurface(display, eglSurface)
        if (hasDisplay && hasContext) EGL14.eglDestroyContext(display, context)
        if (hasDisplay) EGL14.eglTerminate(display)
        gpu.clear()
        program = 0; shadowProgram = 0; shadowTexture = 0; shadowFrameBuffer = 0; coastTexture = 0
        display = EGL14.EGL_NO_DISPLAY; context = EGL14.EGL_NO_CONTEXT; eglSurface = EGL14.EGL_NO_SURFACE
    }

    private fun link(vertexSource: String, fragmentSource: String): Int {
        fun compile(kind: Int, source: String): Int {
            val shader = GLES30.glCreateShader(kind); GLES30.glShaderSource(shader, source); GLES30.glCompileShader(shader)
            val ok = IntArray(1); GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, ok, 0)
            if (ok[0] == 0) {
                val message = GLES30.glGetShaderInfoLog(shader)
                GLES30.glDeleteShader(shader)
                error(message)
            }
            return shader
        }
        var vertex = 0
        var fragment = 0
        var linked = 0
        var complete = false
        try {
            vertex = compile(GLES30.GL_VERTEX_SHADER, vertexSource)
            fragment = compile(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
            linked = GLES30.glCreateProgram()
            GLES30.glAttachShader(linked, vertex); GLES30.glAttachShader(linked, fragment); GLES30.glLinkProgram(linked)
            val ok = IntArray(1); GLES30.glGetProgramiv(linked, GLES30.GL_LINK_STATUS, ok, 0)
            check(ok[0] != 0) { GLES30.glGetProgramInfoLog(linked) }
            complete = true
            return linked
        } finally {
            if (vertex != 0) GLES30.glDeleteShader(vertex)
            if (fragment != 0) GLES30.glDeleteShader(fragment)
            if (!complete && linked != 0) GLES30.glDeleteProgram(linked)
        }
    }
    private fun uniformMatrix(program: Int, name: String, matrix: FloatArray) = GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(program, name), 1, false, matrix, 0)
}

private const val STARTUP_TIMEOUT_MS = 5_000L
private const val DISPOSAL_TIMEOUT_MS = 250L

private fun FloatArray.buffer(): FloatBuffer = ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(this@buffer); position(0) }
private fun IntArray.buffer(): IntBuffer = ByteBuffer.allocateDirect(size * 4).order(ByteOrder.nativeOrder()).asIntBuffer().apply { put(this@buffer); position(0) }

private const val ANIMATION = """
vec3 animate(vec3 p, float joint, vec3 pivot, float time) {
  if (joint < 0.5) return p;
  float side = (joint == 1.0 || joint == 3.0 || joint == 7.0) ? 1.0 : -1.0;
  float angle = sin(time * 5.0) * 0.48 * side;
  if (joint == 6.0) angle = sin(time * 0.7) * 0.10;
  if (joint == 7.0 || joint == 8.0) angle = sin(time * 7.0) * 0.35 * side;
  vec3 q = p - pivot;
  float c = cos(angle), s = sin(angle);
  if (joint == 7.0 || joint == 8.0) q.yz = mat2(c,-s,s,c) * q.yz;
  else q.xy = mat2(c,-s,s,c) * q.xy;
  return q + pivot;
}
"""
private const val VERTEX_SHADER = """#version 300 es
precision highp float;
in vec3 aPosition; in vec3 aNormal; in vec3 aColor; in float aMaterial; in float aJoint; in vec3 aPivot;
uniform mat4 uMvp; uniform mat4 uLightMvp; uniform float uTime;
out vec3 vWorld; out vec3 vNormal; out vec3 vColor; out vec4 vShadow; out float vMaterial;
$ANIMATION
void main(){ vec3 p=animate(aPosition,aJoint,aPivot,uTime); vWorld=p; vNormal=aNormal; vColor=aColor; vMaterial=aMaterial; vShadow=uLightMvp*vec4(p,1); gl_Position=uMvp*vec4(p,1); }
"""
private const val FRAGMENT_SHADER = """#version 300 es
precision highp float;
in vec3 vWorld; in vec3 vNormal; in vec3 vColor; in vec4 vShadow; in float vMaterial;
uniform sampler2DShadow uShadow; uniform vec3 uHero; uniform vec3 uLook; uniform vec3 uLightDir; uniform float uCutOn; uniform float uTime; uniform float uOpacity; uniform float uReceiveShadow;
uniform vec3 uAmbient; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uPointPos; uniform vec3 uPoint; uniform float uPointRange;
uniform vec3 uCameraPos; uniform vec3 uFogColour; uniform vec2 uFogRange;
uniform vec3 uEmissive;
uniform sampler2D uCoast; uniform vec3 uCoastArea;
out vec4 color;
float hash(vec2 p){return fract(sin(dot(floor(p),vec2(12.9898,78.233)))*43758.5453);}
float shadow(){vec3 q=vShadow.xyz/vShadow.w*.5+.5;if(any(lessThan(q,vec3(0)))||any(greaterThan(q,vec3(1))))return 1.0;float s=0.0;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(uShadow,vec3(q.xy+vec2(x,y)/1024.0,q.z-.002));return s/9.0;}
void main(){if(uCutOn>.5&&vMaterial>.5&&vMaterial<1.5&&vWorld.y>uHero.y+1.0){vec3 d=vWorld-uHero;float along=dot(d,uLook);float across=length(d-along*uLook);float front=clamp((-along-1.2)/4.0,0.0,1.0);if(front>0.0){float hole=5.5*front;float edge=smoothstep(hole-2.5,hole,across);if(edge<hash(gl_FragCoord.xy))discard;}}vec3 n=normalize(vNormal);float shade=mix(1.0,shadow(),uReceiveShadow);vec3 lit=uAmbient+mix(uGround,uSky,n.y*.5+.5)+uSun*max(0.0,dot(n,normalize(uLightDir)))*mix(.45,1.0,shade);vec3 toPoint=uPointPos-vWorld;float distance=length(toPoint);if(uPointRange>0.0&&distance<uPointRange)lit+=uPoint*max(0.0,dot(n,normalize(toPoint)))*pow(1.0-distance/uPointRange,2.0);vec3 c=vColor*(vMaterial>2.5?vec3(1.0):lit)+uEmissive;if(vMaterial>1.5&&vMaterial<2.5){float coast=1.0;if(uCoastArea.z>0.0)coast=texture(uCoast,(vWorld.xz-uCoastArea.xy)*uCoastArea.z).r;c*=.86+.14*sin(uTime*1.6+coast*15.0+vWorld.x*.7+vWorld.z*.6);}if(uFogRange.y>uFogRange.x)c=mix(c,uFogColour,clamp((length(vWorld-uCameraPos)-uFogRange.x)/(uFogRange.y-uFogRange.x),0.0,1.0));color=vec4(c,uOpacity);}
"""
private const val SHADOW_VERTEX_SHADER = """#version 300 es
precision highp float; in vec3 aPosition; in float aJoint; in vec3 aPivot; uniform mat4 uMvp; uniform float uTime;
$ANIMATION
void main(){gl_Position=uMvp*vec4(animate(aPosition,aJoint,aPivot,uTime),1);}
"""
private const val SHADOW_FRAGMENT_SHADER = """#version 300 es
precision highp float; void main(){}
"""
