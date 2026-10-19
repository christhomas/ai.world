package world.ai.ai_world_flutter

import org.junit.Assert.assertThrows
import org.junit.Test

class SceneGenerationTest {
    private fun validate(guard: SceneGeneration, generation: Long, full: Boolean = false,
        current: Set<String> = setOf("a"), updates: Set<String> = emptySet(),
        removed: List<String> = emptyList(), expected: List<String> = listOf("a")) =
        guard.validate(generation, full, current, updates, removed, expected)

    @Test fun contiguousUpdatesAndFullRecovery() {
        val guard = SceneGeneration()
        assertThrows(IllegalStateException::class.java) { validate(guard, 1) }
        validate(guard, 2, full = true, updates = setOf("a"))
        guard.commit(2)
        validate(guard, 3, updates = setOf("b"), expected = listOf("a", "b"))
        guard.commit(3)
        validate(guard, 4, current = setOf("a", "b"), removed = listOf("a"), expected = listOf("b"))
        guard.commit(4)
        guard.invalidate()
        assertThrows(IllegalStateException::class.java) { validate(guard, 5) }
        validate(guard, 6, full = true, updates = setOf("a"))
        guard.commit(6)
        assertThrows(IllegalStateException::class.java) { validate(guard, 5, full = true, updates = setOf("a")) }
    }

    @Test fun badPacketsInvalidateEvenTheNextContiguousDelta() {
        for (bad in listOf<(SceneGeneration) -> Unit>(
            { validate(it, 1) }, { validate(it, 4) },
            { validate(it, 3, current = emptySet()) },
            { validate(it, 3, removed = listOf("missing")) },
            { validate(it, 3, expected = listOf("a", "a")) },
            { validate(it, 3, full = true) },
        )) {
            val guard = SceneGeneration()
            validate(guard, 2, full = true, updates = setOf("a"))
            guard.commit(2)
            assertThrows(IllegalStateException::class.java) { bad(guard) }
            assertThrows(IllegalStateException::class.java) { validate(guard, 3) }
            validate(guard, 5, full = true, updates = setOf("a"))
        }
    }
}
