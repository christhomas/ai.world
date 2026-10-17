# iOS release builds

How the installed iOS game is built for testers, signed, and sent to TestFlight (#581). The build is
`.github/workflows/ios-release.yml`; it runs when a GitHub release of the game is published, by hand
(`gh workflow run "iOS release" --ref main`), and on a pull request that changes the workflow.

## What a build is

- **Identity.** Bundle id `world.ai.aiWorldFlutter`, team `43UMKXZ8P4`. The id must never change, or
  a tester's saves stay with the old app.
- **Version.** `CFBundleShortVersionString` is the game's own version from `package.json`. The build
  number is the number of commits on the release's history, which only grows, as TestFlight requires.
- **Contents.** The game is bundled from the same commit (`tools/mobile/build-engine.mjs`), with its
  manifest naming the commit and checksum. The fonts and their licences are bundled. Nothing is
  fetched at run time.
- **Network.** A release build reaches a shared world only over `wss`: the app's socket refuses
  anything else outside a debug build. `Info.plist` allows local networking, which is what a debug
  build uses for a LAN world, and that permits no internet cleartext.
- **Orientation.** Landscape only, both ways round.

## Without the team's secrets

The workflow builds `flutter build ios --release --no-codesign` and keeps the `.app` as
`ai-world-<version>-unsigned-device.app.zip`. That proves the release compiles for a phone and carries
everything it needs. It does not install on one, and it is never a TestFlight build.

## With them

| secret | what it is |
|---|---|
| `AI_WORLD_IOS_CERTIFICATE_P12_BASE64` | the Apple Distribution certificate and its private key, as a `.p12`, base64 |
| `AI_WORLD_IOS_CERTIFICATE_PASSWORD` | the `.p12`'s password |
| `AI_WORLD_IOS_PROFILE_BASE64` | an App Store distribution provisioning profile for `world.ai.aiWorldFlutter`, base64 |
| `AI_WORLD_ASC_KEY_ID`, `AI_WORLD_ASC_ISSUER_ID` | an App Store Connect API key's id and issuer |
| `AI_WORLD_ASC_KEY_P8_BASE64` | that key's `.p8`, base64 |

```sh
gh secret set AI_WORLD_IOS_CERTIFICATE_P12_BASE64 < <(base64 -i distribution.p12)
gh secret set AI_WORLD_IOS_CERTIFICATE_PASSWORD
gh secret set AI_WORLD_IOS_PROFILE_BASE64 < <(base64 -i ai-world-app-store.mobileprovision)
gh secret set AI_WORLD_ASC_KEY_ID --body <key id>
gh secret set AI_WORLD_ASC_ISSUER_ID --body <issuer id>
gh secret set AI_WORLD_ASC_KEY_P8_BASE64 < <(base64 -i AuthKey_<key id>.p8)
```

The certificate goes into a throwaway keychain for the run, and the keychain is deleted after it.
`flutter build ipa` exports an App Store Connect IPA, keeps the archive's dSYMs beside it, and a
published release uploads the IPA to TestFlight with `xcrun altool`. Keep the `.p12`, the profile and
the `.p8` in a password manager and an offline backup. When the certificate or profile expires, make
new ones in the developer portal and replace the secrets; installed copies keep working and upgrade
from the next build.

## Testers

Add testers in App Store Connect under *TestFlight*. Internal testers install from the TestFlight app
as soon as a build has processed; external testers need Apple's beta review first. A later build
updates in place, and the app's saves, worlds and settings in its own container are kept. The privacy
answers in App Store Connect should say what the app does: no tracking, no data collected, and the
network used only to join a shared world the player chooses. Check them against Apple's current rules
at the time of submitting.

## What is still open

#581 is complete when a signed archive has installed and run on a real iPhone, and a TestFlight build
has reached a tester and updated over itself with its saves intact. Both need the team's certificate,
profile and App Store Connect key, which only the owner can provide.
