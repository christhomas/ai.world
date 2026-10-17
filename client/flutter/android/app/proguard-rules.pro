# The embedded game engine is bound by JNI symbol names (state_engine.c:
# Java_world_ai_ai_1world_1flutter_NativeStateEngine_*), so the class and its native methods keep their
# names in a shrunk release.
-keep class world.ai.ai_world_flutter.NativeStateEngine { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
