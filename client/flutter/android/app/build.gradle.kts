import java.io.File

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "world.ai.ai_world_flutter"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "world.ai.ai_world_flutter"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        externalNativeBuild {
            cmake { arguments += "-DANDROID_STL=none" }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    // A release is signed with the app's own key when one is supplied (#580; docs/mobile/android-release.md),
    // from the environment the release workflow sets from repository secrets. The key never lives in the
    // repository. Without one it is signed with the debug key so that it still builds and installs for
    // checking, and the workflow names it debug-signed: such a build is not for testers, because an app
    // signed with one key cannot be upgraded by an app signed with another.
    val keystore = System.getenv("AI_WORLD_KEYSTORE")?.let(::File)?.takeIf { it.isFile }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = keystore
                storePassword = System.getenv("AI_WORLD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("AI_WORLD_KEY_ALIAS")
                keyPassword = System.getenv("AI_WORLD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
            // the engine is reached by JNI names R8 must not touch; see proguard-rules.pro
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // native symbols kept beside the release so a crash report can be read (#580)
            ndk { debugSymbolLevel = "FULL" }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    implementation("androidx.core:core:1.15.0")
}
