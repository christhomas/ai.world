package world.ai.ai_world_flutter

/** Guard a complete scene transaction before any camera, mesh or GPU state changes. */
internal class SceneGeneration {
    private var last = 0L
    private var needsFull = true

    fun validate(generation: Long, full: Boolean, current: Set<String>, updates: Set<String>,
        removed: List<String>, expected: List<String>) {
        try {
            check(generation > last && (full || (!needsFull && generation == last + 1L))) {
                "Scene resync required: generation gap, stale packet or reset"
            }
            val inventory = if (full) mutableSetOf<String>() else current.toMutableSet()
            for (id in removed) check(inventory.remove(id)) { "Scene resync required: unknown mesh $id" }
            inventory.addAll(updates)
            check(expected.size == expected.toSet().size && inventory == expected.toSet()) {
                "Scene resync required: missing referenced mesh"
            }
        } catch (failure: Throwable) {
            invalidate()
            throw failure
        }
    }

    fun commit(generation: Long) { last = generation; needsFull = false }
    fun invalidate() { needsFull = true }
}
