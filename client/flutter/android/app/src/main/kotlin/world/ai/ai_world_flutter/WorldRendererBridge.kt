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
                    entry.surfaceTexture().setDefaultBufferSize(width, height)
                    renderers[entry.id()] = GLWorldRenderer(entry, width, height)
                    result.success(entry.id())
                }
                "resize" -> renderer(call).resize(call.argument<Int>("width")!!, call.argument<Int>("height")!!).also { result.success(null) }
                "putMesh" -> {
                    val vertices = call.argument<FloatArray>("vertices") ?: error("vertices missing")
                    val indices = call.argument<IntArray>("indices") ?: error("indices missing")
                    renderer(call).putMesh(call.argument<String>("meshId")!!, vertices, indices)
                    result.success(null)
                }
                "removeMesh" -> renderer(call).removeMesh(call.argument<String>("meshId")!!).also { result.success(null) }
                "camera" -> renderer(call).camera(
                    call.number("targetX"), call.number("targetY"), call.number("targetZ"),
                    call.number("yaw"), call.number("pitch"), call.number("zoom"),
                ).also { result.success(null) }
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

private data class Mesh(val vertices: FloatArray, val indices: IntArray)
private data class GpuMesh(val vertex: Int, val index: Int, val count: Int)

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
    private var shadowFrameBuffer = 0
    private var target = floatArrayOf(8f, 0f, 8f)
    private var yaw = .78f
    private var pitch = .72f
    private var zoom = 18f
    private var cutOn = 1f
    private var hero = floatArrayOf(8f, 1f, 8f)
    private lateinit var display: android.opengl.EGLDisplay
    private lateinit var context: android.opengl.EGLContext
    private lateinit var eglSurface: android.opengl.EGLSurface
    @Volatile private var running = true

    init {
        val ready = CountDownLatch(1)
        handler.post {
            try { initialize() } finally { ready.countDown() }
            drawLoop()
        }
        ready.await()
    }

    fun resize(width: Int, height: Int) = post {
        viewportWidth = width.coerceIn(1, 4096)
        viewportHeight = height.coerceIn(1, 4096)
        entry.surfaceTexture().setDefaultBufferSize(viewportWidth, viewportHeight)
    }
    fun putMesh(id: String, vertices: FloatArray, indices: IntArray) = post { pending[id] = Mesh(vertices, indices) }
    fun removeMesh(id: String) = post {
        pending.remove(id)
        gpu.remove(id)?.let { GLES30.glDeleteBuffers(2, intArrayOf(it.vertex, it.index), 0) }
    }
    fun camera(x: Float, y: Float, z: Float, yaw: Float, pitch: Float, zoom: Float) = post {
        target = floatArrayOf(x, y, z); this.yaw = yaw; this.pitch = pitch; this.zoom = zoom.coerceIn(4f, 80f)
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
        eglSurface = EGL14.eglCreateWindowSurface(display, configs[0], surface, intArrayOf(EGL14.EGL_NONE), 0)
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
            gpu[id] = GpuMesh(names[0], names[1], mesh.indices.size)
        }
        pending.clear()
    }

    private fun drawLoop() {
        if (!running) return
        upload()
        val now = (System.nanoTime() / 1_000_000_000.0).toFloat()
        val matrices = matrices()
        drawShadow(matrices.second, now)
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        GLES30.glViewport(0, 0, viewportWidth, viewportHeight)
        GLES30.glClearColor(.025f, .035f, .085f, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
        GLES30.glUseProgram(program)
        uniformMatrix(program, "uMvp", matrices.first)
        uniformMatrix(program, "uLightMvp", matrices.second)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uHero"), 1, hero, 0)
        GLES30.glUniform3fv(GLES30.glGetUniformLocation(program, "uLook"), 1, matrices.third, 0)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uCutOn"), cutOn)
        GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uTime"), now)
        GLES30.glUniform3f(GLES30.glGetUniformLocation(program, "uLightDir"), -.42f, .82f, -.38f)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadowTexture)
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uShadow"), 0)
        drawMeshes(program)
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
        drawMeshes(shadowProgram)
    }

    private fun drawMeshes(activeProgram: Int) {
        gpu.values.forEach { mesh ->
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
    }

    private fun attribute(activeProgram: Int, name: String, size: Int, stride: Int, offset: Int) {
        val location = GLES30.glGetAttribLocation(activeProgram, name)
        if (location < 0) return
        GLES30.glEnableVertexAttribArray(location)
        GLES30.glVertexAttribPointer(location, size, GLES30.GL_FLOAT, false, stride, offset)
    }

    private fun matrices(): Triple<FloatArray, FloatArray, FloatArray> {
        val cp = cos(pitch), eyeDistance = zoom * 1.35f
        val eye = floatArrayOf(target[0] + cos(yaw) * cp * eyeDistance, target[1] + sin(pitch) * eyeDistance, target[2] + sin(yaw) * cp * eyeDistance)
        val view = FloatArray(16); Matrix.setLookAtM(view, 0, eye[0], eye[1], eye[2], target[0], target[1], target[2], 0f, 1f, 0f)
        val projection = FloatArray(16); val aspect = viewportWidth.toFloat() / viewportHeight
        Matrix.orthoM(projection, 0, -zoom * aspect / 2, zoom * aspect / 2, -zoom / 2, zoom / 2, .1f, 300f)
        val mvp = FloatArray(16); Matrix.multiplyMM(mvp, 0, projection, 0, view, 0)
        val lightView = FloatArray(16); Matrix.setLookAtM(lightView, 0, target[0]-32, target[1]+48, target[2]-30, target[0], target[1], target[2], 0f,1f,0f)
        val lightProjection = FloatArray(16); Matrix.orthoM(lightProjection,0,-32f,32f,-32f,32f,.1f,120f)
        val lightMvp = FloatArray(16); Matrix.multiplyMM(lightMvp,0,lightProjection,0,lightView,0)
        val look = floatArrayOf(target[0]-eye[0], target[1]-eye[1], target[2]-eye[2]); val length = kotlin.math.sqrt(look.sumOf { (it*it).toDouble() }).toFloat()
        for(i in look.indices) look[i] /= length
        return Triple(mvp, lightMvp, look)
    }

    fun dispose() {
        if (!running) return
        running = false
        val done = CountDownLatch(1)
        handler.post {
            gpu.values.forEach { GLES30.glDeleteBuffers(2, intArrayOf(it.vertex, it.index), 0) }
            GLES30.glDeleteProgram(program); GLES30.glDeleteProgram(shadowProgram)
            GLES30.glDeleteTextures(1, intArrayOf(shadowTexture), 0)
            GLES30.glDeleteFramebuffers(1, intArrayOf(shadowFrameBuffer), 0)
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroySurface(display, eglSurface); EGL14.eglDestroyContext(display, context); EGL14.eglTerminate(display)
            surface.release(); entry.release(); done.countDown()
        }
        done.await(); thread.quitSafely()
    }

    private fun link(vertexSource: String, fragmentSource: String): Int {
        fun compile(kind: Int, source: String): Int {
            val shader = GLES30.glCreateShader(kind); GLES30.glShaderSource(shader, source); GLES30.glCompileShader(shader)
            val ok = IntArray(1); GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, ok, 0)
            check(ok[0] != 0) { GLES30.glGetShaderInfoLog(shader) }
            return shader
        }
        val vertex = compile(GLES30.GL_VERTEX_SHADER, vertexSource), fragment = compile(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
        val linked = GLES30.glCreateProgram(); GLES30.glAttachShader(linked, vertex); GLES30.glAttachShader(linked, fragment); GLES30.glLinkProgram(linked)
        GLES30.glDeleteShader(vertex); GLES30.glDeleteShader(fragment)
        val ok = IntArray(1); GLES30.glGetProgramiv(linked, GLES30.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { GLES30.glGetProgramInfoLog(linked) }
        return linked
    }
    private fun uniformMatrix(program: Int, name: String, matrix: FloatArray) = GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(program, name), 1, false, matrix, 0)
}

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
uniform sampler2DShadow uShadow; uniform vec3 uHero; uniform vec3 uLook; uniform vec3 uLightDir; uniform float uCutOn; uniform float uTime;
out vec4 color;
float hash(vec2 p){return fract(sin(dot(floor(p),vec2(12.9898,78.233)))*43758.5453);}
float shadow(){vec3 q=vShadow.xyz/vShadow.w*.5+.5;if(any(lessThan(q,vec3(0)))||any(greaterThan(q,vec3(1))))return 1.0;float s=0.0;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)s+=texture(uShadow,vec3(q.xy+vec2(x,y)/1024.0,q.z-.002));return s/9.0;}
void main(){if(uCutOn>.5&&vMaterial>.5&&vMaterial<1.5&&vWorld.y>uHero.y+1.0){vec3 d=vWorld-uHero;float along=dot(d,uLook);float across=length(d-along*uLook);float front=clamp((-along-1.2)/4.0,0.0,1.0);if(front>0.0){float hole=5.5*front;float edge=smoothstep(hole-2.5,hole,across);if(edge<hash(gl_FragCoord.xy))discard;}}float lit=.35+.65*max(0.0,dot(normalize(vNormal),normalize(uLightDir)))*mix(.45,1.0,shadow());vec3 c=vColor*lit;if(vMaterial>1.5)c*=.86+.14*sin(uTime*1.6+vWorld.x*.7+vWorld.z*.6);color=vec4(c,1);}
"""
private const val SHADOW_VERTEX_SHADER = """#version 300 es
precision highp float; in vec3 aPosition; in float aJoint; in vec3 aPivot; uniform mat4 uMvp; uniform float uTime;
$ANIMATION
void main(){gl_Position=uMvp*vec4(animate(aPosition,aJoint,aPivot,uTime),1);}
"""
private const val SHADOW_FRAGMENT_SHADER = """#version 300 es
precision highp float; void main(){}
"""
