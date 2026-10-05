import Flutter
import UIKit
import XCTest
import Metal
import simd
@testable import Runner

class RunnerTests: XCTestCase {

  func testStateEngineContextsIsolateGlobalsAndRecoverAfterAnException() throws {
    let source = """
    var AiWorldStateEngine = { create: function(session) {
      var count = 0;
      return { request: function(text) {
        if (text === 'throw') throw new Error('Ólafur 雪 🐺');
        return JSON.stringify({session: session, count: ++count, uuid: crypto.randomUUID()});
      }};
    }};
    """
    let first = try StateEngineVM(source: source, session: "first")
    let second = try StateEngineVM(source: source, session: "second")
    func count(_ engine: StateEngineVM) throws -> Int {
      let data = try XCTUnwrap(try engine.request("next").data(using: .utf8))
      let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
      XCTAssertNotNil(UUID(uuidString: try XCTUnwrap(value["uuid"] as? String)))
      return try XCTUnwrap(value["count"] as? Int)
    }
    XCTAssertEqual(try count(first), 1)
    XCTAssertEqual(try count(first), 2)
    XCTAssertEqual(try count(second), 1)
    XCTAssertThrowsError(try first.request("throw")) { error in
      XCTAssertTrue(String(describing: error).contains("Ólafur 雪 🐺"))
    }
    XCTAssertEqual(try count(first), 3)
    XCTAssertThrowsError(try StateEngineVM(source: "throw new Error('bad bundle')", session: "broken"))
  }

  private func depth(_ projection: simd_float4x4, at z: Float) -> Float {
    let clip = projection * SIMD4<Float>(0, 0, z, 1)
    return clip.z / clip.w
  }

  func testImportedOrthographicNearMidFarAndRecordedHero() {
    // OpenGL near=1, far=11, looking down -Z. This is the projection accepted by sceneFrame.
    let web = simd_float4x4(columns: (
      SIMD4<Float>(1,0,0,0), SIMD4<Float>(0,1,0,0),
      SIMD4<Float>(0,0,-0.2,0), SIMD4<Float>(0,0,-1.2,1)))
    let metal = importedMetalProjection(web)
    XCTAssertEqual(depth(web, at: -1), -1, accuracy: 0.00001)
    let samples: [(Float, Float)] = [(-1,0), (-6,0.5), (-11,1)]
    for (z, expected) in samples {
      XCTAssertEqual(depth(metal, at: z), expected, accuracy: 0.00001)
    }
    let hero = importedMetalProjection(matrix_identity_float4x4) * SIMD4<Float>(0,0,-0.79994,1)
    XCTAssertEqual(hero.z / hero.w, 0.10003, accuracy: 0.00001)
    // Matrix multiplication must preserve X, Y and W, including off-centre cameras.
    let point = SIMD4<Float>(0.23,-0.37,-6,1)
    let before = web * point, after = metal * point
    XCTAssertEqual(before.x, after.x)
    XCTAssertEqual(before.y, after.y)
    XCTAssertEqual(before.w, after.w)
  }

  func testImportedPerspectiveDividesAfterHomogeneousDepthConversion() {
    let web = simd_float4x4(columns: (
      SIMD4<Float>(1,0,0,0), SIMD4<Float>(0,1,0,0),
      SIMD4<Float>(0,0,-1.2,-1), SIMD4<Float>(0,0,-2.2,0)))
    let metal = importedMetalProjection(web)
    let samples: [(Float, Float)] = [(-1,0), (-2,0.55), (-11,1)]
    for (z, expected) in samples {
      XCTAssertEqual(depth(metal, at: z), expected, accuracy: 0.00001)
    }
    XCTAssertLessThan(depth(metal, at: -0.5), 0)
    XCTAssertGreaterThan(depth(metal, at: -12), 1)
  }

  func testNativeFallbackAndShadowProjectionsAlreadyUseMetalDepth() {
    let farPlanes: [Float] = [120, 300]
    for far in farPlanes {
      let native = orthographic(left: -32, right: 32, bottom: -32, top: 32, near: 0.1, far: far)
      let samples: [(Float, Float)] = [(-0.1,0), (-(far + 0.1)/2,0.5), (-far,1)]
      for (z, expected) in samples {
        XCTAssertEqual(depth(native, at: z), expected, accuracy: 0.00001)
      }
    }
  }

  func testProductionMetalShadowCoordinatesAndRuntimeCompilation() throws {
    // Compile the complete production library, then execute its actual shadow-coordinate function.
    let device = try XCTUnwrap(MTLCreateSystemDefaultDevice())
    let source = metalSource + """
    \n kernel void testShadowCoordinates(device float4* output [[buffer(0)]], uint i [[thread_position_in_grid]]) {
      const float4 clips[] = {float4(-2,2,0,2),float4(0,0,0.5,1),float4(2,-2,2,2),float4(0,0,-0.1,1),float4(0,0,1.1,1)};
      output[i] = float4(shadowCoordinates(clips[i]),1);
    }
    """
    let library = try device.makeLibrary(source: source, options: nil)
    let function = try XCTUnwrap(library.makeFunction(name: "testShadowCoordinates"))
    let pipeline = try device.makeComputePipelineState(function: function)
    let buffer = try XCTUnwrap(device.makeBuffer(length: MemoryLayout<SIMD4<Float>>.stride * 5, options: .storageModeShared))
    let queue = try XCTUnwrap(device.makeCommandQueue())
    let command = try XCTUnwrap(queue.makeCommandBuffer())
    let encoder = try XCTUnwrap(command.makeComputeCommandEncoder())
    encoder.setComputePipelineState(pipeline)
    encoder.setBuffer(buffer, offset: 0, index: 0)
    encoder.dispatchThreads(MTLSize(width: 5, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1))
    encoder.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    XCTAssertEqual(command.status, .completed, "\(String(describing: command.error))")
    let values = buffer.contents().bindMemory(to: SIMD4<Float>.self, capacity: 5)
    let expected: [SIMD3<Float>] = [SIMD3(0,0,0),SIMD3(0.5,0.5,0.5),SIMD3(1,1,1),SIMD3(0.5,0.5,-0.1),SIMD3(0.5,0.5,1.1)]
    for i in 0..<5 {
      XCTAssertEqual(values[i].x, expected[i].x, accuracy: 0.00001)
      XCTAssertEqual(values[i].y, expected[i].y, accuracy: 0.00001)
      XCTAssertEqual(values[i].z, expected[i].z, accuracy: 0.00001)
    }
  }

  func testExample() {
    // If you add code to the Runner application, consider adding tests here.
    // See https://developer.apple.com/documentation/xctest for more information about using XCTest.
  }

  func testCapturedRenderClockUsesMillisecondsOnceAndFallsBackWhenAbsent() {
    XCTAssertEqual(metalRenderTimeSeconds(renderTimeMs: 1250, fallbackSeconds: 999), 1.25)
    XCTAssertEqual(metalRenderTimeSeconds(renderTimeMs: 0, fallbackSeconds: 999), 0)
    XCTAssertEqual(metalRenderTimeSeconds(renderTimeMs: nil, fallbackSeconds: 123), 123)
    XCTAssertEqual(metalRenderTimeSeconds(renderTimeMs: .nan, fallbackSeconds: 123), 123)
  }

  func testProductionMetalWaterShoreRiverWaterfallAndOffFieldNumerically() throws {
    let device = try XCTUnwrap(MTLCreateSystemDefaultDevice())
    let source = metalSource + """
    \n kernel void testWater(device float4* output [[buffer(0)]], texture2d<float> coast [[texture(0)]], uint i [[thread_position_in_grid]]) {
      float3 world = i == 4 ? float3(-1,0,-1) : float3(0);
      float sea = (i == 2 || i == 3) ? 0.0 : 1.0;
      float flow = i == 3 ? 1.0 : 0.0;
      float4 area = i == 5 ? float4(0,0,0,32) : float4(0,0,0.1,64);
      WaterSurface water = waterSurface(world,float3(0,0,1),float3(0.2,0.3,0.4),flow,sea,0,i == 1 ? -1.0 : 1.0,area,coast);
      output[i*3] = float4(water.albedo,water.opacity);
      output[i*3+1] = float4(water.normal,water.shore);
      output[i*3+2] = float4(water.crest,water.foam,shoreAt(float2(-1,-1),float4(0,0,0.1,32),coast),1);
    }
    """
    let library = try device.makeLibrary(source: source, options: nil)
    XCTAssertNotNil(library.makeFunction(name: "worldFragment"))
    let function = try XCTUnwrap(library.makeFunction(name: "testWater"))
    let pipeline = try device.makeComputePipelineState(function: function)
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .r8Unorm, width: 1, height: 1, mipmapped: false)
    descriptor.usage = .shaderRead
    descriptor.storageMode = .shared
    let coast = try XCTUnwrap(device.makeTexture(descriptor: descriptor))
    var land: UInt8 = 0
    coast.replace(region: MTLRegionMake2D(0,0,1,1), mipmapLevel: 0, withBytes: &land, bytesPerRow: 1)
    let buffer = try XCTUnwrap(device.makeBuffer(length: MemoryLayout<SIMD4<Float>>.stride * 18, options: .storageModeShared))
    let queue = try XCTUnwrap(device.makeCommandQueue())
    let command = try XCTUnwrap(queue.makeCommandBuffer())
    let encoder = try XCTUnwrap(command.makeComputeCommandEncoder())
    encoder.setComputePipelineState(pipeline)
    encoder.setBuffer(buffer, offset: 0, index: 0)
    encoder.setTexture(coast, index: 0)
    encoder.dispatchThreads(MTLSize(width: 6, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: 1, height: 1, depth: 1))
    encoder.endEncoding()
    command.commit()
    command.waitUntilCompleted()
    XCTAssertEqual(command.status, .completed, "\(String(describing: command.error))")
    let values = buffer.contents().bindMemory(to: SIMD4<Float>.self, capacity: 18)
    func assertVector(_ actual: SIMD4<Float>, _ expected: SIMD4<Float>, file: StaticString = #filePath, line: UInt = #line) {
      for component in 0..<4 {
        XCTAssertEqual(actual[component], expected[component], accuracy: 0.0001, file: file, line: line)
      }
    }
    // The zero coast distance kills swell, giving known wash=1, foam=.7 and alpha=.838.
    assertVector(values[0], SIMD4(0.7082,0.7922,0.8272,0.838))
    assertVector(values[1], SIMD4(0,1,0,0))
    assertVector(values[2], SIMD4(0,0.7,32,1))
    assertVector(values[3], values[0])
    assertVector(values[4], SIMD4(0,-1,0,0))
    // River ignores shoreline foam. Its slope samples are the two exact standing-wave trains.
    let hx = sin(Float(0.77 * 1.1 * 1.9)) * 0.5 + sin(Float(-0.6 * 1.1 * 2.7)) * 0.3
    let hz = sin(Float(0.64 * 1.1 * 1.9)) * 0.5 + sin(Float(0.8 * 1.1 * 2.7)) * 0.3
    let riverNormal = simd_normalize(SIMD3<Float>(-hx * 0.045,1.1,-hz * 0.045))
    assertVector(values[6], SIMD4(0.172,0.282,0.44,0.88))
    assertVector(values[7], SIMD4(riverNormal,64))
    assertVector(values[8], SIMD4(0,0,32,1))
    // At world/time zero the waterfall streak is zero: white=.35, alpha=.9 and geometry normal.
    assertVector(values[9], SIMD4(0.4443,0.5263,0.636,0.9))
    assertVector(values[10], SIMD4(0,0,1,64))
    // Off-field sampling must not clamp to the zero-distance edge and paint open sea white.
    assertVector(values[12], SIMD4(0.172,0.282,0.44,0.88))
    XCTAssertEqual(values[13].w,64)
    XCTAssertEqual(values[14].y,0,accuracy: 0.0001)
    let openNormal = SIMD3(values[13].x,values[13].y,values[13].z)
    XCTAssertEqual(simd_length(openNormal),1,accuracy: 0.0001)
    XCTAssertGreaterThan(abs(openNormal.x) + abs(openNormal.z),0.0001)
    // Missing coast data preserves its supplied range and finite depth-dependent opacity.
    XCTAssertEqual(values[16].w,32)
    XCTAssertEqual(values[15].w,0.88,accuracy: 0.0001)
  }

}
