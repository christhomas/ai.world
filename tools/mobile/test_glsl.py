import unittest

from glsl import BRIDGE, STAGES, shaders


class ShaderExtractionTests(unittest.TestCase):
    def test_templates_expand_as_kotlin_expands_them(self):
        kotlin = 'private const val LIGHTS = 4\nprivate const val PART = """float f(){return 1.0;}"""\n' \
                 'private const val VERTEX_SHADER = """#version 300 es\n$PART\nuniform vec4 a[${LIGHTS}];"""'
        self.assertEqual(shaders(kotlin)['VERTEX_SHADER'], '#version 300 es\nfloat f(){return 1.0;}\nuniform vec4 a[4];')

    def test_a_template_that_names_nothing_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'names nothing'):
            shaders('private const val VERTEX_SHADER = """$MISSING"""')

    def test_the_bridge_holds_every_stage_with_nothing_left_unexpanded(self):
        found = shaders(BRIDGE.read_text())
        self.assertEqual(set(found), set(STAGES))
        for name, source in found.items():
            self.assertTrue(source.startswith('#version 300 es'), name)
            self.assertNotIn('$', source, name)


if __name__ == '__main__':
    unittest.main()
