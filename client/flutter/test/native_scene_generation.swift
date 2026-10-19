import Foundation

@main struct SceneGenerationTests {
  static func rejected(_ body: () throws -> Void) {
    do { try body(); fatalError("Expected a scene resync rejection") }
    catch is SceneResyncRequired {} catch { fatalError("Unexpected failure: \(error)") }
  }

  static func validate(_ guardState: inout SceneGeneration, _ generation: Int64, full: Bool = false,
                       current: Set<String> = ["a"], updates: Set<String> = [],
                       removed: [String] = [], expected: [String] = ["a"]) throws {
    try guardState.validate(generation: generation, full: full, current: current, updates: updates,
                            removed: removed, expected: expected)
  }

  static func main() throws {
    var guardState = SceneGeneration()
    rejected { try validate(&guardState, 1) }
    try validate(&guardState, 2, full: true, updates: ["a"])
    guardState.commit(2)
    try validate(&guardState, 3, updates: ["b"], expected: ["a", "b"])
    guardState.commit(3)
    try validate(&guardState, 4, current: ["a", "b"], removed: ["a"], expected: ["b"])
    guardState.commit(4)
    guardState.invalidate()
    rejected { try validate(&guardState, 5) }
    try validate(&guardState, 6, full: true, updates: ["a"])
    guardState.commit(6)
    rejected { try validate(&guardState, 5, full: true, updates: ["a"]) }

    let bad: [(inout SceneGeneration) throws -> Void] = [
      { try validate(&$0, 1) }, { try validate(&$0, 4) },
      { try validate(&$0, 3, current: []) },
      { try validate(&$0, 3, removed: ["missing"]) },
      { try validate(&$0, 3, expected: ["a", "a"]) },
      { try validate(&$0, 3, full: true) },
    ]
    for packet in bad {
      var state = SceneGeneration()
      try validate(&state, 2, full: true, updates: ["a"])
      state.commit(2)
      rejected { try packet(&state) }
      rejected { try validate(&state, 3) }
      try validate(&state, 5, full: true, updates: ["a"])
    }
    print("Swift scene generation guards passed")
  }
}
