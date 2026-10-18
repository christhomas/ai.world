import Foundation

/// Validate against the actual native inventory before committing a render transaction.
struct SceneGeneration {
  private var last: Int64 = 0
  private var needsFull = true

  mutating func validate(generation: Int64, full: Bool, current: Set<String>, updates: Set<String>,
                         removed: [String], expected: [String]) throws {
    do {
      guard generation > last, full || (!needsFull && generation == last + 1) else {
        throw SceneResyncRequired()
      }
      var inventory = full ? Set<String>() : current
      for id in removed {
        guard inventory.remove(id) != nil else { throw SceneResyncRequired() }
      }
      inventory.formUnion(updates)
      guard expected.count == Set(expected).count, inventory == Set(expected) else {
        throw SceneResyncRequired()
      }
    } catch {
      invalidate()
      throw error
    }
  }

  mutating func commit(_ generation: Int64) { last = generation; needsFull = false }
  mutating func invalidate() { needsFull = true }
}

struct SceneResyncRequired: LocalizedError {
  var errorDescription: String? { "Scene resync required: generation gap, stale packet, reset or missing mesh" }
}
