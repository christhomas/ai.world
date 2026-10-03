import Flutter
import UIKit
import XCTest
import Metal
import simd
@testable import Runner

class RunnerTests: XCTestCase {

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

}
