import CoreVideo
import Flutter
import Metal
import QuartzCore
import simd

final class WorldRendererBridge: NSObject, FlutterPlugin {
  private let textures: FlutterTextureRegistry
  private var renderers: [Int64: MetalWorldRenderer] = [:]

  init(textures: FlutterTextureRegistry) {
    self.textures = textures
  }

  static func register(with registrar: FlutterPluginRegistrar) {
    let instance = WorldRendererBridge(textures: registrar.textures())
    let channel = FlutterMethodChannel(name: "world.ai/renderer", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(instance, channel: channel)
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    do {
      let arguments = call.arguments as? [String: Any] ?? [:]
      if call.method == "create" {
        let renderer = try MetalWorldRenderer(
          textures: textures,
          width: arguments.int("width"),
          height: arguments.int("height")
        )
        renderers[renderer.textureId] = renderer
        result(renderer.textureId)
        return
      }
      let textureId = Int64(arguments.number("textureId"))
      guard let renderer = renderers[textureId] else { throw RenderFailure("renderer is not alive") }
      switch call.method {
      case "resize": renderer.resize(width: arguments.int("width"), height: arguments.int("height"))
      case "putMesh":
        guard let vertexData = arguments["vertices"] as? FlutterStandardTypedData,
              let indexData = arguments["indices"] as? FlutterStandardTypedData,
              let meshId = arguments["meshId"] as? String else { throw RenderFailure("mesh payload missing") }
        renderer.putMesh(id: meshId, vertices: vertexData.data, indices: indexData.data)
      case "removeMesh": renderer.removeMesh(id: arguments.string("meshId"))
      case "camera": renderer.setCamera(
        x: arguments.float("targetX"), y: arguments.float("targetY"), z: arguments.float("targetZ"),
        yaw: arguments.float("yaw"), pitch: arguments.float("pitch"), zoom: arguments.float("zoom")
      )
      case "cutaway": renderer.setCutaway(
        enabled: arguments["enabled"] as? Bool == true,
        x: arguments.float("heroX"), y: arguments.float("heroY"), z: arguments.float("heroZ")
      )
      case "dispose":
        renderer.dispose()
        renderers.removeValue(forKey: textureId)
      default:
        result(FlutterMethodNotImplemented)
        return
      }
      result(nil)
    } catch {
      result(FlutterError(code: "renderer", message: error.localizedDescription, details: nil))
    }
  }
}

private struct RenderFailure: LocalizedError {
  let text: String
  init(_ text: String) { self.text = text }
  var errorDescription: String? { text }
}

private extension Dictionary where Key == String, Value == Any {
  func number(_ key: String) -> Double { (self[key] as? NSNumber)?.doubleValue ?? 0 }
  func float(_ key: String) -> Float { Float(number(key)) }
  func int(_ key: String) -> Int { Swift.max(1, Swift.min(4096, (self[key] as? NSNumber)?.intValue ?? 1)) }
  func string(_ key: String) -> String { self[key] as? String ?? "" }
}

private struct Uniforms {
  var mvp: simd_float4x4
  var lightMvp: simd_float4x4
  var heroAndCut: SIMD4<Float>
  var lookAndTime: SIMD4<Float>
  var lightDirection: SIMD4<Float>
}

private struct CpuMesh { let vertices: Data; let indices: Data }
private struct GpuMesh { let vertices: MTLBuffer; let indices: MTLBuffer; let count: Int }

private final class MetalWorldRenderer: NSObject, FlutterTexture {
  private let textures: FlutterTextureRegistry
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipeline: MTLRenderPipelineState
  private let shadowPipeline: MTLRenderPipelineState
  private let textureCache: CVMetalTextureCache
  private var pixelBuffer: CVPixelBuffer
  private var colorTexture: CVMetalTexture
  private var depthTexture: MTLTexture
  private var shadowTexture: MTLTexture
  private var pending: [String: CpuMesh] = [:]
  private var meshes: [String: GpuMesh] = [:]
  private var displayLink: CADisplayLink?
  private(set) var textureId: Int64 = -1
  private var width: Int
  private var height: Int
  private var target = SIMD3<Float>(8, 0, 8)
  private var yaw: Float = 0.78
  private var pitch: Float = 0.72
  private var zoom: Float = 18
  private var cutOn: Float = 1
  private var hero = SIMD3<Float>(8, 1, 8)
  private var disposed = false

  init(textures: FlutterTextureRegistry, width: Int, height: Int) throws {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      throw RenderFailure("Metal is unavailable")
    }
    self.textures = textures
    self.device = device
    self.queue = queue
    self.width = width
    self.height = height
    var cache: CVMetalTextureCache?
    CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
    guard let cache else { throw RenderFailure("Metal texture cache could not be made") }
    textureCache = cache
    let target = try Self.makeTarget(device: device, cache: cache, width: width, height: height)
    pixelBuffer = target.0
    colorTexture = target.1
    depthTexture = try Self.makeDepth(device: device, width: width, height: height)
    shadowTexture = try Self.makeDepth(device: device, width: 1024, height: 1024)

    let library = try device.makeLibrary(source: metalSource, options: nil)
    guard let vertex = library.makeFunction(name: "worldVertex"),
          let fragment = library.makeFunction(name: "worldFragment"),
          let shadowVertex = library.makeFunction(name: "shadowVertex") else {
      throw RenderFailure("Metal shader functions are missing")
    }
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = vertex
    descriptor.fragmentFunction = fragment
    descriptor.vertexDescriptor = Self.vertexDescriptor()
    descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
    descriptor.depthAttachmentPixelFormat = .depth32Float
    pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    let shadowDescriptor = MTLRenderPipelineDescriptor()
    shadowDescriptor.vertexFunction = shadowVertex
    shadowDescriptor.vertexDescriptor = Self.vertexDescriptor()
    shadowDescriptor.depthAttachmentPixelFormat = .depth32Float
    shadowPipeline = try device.makeRenderPipelineState(descriptor: shadowDescriptor)
    super.init()
    textureId = textures.register(self)
    let link = CADisplayLink(target: self, selector: #selector(frame))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  func copyPixelBuffer() -> Unmanaged<CVPixelBuffer>? {
    disposed ? nil : Unmanaged.passRetained(pixelBuffer)
  }

  func resize(width: Int, height: Int) {
    guard !disposed, width != self.width || height != self.height else { return }
    do {
      let target = try Self.makeTarget(device: device, cache: textureCache, width: width, height: height)
      pixelBuffer = target.0; colorTexture = target.1
      depthTexture = try Self.makeDepth(device: device, width: width, height: height)
      self.width = width; self.height = height
    } catch { return }
  }

  func putMesh(id: String, vertices: Data, indices: Data) { pending[id] = CpuMesh(vertices: vertices, indices: indices) }
  func removeMesh(id: String) { pending.removeValue(forKey: id); meshes.removeValue(forKey: id) }
  func setCamera(x: Float, y: Float, z: Float, yaw: Float, pitch: Float, zoom: Float) {
    target = SIMD3(x,y,z); self.yaw = yaw; self.pitch = pitch; self.zoom = max(4,min(80,zoom))
  }
  func setCutaway(enabled: Bool, x: Float, y: Float, z: Float) { cutOn = enabled ? 1 : 0; hero = SIMD3(x,y,z) }

  @objc private func frame() {
    guard !disposed, let drawable = CVMetalTextureGetTexture(colorTexture), let commands = queue.makeCommandBuffer() else { return }
    uploadPending()
    let uniforms = makeUniforms(time: Float(CACurrentMediaTime()))

    let shadowPass = MTLRenderPassDescriptor()
    shadowPass.depthAttachment.texture = shadowTexture
    shadowPass.depthAttachment.loadAction = .clear
    shadowPass.depthAttachment.storeAction = .store
    shadowPass.depthAttachment.clearDepth = 1
    if let encoder = commands.makeRenderCommandEncoder(descriptor: shadowPass) {
      encoder.setRenderPipelineState(shadowPipeline)
      encoder.setDepthStencilState(depthState())
      encoder.setVertexBytes([uniforms], length: MemoryLayout<Uniforms>.stride, index: 1)
      draw(encoder)
      encoder.endEncoding()
    }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.025, green: 0.035, blue: 0.085, alpha: 1)
    pass.depthAttachment.texture = depthTexture
    pass.depthAttachment.loadAction = .clear
    pass.depthAttachment.storeAction = .dontCare
    pass.depthAttachment.clearDepth = 1
    if let encoder = commands.makeRenderCommandEncoder(descriptor: pass) {
      encoder.setRenderPipelineState(pipeline)
      encoder.setDepthStencilState(depthState())
      encoder.setCullMode(.back)
      encoder.setVertexBytes([uniforms], length: MemoryLayout<Uniforms>.stride, index: 1)
      encoder.setFragmentBytes([uniforms], length: MemoryLayout<Uniforms>.stride, index: 1)
      encoder.setFragmentTexture(shadowTexture, index: 0)
      draw(encoder)
      encoder.endEncoding()
    }
    let id = textureId
    commands.addCompletedHandler { [weak self] _ in
      DispatchQueue.main.async { self?.textures.textureFrameAvailable(id) }
    }
    commands.commit()
  }

  private func uploadPending() {
    for (id, mesh) in pending {
      guard let vertices = device.makeBuffer(bytes: [UInt8](mesh.vertices), length: mesh.vertices.count),
            let indices = device.makeBuffer(bytes: [UInt8](mesh.indices), length: mesh.indices.count) else { continue }
      meshes[id] = GpuMesh(vertices: vertices, indices: indices, count: mesh.indices.count / 4)
    }
    pending.removeAll(keepingCapacity: true)
  }

  private func draw(_ encoder: MTLRenderCommandEncoder) {
    for mesh in meshes.values {
      encoder.setVertexBuffer(mesh.vertices, offset: 0, index: 0)
      encoder.drawIndexedPrimitives(type: .triangle, indexCount: mesh.count, indexType: .uint32, indexBuffer: mesh.indices, indexBufferOffset: 0)
    }
  }

  private func depthState() -> MTLDepthStencilState? {
    let descriptor = MTLDepthStencilDescriptor()
    descriptor.depthCompareFunction = .less
    descriptor.isDepthWriteEnabled = true
    return device.makeDepthStencilState(descriptor: descriptor)
  }

  private func makeUniforms(time: Float) -> Uniforms {
    let cp = cos(pitch), distance = zoom * 1.35
    let eye = SIMD3<Float>(target.x + cos(yaw)*cp*distance, target.y + sin(pitch)*distance, target.z + sin(yaw)*cp*distance)
    let view = lookAt(eye: eye, center: target, up: SIMD3(0,1,0))
    let aspect = Float(width) / Float(height)
    let projection = orthographic(left: -zoom*aspect/2, right: zoom*aspect/2, bottom: -zoom/2, top: zoom/2, near: 0.1, far: 300)
    let lightEye = target + SIMD3<Float>(-32,48,-30)
    let light = orthographic(left:-32,right:32,bottom:-32,top:32,near:0.1,far:120) * lookAt(eye: lightEye, center: target, up: SIMD3(0,1,0))
    let look = simd_normalize(target-eye)
    return Uniforms(
      mvp: projection * view,
      lightMvp: light,
      heroAndCut: SIMD4(hero.x,hero.y,hero.z,cutOn),
      lookAndTime: SIMD4(look.x,look.y,look.z,time),
      lightDirection: SIMD4(-0.42,0.82,-0.38,0)
    )
  }

  func dispose() {
    guard !disposed else { return }
    disposed = true
    displayLink?.invalidate(); displayLink = nil
    textures.unregisterTexture(textureId)
    meshes.removeAll(); pending.removeAll()
  }

  private static func makeTarget(device: MTLDevice, cache: CVMetalTextureCache, width: Int, height: Int) throws -> (CVPixelBuffer, CVMetalTexture) {
    var buffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
      kCVPixelBufferMetalCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:],
    ]
    guard CVPixelBufferCreate(nil,width,height,kCVPixelFormatType_32BGRA,attributes as CFDictionary,&buffer) == kCVReturnSuccess,
          let buffer else { throw RenderFailure("Metal pixel buffer could not be made") }
    var texture: CVMetalTexture?
    guard CVMetalTextureCacheCreateTextureFromImage(nil,cache,buffer,nil,.bgra8Unorm,width,height,0,&texture) == kCVReturnSuccess,
          let texture else { throw RenderFailure("Metal output texture could not be made") }
    return (buffer,texture)
  }

  private static func makeDepth(device: MTLDevice, width: Int, height: Int) throws -> MTLTexture {
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.depth32Float,width:width,height:height,mipmapped:false)
    descriptor.usage = [.renderTarget,.shaderRead]
    descriptor.storageMode = .private
    guard let texture = device.makeTexture(descriptor: descriptor) else { throw RenderFailure("Depth texture could not be made") }
    return texture
  }

  private static func vertexDescriptor() -> MTLVertexDescriptor {
    let descriptor = MTLVertexDescriptor()
    descriptor.attributes[0].format = .float3; descriptor.attributes[0].offset = 0; descriptor.attributes[0].bufferIndex = 0
    descriptor.attributes[1].format = .float3; descriptor.attributes[1].offset = 12; descriptor.attributes[1].bufferIndex = 0
    descriptor.attributes[2].format = .float3; descriptor.attributes[2].offset = 24; descriptor.attributes[2].bufferIndex = 0
    descriptor.attributes[3].format = .float; descriptor.attributes[3].offset = 36; descriptor.attributes[3].bufferIndex = 0
    descriptor.attributes[4].format = .float; descriptor.attributes[4].offset = 40; descriptor.attributes[4].bufferIndex = 0
    descriptor.attributes[5].format = .float3; descriptor.attributes[5].offset = 44; descriptor.attributes[5].bufferIndex = 0
    descriptor.layouts[0].stride = 56
    return descriptor
  }
}

private func lookAt(eye: SIMD3<Float>, center: SIMD3<Float>, up: SIMD3<Float>) -> simd_float4x4 {
  let f = simd_normalize(center-eye), s = simd_normalize(simd_cross(f,up)), u = simd_cross(s,f)
  return simd_float4x4(columns:(
    SIMD4(s.x,u.x,-f.x,0), SIMD4(s.y,u.y,-f.y,0), SIMD4(s.z,u.z,-f.z,0),
    SIMD4(-simd_dot(s,eye),-simd_dot(u,eye),simd_dot(f,eye),1)
  ))
}
private func orthographic(left:Float,right:Float,bottom:Float,top:Float,near:Float,far:Float) -> simd_float4x4 {
  simd_float4x4(columns:(
    SIMD4(2/(right-left),0,0,0), SIMD4(0,2/(top-bottom),0,0), SIMD4(0,0,1/(near-far),0),
    SIMD4(-(right+left)/(right-left),-(top+bottom)/(top-bottom),near/(near-far),1)
  ))
}

private let metalSource = """
#include <metal_stdlib>
using namespace metal;
struct VIn { float3 position [[attribute(0)]]; float3 normal [[attribute(1)]]; float3 color [[attribute(2)]]; float material [[attribute(3)]]; float joint [[attribute(4)]]; float3 pivot [[attribute(5)]]; };
struct Uniforms { float4x4 mvp; float4x4 lightMvp; float4 heroAndCut; float4 lookAndTime; float4 lightDirection; };
struct VOut { float4 position [[position]]; float3 world; float3 normal; float3 color; float4 shadow; float material; };
float3 animate(float3 p,float joint,float3 pivot,float time){if(joint<.5)return p;float side=(joint==1||joint==3||joint==7)?1:-1;float angle=sin(time*5)*.48*side;if(joint==6)angle=sin(time*.7)*.1;if(joint==7||joint==8)angle=sin(time*7)*.35*side;float3 q=p-pivot;float c=cos(angle),s=sin(angle);if(joint==7||joint==8)q.yz=float2(c*q.y-s*q.z,s*q.y+c*q.z);else q.xy=float2(c*q.x-s*q.y,s*q.x+c*q.y);return q+pivot;}
vertex VOut worldVertex(VIn in [[stage_in]],constant Uniforms& u [[buffer(1)]]){VOut o;o.world=animate(in.position,in.joint,in.pivot,u.lookAndTime.w);o.position=u.mvp*float4(o.world,1);o.normal=in.normal;o.color=in.color;o.material=in.material;o.shadow=u.lightMvp*float4(o.world,1);return o;}
vertex float4 shadowVertex(VIn in [[stage_in]],constant Uniforms& u [[buffer(1)]]){return u.lightMvp*float4(animate(in.position,in.joint,in.pivot,u.lookAndTime.w),1);}
float hash(float2 p){return fract(sin(dot(floor(p),float2(12.9898,78.233)))*43758.5453);}
fragment float4 worldFragment(VOut in [[stage_in]],constant Uniforms& u [[buffer(1)]],depth2d<float> shadowMap [[texture(0)]]){if(u.heroAndCut.w>.5&&in.material>.5&&in.material<1.5&&in.world.y>u.heroAndCut.y+1){float3 d=in.world-u.heroAndCut.xyz;float along=dot(d,u.lookAndTime.xyz);float across=length(d-along*u.lookAndTime.xyz);float front=clamp((-along-1.2)/4.0,0.0,1.0);if(front>0){float hole=5.5*front;float edge=smoothstep(hole-2.5,hole,across);if(edge<hash(in.position.xy))discard_fragment();}}float3 q=in.shadow.xyz/in.shadow.w*.5+.5;constexpr sampler ss(coord::normalized,address::clamp_to_edge,filter::linear,compare_func::less_equal);float shade=1;if(all(q>=0)&&all(q<=1)){shade=0;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)shade+=shadowMap.sample_compare(ss,q.xy+float2(x,y)/1024,q.z-.002);shade/=9;}float lit=.35+.65*max(0.0,dot(normalize(in.normal),normalize(u.lightDirection.xyz)))*mix(.45,1.0,shade);float3 c=in.color*lit;if(in.material>1.5)c*=.86+.14*sin(u.lookAndTime.w*1.6+in.world.x*.7+in.world.z*.6);return float4(c,1);}
"""
