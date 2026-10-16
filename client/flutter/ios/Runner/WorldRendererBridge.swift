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
        renderer.putMesh(id: meshId, vertices: vertexData.data, indices: indexData.data,
          castShadow: arguments["castShadow"] as? Bool ?? true,
          receiveShadow: arguments["receiveShadow"] as? Bool ?? true,
          opacity: arguments.float("opacity"), blend: arguments.string("blend"),
          emissive: linear(arguments["emissive"]) ?? .zero,
          depthWrite: arguments["depthWrite"] as? Bool ?? true,
          depthTest: arguments["depthTest"] as? Bool ?? true,
          doubleSided: arguments["doubleSided"] as? Bool ?? false,
          backSide: arguments["backSide"] as? Bool ?? false,
          renderOrder: (arguments["renderOrder"] as? NSNumber)?.intValue ?? 0,
          transparent: arguments["transparent"] as? Bool ?? false)
      case "removeMesh": renderer.removeMesh(id: arguments.string("meshId"))
      case "camera": renderer.setCamera(
        x: arguments.float("targetX"), y: arguments.float("targetY"), z: arguments.float("targetZ"),
        yaw: arguments.float("yaw"), pitch: arguments.float("pitch"), zoom: arguments.float("zoom")
      )
      case "sceneFrame":
        guard let projection = arguments["projection"] as? FlutterStandardTypedData,
              let world = arguments["world"] as? FlutterStandardTypedData else {
          throw RenderFailure("scene camera matrices missing")
        }
        renderer.setSceneFrame(projection: projection.data, world: world.data,
          background: Int(arguments.number("background")), lights: arguments["lights"] as? [[String: Any]] ?? [],
          coast: arguments["coast"] as? [String: Any], fog: arguments["fog"] as? [String: Any],
          renderTimeMs: (arguments["renderTimeMs"] as? NSNumber)?.doubleValue)
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

/// Three linear channels as Dart sends them; see client/flutter/lib/src/colour.dart.
private func linear(_ value: Any?) -> SIMD3<Float>? {
  guard let rgb = value as? [NSNumber], rgb.count == 3 else { return nil }
  return SIMD3(rgb[0].floatValue, rgb[1].floatValue, rgb[2].floatValue)
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
  var renderFlags: SIMD4<Float>
  var ambient: SIMD4<Float>
  var sky: SIMD4<Float>
  var ground: SIMD4<Float>
  var pointPosition: SIMD4<Float>
  var pointColour: SIMD4<Float>
  var coastArea: SIMD4<Float>
  var fogColour: SIMD4<Float>
  var fogRange: SIMD4<Float>
  var cameraPosition: SIMD4<Float>
  var emissive: SIMD4<Float>
}

private struct MeshStyle {
  let castShadow: Bool; let receiveShadow: Bool; let opacity: Float; let emissive: SIMD3<Float>
  let blend: String; let depthWrite: Bool; let depthTest: Bool; let doubleSided: Bool; let backSide: Bool
  let renderOrder: Int; let transparent: Bool
}
private struct CpuMesh { let vertices: Data; let indices: Data; let style: MeshStyle }
private struct GpuMesh { let vertices: MTLBuffer; let indices: MTLBuffer; let count: Int; let style: MeshStyle; let center: SIMD3<Float> }

private final class MetalWorldRenderer: NSObject, FlutterTexture {
  private let textures: FlutterTextureRegistry
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipeline: MTLRenderPipelineState
  private let alphaPipeline: MTLRenderPipelineState
  private let additivePipeline: MTLRenderPipelineState
  private let shadowPipeline: MTLRenderPipelineState
  private let textureCache: CVMetalTextureCache
  private var pixelBuffer: CVPixelBuffer
  private var colorTexture: CVMetalTexture
  private var depthTexture: MTLTexture
  private var shadowTexture: MTLTexture
  private var coastTexture: MTLTexture
  private var coastArea = SIMD4<Float>(0, 0, 0, 64)
  private var sceneRenderTimeMs: Double?
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
  private var sceneProjection: simd_float4x4?
  private var sceneWorld: simd_float4x4?
  private var background = 0x080b18
  /// Where the shadow map looks from: the shadow-casting directional light, pointing at the scene.
  private var lightDirection = simd_normalize(SIMD3<Float>(-0.42, 0.82, -0.38))
  private var ambientLight = SIMD3<Float>(repeating: 0.35)
  private var skyLight = SIMD3<Float>(repeating: 0)
  private var groundLight = SIMD3<Float>(repeating: 0)
  /// Up to `directionalLights`: each one's direction, and its colour with 1 in the fourth channel
  /// for the one the shadow map is for.
  private var sunDirections: [SIMD4<Float>] = {
    var directions = [SIMD4<Float>](repeating: .zero, count: directionalLights)
    directions[0] = SIMD4(simd_normalize(SIMD3<Float>(-0.42, 0.82, -0.38)), 0)
    return directions
  }()
  private var sunColours: [SIMD4<Float>] = {
    var colours = [SIMD4<Float>](repeating: .zero, count: directionalLights)
    colours[0] = SIMD4(0.65, 0.65, 0.65, 1)
    return colours
  }()
  private var pointPositions = [SIMD4<Float>](repeating: .zero, count: 16)
  private var pointColours = [SIMD4<Float>](repeating: .zero, count: 16)
  private var fogColour = SIMD3<Float>(repeating: 0)
  private var fogNear: Float = 0
  private var fogFar: Float = 0
  private var sunCastsShadow = true
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
    let coastDescriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm,
      width: 1, height: 1, mipmapped: false)
    coastDescriptor.usage = [.shaderRead]
    coastDescriptor.storageMode = .shared
    guard let emptyCoast = device.makeTexture(descriptor: coastDescriptor) else {
      throw RenderFailure("Coast texture could not be made")
    }
    var openSea: UInt8 = 255
    emptyCoast.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0,
      withBytes: &openSea, bytesPerRow: 1)
    coastTexture = emptyCoast

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
    descriptor.colorAttachments[0].isBlendingEnabled = true
    descriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
    descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
    descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
    descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
    alphaPipeline = try device.makeRenderPipelineState(descriptor: descriptor)
    descriptor.colorAttachments[0].destinationRGBBlendFactor = .one
    additivePipeline = try device.makeRenderPipelineState(descriptor: descriptor)
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

  func putMesh(id: String, vertices: Data, indices: Data,
               castShadow: Bool, receiveShadow: Bool, opacity: Float, blend: String, emissive: SIMD3<Float>,
               depthWrite: Bool, depthTest: Bool, doubleSided: Bool, backSide: Bool,
               renderOrder: Int, transparent: Bool) {
    pending[id] = CpuMesh(vertices: vertices, indices: indices,
      style: MeshStyle(castShadow: castShadow, receiveShadow: receiveShadow,
        opacity: opacity, emissive: emissive, blend: blend, depthWrite: depthWrite, depthTest: depthTest,
        doubleSided: doubleSided, backSide: backSide, renderOrder: renderOrder, transparent: transparent))
  }
  func removeMesh(id: String) { pending.removeValue(forKey: id); meshes.removeValue(forKey: id) }
  func setCamera(x: Float, y: Float, z: Float, yaw: Float, pitch: Float, zoom: Float) {
    sceneProjection = nil; sceneWorld = nil; sceneRenderTimeMs = nil
    target = SIMD3(x,y,z); self.yaw = yaw; self.pitch = pitch; self.zoom = max(4,min(80,zoom))
  }
  func setSceneFrame(projection: Data, world: Data, background: Int,
                     lights: [[String: Any]], coast: [String: Any]?, fog: [String: Any]?, renderTimeMs: Double?) {
    guard let projection = Self.matrix(projection), let world = Self.matrix(world) else { return }
    sceneProjection = importedMetalProjection(projection); sceneWorld = world; self.background = background
    sceneRenderTimeMs = renderTimeMs
    target = SIMD3(world.columns.3.x, world.columns.3.y, world.columns.3.z) -
      SIMD3(world.columns.2.x, world.columns.2.y, world.columns.2.z) * 30
    // Dart has already decoded each light to linear and applied its intensity (colour.dart)
    func colour(_ node: [String: Any]?, key: String = "linear") -> SIMD3<Float> {
      linear(node?[key]) ?? .zero
    }
    func visible(_ kind: String) -> [[String: Any]] {
      lights.filter { $0["kind"] as? String == kind && $0["visible"] as? Bool != false }
    }
    // three.js adds up every light of a kind (#512). Ambient light is one sum in three.js too, and a
    // hemisphere light always points straight up in this game, three.js's default, so the sum of
    // their skies and of their grounds is exact and needs no cap. Neither takes a shadow.
    func total(_ kind: String, key: String = "linear") -> SIMD3<Float> {
      visible(kind).reduce(SIMD3<Float>.zero) { $0 + colour($1, key: key) }
    }
    ambientLight = total("ambient")
    skyLight = total("hemisphere")
    groundLight = total("hemisphere", key: "linearGround")
    // Directional lights each have a direction, so the shader adds them up itself, up to the cap.
    // There is one shadow map, and it belongs to the first of them that casts a shadow.
    let suns = Array(visible("directional").prefix(directionalLights))
    let shadowed = suns.firstIndex(where: { $0["castShadow"] as? Bool == true })
    sunDirections = [SIMD4<Float>](repeating: .zero, count: directionalLights)
    sunColours = [SIMD4<Float>](repeating: .zero, count: directionalLights)
    sunCastsShadow = false
    for (index, sun) in suns.enumerated() {
      guard let matrix = sun["world"] as? [NSNumber], matrix.count == 16,
            let point = sun["target"] as? [NSNumber], point.count == 3 else { continue }
      let toward = SIMD3<Float>(matrix[12].floatValue - point[0].floatValue,
        matrix[13].floatValue - point[1].floatValue, matrix[14].floatValue - point[2].floatValue)
      guard simd_length(toward) > 0 else { continue }
      let direction = simd_normalize(toward)
      let tint = colour(sun)
      sunDirections[index] = SIMD4(direction, 0)
      sunColours[index] = SIMD4(tint, index == shadowed ? 1 : 0)
      if index == shadowed {
        sunCastsShadow = true
        lightDirection = direction
      }
    }
    pointPositions = [SIMD4<Float>](repeating: .zero, count: 16)
    pointColours = [SIMD4<Float>](repeating: .zero, count: 16)
    for (index, point) in visible("point").prefix(16).enumerated() {
      guard let matrix = point["world"] as? [NSNumber], matrix.count == 16 else { continue }
      let tint = colour(point)
      pointPositions[index] = SIMD4(matrix[12].floatValue, matrix[13].floatValue,
        matrix[14].floatValue, (point["distance"] as? NSNumber)?.floatValue ?? 0)
      pointColours[index] = SIMD4(tint.x, tint.y, tint.z, (point["decay"] as? NSNumber)?.floatValue ?? 2)
    }
    if let fog {
      // sRGB as it stands: three.js mixes fog in after encoding, toward the hex itself
      let rgb = (fog["colour"] as? NSNumber)?.intValue ?? 0
      fogColour = SIMD3(Float((rgb >> 16) & 255), Float((rgb >> 8) & 255), Float(rgb & 255)) / 255
      fogNear = (fog["near"] as? NSNumber)?.floatValue ?? 0
      fogFar = (fog["far"] as? NSNumber)?.floatValue ?? 0
    } else { fogNear = 0; fogFar = 0 }
    if let bytes = (coast?["values"] as? FlutterStandardTypedData)?.data,
       let size = (coast?["size"] as? NSNumber)?.intValue,
       size > 0, bytes.count == size * size,
       let span = (coast?["span"] as? NSNumber)?.floatValue, span > 0 {
      var ready = coastTexture.width == size
      if !ready {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm,
          width: size, height: size, mipmapped: false)
        descriptor.usage = [.shaderRead]; descriptor.storageMode = .shared
        if let texture = device.makeTexture(descriptor: descriptor) {
          coastTexture = texture
          ready = true
        }
      }
      if ready {
        bytes.withUnsafeBytes { raw in
          if let base = raw.baseAddress {
            coastTexture.replace(region: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0,
              withBytes: base, bytesPerRow: size)
          }
        }
      }
      coastArea = ready ? SIMD4((coast?["x0"] as? NSNumber)?.floatValue ?? 0,
        (coast?["z0"] as? NSNumber)?.floatValue ?? 0, 1 / span,
        (coast?["range"] as? NSNumber)?.floatValue ?? 64) : SIMD4(0, 0, 0, 64)
    } else { coastArea = SIMD4(0, 0, 0, 64) }
  }
  private static func matrix(_ data: Data) -> simd_float4x4? {
    guard data.count == 64 else { return nil }
    var values = [Float](repeating: 0, count: 16)
    _ = values.withUnsafeMutableBytes { data.copyBytes(to: $0) }
    return simd_float4x4(columns: (
      SIMD4(values[0], values[1], values[2], values[3]),
      SIMD4(values[4], values[5], values[6], values[7]),
      SIMD4(values[8], values[9], values[10], values[11]),
      SIMD4(values[12], values[13], values[14], values[15])
    ))
  }
  func setCutaway(enabled: Bool, x: Float, y: Float, z: Float) { cutOn = enabled ? 1 : 0; hero = SIMD3(x,y,z) }

  @objc private func frame() {
    guard !disposed, let drawable = CVMetalTextureGetTexture(colorTexture), let commands = queue.makeCommandBuffer() else { return }
    uploadPending()
    let uniforms = makeUniforms(time: metalRenderTimeSeconds(renderTimeMs: sceneRenderTimeMs,
      fallbackSeconds: CACurrentMediaTime()))

    let shadowPass = MTLRenderPassDescriptor()
    shadowPass.depthAttachment.texture = shadowTexture
    shadowPass.depthAttachment.loadAction = .clear
    shadowPass.depthAttachment.storeAction = .store
    shadowPass.depthAttachment.clearDepth = 1
    if sunCastsShadow, let encoder = commands.makeRenderCommandEncoder(descriptor: shadowPass) {
      encoder.setRenderPipelineState(shadowPipeline)
      encoder.setDepthStencilState(depthState())
      encoder.setVertexBytes([uniforms], length: MemoryLayout<Uniforms>.stride, index: 1)
      draw(encoder, uniforms: uniforms, shadow: true)
      encoder.endEncoding()
    }

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    // the hex as it stands, as three.js clears a default framebuffer in its output colour space
    pass.colorAttachments[0].clearColor = MTLClearColor(red: Double((background >> 16) & 255) / 255,
      green: Double((background >> 8) & 255) / 255, blue: Double(background & 255) / 255, alpha: 1)
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
      encoder.setFragmentBytes(pointPositions, length: MemoryLayout<SIMD4<Float>>.stride * pointPositions.count, index: 2)
      encoder.setFragmentBytes(pointColours, length: MemoryLayout<SIMD4<Float>>.stride * pointColours.count, index: 3)
      encoder.setFragmentBytes(sunDirections, length: MemoryLayout<SIMD4<Float>>.stride * sunDirections.count, index: 4)
      encoder.setFragmentBytes(sunColours, length: MemoryLayout<SIMD4<Float>>.stride * sunColours.count, index: 5)
      encoder.setFragmentTexture(shadowTexture, index: 0)
      encoder.setFragmentTexture(coastTexture, index: 1)
      draw(encoder, uniforms: uniforms, shadow: false)
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
      var center = SIMD3<Float>(repeating: 0)
      let count = mesh.vertices.count / (16 * MemoryLayout<Float>.size)
      var values = [Float](repeating: 0, count: count * 16)
      _ = values.withUnsafeMutableBytes { mesh.vertices.copyBytes(to: $0) }
      for vertex in 0..<count {
        center += SIMD3(values[vertex * 16], values[vertex * 16 + 1], values[vertex * 16 + 2])
      }
      if count > 0 { center /= Float(count) }
      meshes[id] = GpuMesh(vertices: vertices, indices: indices, count: mesh.indices.count / 4, style: mesh.style, center: center)
    }
    pending.removeAll(keepingCapacity: true)
  }

  private func draw(_ encoder: MTLRenderCommandEncoder, uniforms: Uniforms, shadow: Bool) {
    // Both passes consume the same counterclockwise mesh indices. Depth conversion leaves XY intact.
    encoder.setFrontFacing(.counterClockwise)
    let camera = sceneWorld.map { SIMD3($0.columns.3.x, $0.columns.3.y, $0.columns.3.z) } ?? target
    let ordered = meshes.values.sorted { left, right in
      if left.style.renderOrder != right.style.renderOrder { return left.style.renderOrder < right.style.renderOrder }
      if left.style.transparent != right.style.transparent { return !left.style.transparent }
      let lhs = simd_length_squared(left.center - camera)
      let rhs = simd_length_squared(right.center - camera)
      return left.style.transparent ? lhs > rhs : lhs < rhs
    }
    for mesh in ordered {
      if shadow && !mesh.style.castShadow { continue }
      encoder.setCullMode(mesh.style.doubleSided ? .none : mesh.style.backSide ? .front : .back)
      if !shadow {
        encoder.setRenderPipelineState(mesh.style.blend == "additive" ? additivePipeline :
          mesh.style.blend == "alpha" ? alphaPipeline : pipeline)
        encoder.setDepthStencilState(depthState(write: mesh.style.depthWrite, test: mesh.style.depthTest))
        var painted = uniforms
        painted.renderFlags = SIMD4(mesh.style.opacity, mesh.style.receiveShadow && sunCastsShadow ? 1 : 0, 0, 0)
        painted.emissive = SIMD4(mesh.style.emissive, 0)
        encoder.setFragmentBytes([painted], length: MemoryLayout<Uniforms>.stride, index: 1)
      }
      encoder.setVertexBuffer(mesh.vertices, offset: 0, index: 0)
      encoder.drawIndexedPrimitives(type: .triangle, indexCount: mesh.count, indexType: .uint32, indexBuffer: mesh.indices, indexBufferOffset: 0)
    }
  }

  private func depthState(write: Bool = true, test: Bool = true) -> MTLDepthStencilState? {
    let descriptor = MTLDepthStencilDescriptor()
    descriptor.depthCompareFunction = test ? .less : .always
    descriptor.isDepthWriteEnabled = write
    return device.makeDepthStencilState(descriptor: descriptor)
  }

  private func makeUniforms(time: Float) -> Uniforms {
    let cp = cos(pitch), distance = zoom * 1.35
    let eye = SIMD3<Float>(target.x + cos(yaw)*cp*distance, target.y + sin(pitch)*distance, target.z + sin(yaw)*cp*distance)
    let view = lookAt(eye: eye, center: target, up: SIMD3(0,1,0))
    let aspect = Float(width) / Float(height)
    let projection = orthographic(left: -zoom*aspect/2, right: zoom*aspect/2, bottom: -zoom/2, top: zoom/2, near: 0.1, far: 300)
    let lightEye = target + lightDirection * 64
    let light = orthographic(left:-32,right:32,bottom:-32,top:32,near:0.1,far:120) * lookAt(eye: lightEye, center: target, up: SIMD3(0,1,0))
    let look = sceneWorld.map { simd_normalize(-SIMD3($0.columns.2.x, $0.columns.2.y, $0.columns.2.z)) }
      ?? simd_normalize(target-eye)
    return Uniforms(
      mvp: sceneProjection.map { $0 * (sceneWorld?.inverse ?? matrix_identity_float4x4) } ?? projection * view,
      lightMvp: light,
      heroAndCut: SIMD4(hero.x,hero.y,hero.z,cutOn),
      lookAndTime: SIMD4(look.x,look.y,look.z,time),
      renderFlags: SIMD4(1,1,0,0),
      ambient: SIMD4(ambientLight.x,ambientLight.y,ambientLight.z,0),
      sky: SIMD4(skyLight.x,skyLight.y,skyLight.z,0),
      ground: SIMD4(groundLight.x,groundLight.y,groundLight.z,0),
      pointPosition: .zero,
      pointColour: .zero,
      coastArea: coastArea,
      fogColour: SIMD4(fogColour.x,fogColour.y,fogColour.z,0),
      fogRange: SIMD4(fogNear,fogFar,0,0),
      cameraPosition: sceneWorld?.columns.3 ?? SIMD4(0,0,0,1),
      emissive: SIMD4(repeating: 0)
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
    descriptor.attributes[6].format = .float; descriptor.attributes[6].offset = 56; descriptor.attributes[6].bufferIndex = 0
    descriptor.attributes[7].format = .float; descriptor.attributes[7].offset = 60; descriptor.attributes[7].bufferIndex = 0
    descriptor.layouts[0].stride = 64
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
/// Imported web cameras have OpenGL clip depth -w...w; Metal clips at 0...w.
/// Apply once when accepting a frame, never to native fallback or light projections.
func importedMetalProjection(_ projection: simd_float4x4) -> simd_float4x4 {
  let depth = simd_float4x4(columns: (
    SIMD4<Float>(1,0,0,0), SIMD4<Float>(0,1,0,0),
    SIMD4<Float>(0,0,0.5,0), SIMD4<Float>(0,0,0.5,1)
  ))
  return depth * projection
}

func metalRenderTimeSeconds(renderTimeMs: Double?, fallbackSeconds: Double) -> Float {
  if let milliseconds = renderTimeMs, milliseconds.isFinite { return Float(milliseconds / 1000) }
  return Float(fallbackSeconds)
}

func orthographic(left:Float,right:Float,bottom:Float,top:Float,near:Float,far:Float) -> simd_float4x4 {
  simd_float4x4(columns:(
    SIMD4(2/(right-left),0,0,0), SIMD4(0,2/(top-bottom),0,0), SIMD4(0,0,1/(near-far),0),
    SIMD4(-(right+left)/(right-left),-(top+bottom)/(top-bottom),near/(near-far),1)
  ))
}

/// How many directional lights the shader adds up; `worldFragment`'s loop and buffers 4 and 5 are
/// this long.
private let directionalLights = 4

let metalSource = """
#include <metal_stdlib>
using namespace metal;
struct VIn { float3 position [[attribute(0)]]; float3 normal [[attribute(1)]]; float3 color [[attribute(2)]]; float material [[attribute(3)]]; float joint [[attribute(4)]]; float3 pivot [[attribute(5)]]; float flow [[attribute(6)]]; float sea [[attribute(7)]]; };
struct Uniforms { float4x4 mvp; float4x4 lightMvp; float4 heroAndCut; float4 lookAndTime; float4 renderFlags; float4 ambient; float4 sky; float4 ground; float4 pointPosition; float4 pointColour; float4 coastArea; float4 fogColour; float4 fogRange; float4 cameraPosition; float4 emissive; };
struct VOut { float4 position [[position]]; float3 world; float3 normal; float3 color; float4 shadow; float material; float flow; float sea; };
float3 animate(float3 p,float joint,float3 pivot,float time){if(joint<.5)return p;float side=(joint==1||joint==3||joint==7)?1:-1;float angle=sin(time*5)*.48*side;if(joint==6)angle=sin(time*.7)*.1;if(joint==7||joint==8)angle=sin(time*7)*.35*side;float3 q=p-pivot;float c=cos(angle),s=sin(angle);if(joint==7||joint==8)q.yz=float2(c*q.y-s*q.z,s*q.y+c*q.z);else q.xy=float2(c*q.x-s*q.y,s*q.x+c*q.y);return q+pivot;}
vertex VOut worldVertex(VIn in [[stage_in]],constant Uniforms& u [[buffer(1)]]){VOut o;o.world=animate(in.position,in.joint,in.pivot,u.lookAndTime.w);o.position=u.mvp*float4(o.world,1);o.normal=in.normal;o.color=in.color;o.material=in.material;o.flow=in.flow;o.sea=in.sea;o.shadow=u.lightMvp*float4(o.world,1);return o;}
vertex float4 shadowVertex(VIn in [[stage_in]],constant Uniforms& u [[buffer(1)]]){return u.lightMvp*float4(animate(in.position,in.joint,in.pivot,u.lookAndTime.w),1);}
constant float RECIPROCAL_PI=0.3183098861837907;
// three.js's sRGBTransferOETF: lit in linear, written out encoded to the plain bgra8Unorm target
float3 encodeSrgb(float3 c){return select(pow(c,float3(0.41666))*1.055-0.055,c*12.92,c<=0.0031308);}
// three.js r185's getDistanceAttenuation (lights_pars_begin): d^-decay, windowed to nothing at the
// cutoff when there is one
float attenuation(float d,float cutoff,float decay){float f=1.0/max(pow(d,decay),0.01);if(cutoff>0){float x=d/cutoff;x*=x;x*=x;float w=saturate(1.0-x);f*=w*w;}return f;}
float hash(float2 p){return fract(sin(dot(floor(p),float2(12.9898,78.233)))*43758.5453);}
// Light depth is already Metal depth; viewport/texture Y starts at the top.
float3 shadowCoordinates(float4 clip){float3 ndc=clip.xyz/clip.w;return float3(ndc.x*.5+.5,.5-ndc.y*.5,ndc.z);}
constant float PI2 = 6.283185307179586;
float shoreAt(float2 w, float4 coastArea, texture2d<float> coastMap) {
  if (coastArea.z <= 0.0) return coastArea.w;
  float2 uv = (w - coastArea.xy) * coastArea.z;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  constexpr sampler cs(coord::normalized,address::clamp_to_edge,filter::linear);
  float d = coastMap.sample(cs, clamp(uv, 0.0, 1.0), level(0)).r * coastArea.w;
  return mix(coastArea.w, d, inside);
}
float rippleAt(float2 w, float t) {
  return sin(dot(w, float2(0.77, 0.64)) * 1.9 + t * 1.3) * 0.5
    + sin(dot(w, float2(-0.6, 0.8)) * 2.7 - t * 0.9) * 0.3;
}
float waveAt(float2 w, float d, float t, float range) {
  float shoreward = sqrt(max(d, 0.0)) * 2.200;
  float refract = 1.0 - smoothstep(range * 0.4, range * 0.95, d);
  float p1 = mix(dot(w, float2(0.80, 0.60)) / 23.0, shoreward, refract);
  float p2 = mix(dot(w, float2(-0.55, 0.84)) / 16.0, shoreward * 0.61, refract);
  float wob = sin(w.x * 0.021 + t * 0.11) + sin(w.y * 0.017 - t * 0.09);
  float a = sin((p1 + t * 0.30) * PI2 + wob * 0.9);
  float b = sin((p2 + t * 0.19) * PI2 + wob * 1.5 + 2.1);
  float swell = a * 0.62 + b * 0.38;
  float shoal = smoothstep(0.0, 2.6, d) * mix(2.4, 1.0, smoothstep(0.0, 34.0, d));
  return swell * shoal;
}
struct WaterSurface { float3 albedo; float3 normal; float opacity; float shore; float crest; float foam; };
WaterSurface waterSurface(float3 world, float3 geometryNormal, float3 albedo, float flow, float sea,
    float t, float faceDirection, float4 coastArea, texture2d<float> coastMap) {
  float2 alongX = float2(1.10, 0.0);
  float2 alongZ = float2(0.0, 1.10);
  float gShore = mix(coastArea.w, shoreAt(world.xz, coastArea, coastMap), sea);
  float h0 = mix(rippleAt(world.xz, t), waveAt(world.xz, gShore, t, coastArea.w), sea);
  float hx = mix(rippleAt(world.xz + alongX, t),
    waveAt(world.xz + alongX, shoreAt(world.xz + alongX, coastArea, coastMap), t, coastArea.w), sea);
  float hz = mix(rippleAt(world.xz + alongZ, t),
    waveAt(world.xz + alongZ, shoreAt(world.xz + alongZ, coastArea, coastMap), t, coastArea.w), sea);
  float3 gWave = normalize(float3((h0 - hx) * 0.045, 1.10, (h0 - hz) * 0.045));
  float deep = smoothstep(1.5, coastArea.w * 0.45, gShore);
  albedo *= mix(float3(0.72, 1.18, 1.06), float3(0.86, 0.94, 1.10), deep);
  float opacity = mix(0.60, 0.88, deep);
  float breaker = smoothstep(1.6, 2.3, h0) * smoothstep(14.0, 2.0, gShore);
  float wash = 1.0 - smoothstep(0.0, 1.1 + h0 * 0.55, gShore);
  float glint = smoothstep(1.0, 1.7, h0) * 0.09;
  float foam = clamp(breaker * 0.45 + wash * 0.7 + glint, 0.0, 1.0) * sea;
  float fall = fract(world.y * 1.6 - t * 1.8 + sin((world.x + world.z) * 2.0) * 0.2);
  float streak = smoothstep(0.55, 0.7, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
  float white = mix(foam, 0.35 + streak * 0.6, flow);
  albedo=mix(albedo,float3(.95,.98,1.0),white);
  opacity = mix(mix(opacity, 0.94, foam), 0.9, flow);
  WaterSurface result;
  result.albedo = albedo; result.opacity = opacity; result.shore = gShore; result.crest = h0; result.foam = foam;
  result.normal = normalize(mix(gWave, normalize(geometryNormal), flow)) * faceDirection;
  return result;
}
fragment float4 worldFragment(VOut in [[stage_in]],bool frontFacing [[front_facing]],constant Uniforms& u [[buffer(1)]],constant float4* pointPositions [[buffer(2)]],constant float4* pointColours [[buffer(3)]],constant float4* sunDirections [[buffer(4)]],constant float4* sunColours [[buffer(5)]],depth2d<float> shadowMap [[texture(0)]],texture2d<float> coastMap [[texture(1)]]){if(u.heroAndCut.w>.5&&in.material>.5&&in.material<1.5&&in.world.y>u.heroAndCut.y+1){float3 d=in.world-u.heroAndCut.xyz;float along=dot(d,u.lookAndTime.xyz);float across=length(d-along*u.lookAndTime.xyz);float front=clamp((-along-1.2)/4.0,0.0,1.0);if(front>0){float hole=5.5*front;float edge=smoothstep(hole-2.5,hole,across);if(edge<hash(in.position.xy))discard_fragment();}}
float3 n=normalize(in.normal);float3 albedo=in.color;float opacity=u.renderFlags.x;
// foam whitens the water's own colour before any light reaches it, as the web's water does at color_fragment (src/render/water.ts)
if(in.material>1.5&&in.material<2.5){WaterSurface water=waterSurface(in.world,in.normal,albedo,in.flow,in.sea,u.lookAndTime.w,frontFacing?1.0:-1.0,u.coastArea,coastMap);albedo=water.albedo;n=water.normal;opacity=water.opacity;}
// three.js r185's lights_fragment_begin: ambient and hemisphere are the indirect term and take no shadow
float3 lit=u.ambient.xyz+mix(u.ground.xyz,u.sky.xyz,n.y*.5+.5);
// every directional light; the shadow-casting one is multiplied by its shadow, getShadow at shadowIntensity 1
float3 q=shadowCoordinates(in.shadow);constexpr sampler ss(coord::normalized,address::clamp_to_edge,filter::linear,compare_func::less_equal);float shade=1;if(u.renderFlags.y>.5&&all(q>=0)&&all(q<=1)){shade=0;for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)shade+=shadowMap.sample_compare(ss,q.xy+float2(x,y)/1024,q.z-.002);shade/=9;}
for(int i=0;i<4;i++){float4 d=sunDirections[i];float4 s=sunColours[i];if(all(s.xyz==0.0))continue;lit+=s.xyz*max(0.0,dot(n,d.xyz))*(s.w>.5?shade:1.0);}
for(int i=0;i<16;i++){float4 p=pointPositions[i];float4 q=pointColours[i];if(all(q.xyz==0.0))continue;float3 toPoint=p.xyz-in.world;lit+=q.xyz*max(0.0,dot(n,normalize(toPoint)))*attenuation(length(toPoint),p.w,q.w);}
float3 c=albedo*(in.material>2.5?float3(1):lit*RECIPROCAL_PI)+u.emissive.xyz;
c=encodeSrgb(c);if(u.fogRange.y>u.fogRange.x)c=mix(c,u.fogColour.xyz,smoothstep(u.fogRange.x,u.fogRange.y,dot(in.world-u.cameraPosition.xyz,u.lookAndTime.xyz)));return float4(c,opacity);}
"""
