# Android release builds

How the installed Android game is built for testers, signed, and handed out (#580). The build is
`.github/workflows/android-release.yml`; it runs when a GitHub release of the game is published, by
hand (`gh workflow run "Android release" --ref main`), and on a pull request that changes the build.

## What a build is

- **Identity.** `applicationId` `world.ai.ai_world_flutter`. It must never change: Android treats a
  different id as a different app, and a tester's saves would stay with the old one.
- **Version.** `versionName` is the game's own version from `package.json`, the one the title screen
  shows. `versionCode` is the number of commits on the release's history, which only grows, so every
  later build upgrades an earlier one in place.
- **Contents.** The game is bundled from the same commit (`tools/mobile/build-engine.mjs`), and its
  manifest names the commit and the bundle's checksum. Nothing is fetched at run time. A release build
  allows no cleartext connections, so a shared world is reached only over `wss`.
- **Shrinking.** R8 shrinks the Kotlin, and `proguard-rules.pro` keeps the class the engine's JNI
  symbols name.

The workflow keeps, for 90 days and on the release itself when it is properly signed:

| file | what it is |
|---|---|
| `ai-world-<version>.apk` | for installing directly |
| `ai-world-<version>.aab` | for Play's internal testing |
| `ai-world-<version>-mapping.txt` | R8's renaming, to read a Kotlin stack trace |
| `ai-world-<version>-native-symbols.zip` | to read a native crash in the engine |
| `ai-world-<version>-game-manifest.json` | the bundled game's commit and checksum |
| `SHA256SUMS`, `signature.txt` | checksums of all of these, and the certificate the APK carries |

## The signing key

A build is signed with the app's own key when the repository has one. Without one it is signed with the
Android debug key so that it still builds and can be checked, and its files are named `-debug-signed`.
**A debug-signed build is not for testers:** Android refuses to upgrade an app signed with one key by
an app signed with another, so a tester who installs one would have to uninstall, and lose their saves,
to take a real build later.

Creating the key, once, on a trusted machine:

```sh
keytool -genkeypair -v -keystore ai-world-upload.jks -alias ai-world -keyalg RSA -keysize 4096 -validity 10000
```

Keep the keystore and both passwords in a password manager **and** an offline backup. Losing the key
means no installed copy can ever be upgraded again; for Play, enrol in Play App Signing so that this is
an *upload* key, which Google can reset, rather than the key the store signs with.

Giving it to the workflow (never commit the keystore or a password):

```sh
gh secret set AI_WORLD_ANDROID_KEYSTORE_BASE64 < <(base64 -w0 ai-world-upload.jks)
gh secret set AI_WORLD_ANDROID_KEYSTORE_PASSWORD
gh secret set AI_WORLD_ANDROID_KEY_ALIAS --body ai-world
gh secret set AI_WORLD_ANDROID_KEY_PASSWORD
```

To rotate the upload key: make a new one, ask Play to reset the upload key to it, then replace the
four secrets. Builds already installed keep upgrading, because the store signs with its own key.

## Installing and upgrading

A tester installs a signed APK directly with `adb install ai-world-<version>.apk`, or by opening the
file on the phone after allowing installs from that source. A later build installs over it, with
`adb install -r` or the same way. The app keeps its saves, its worlds and its settings in its own
private storage, and an upgrade with the same id and key leaves all of them where they were.

Play internal testing takes the `.aab`: upload it in the Play Console under *Testing → Internal
testing*, add testers by email, and they install from the link the Console gives. The store listing,
the data-safety form and the permissions declaration (the app uses only the network, to join a shared
world) are filled in there, and must be checked against Play's current requirements at the time.

## What is still open

#580 is complete when a properly signed APK has been installed on a physical phone and upgraded over
itself with its saves intact, and an `.aab` has gone through internal testing. Both need the key and a
Play developer account, which only the owner can provide.
