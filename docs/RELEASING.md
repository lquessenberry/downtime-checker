# Releasing Global Status (native apps)

## Cut a release

1. Bump `version` in `rust/Cargo.toml` (`[workspace.package]`) when the Android build should get a new versionCode, and update `# android-version-code` in `rust/crates/globe-native/Cargo.toml` (versionCode = 2^24 + major*65536 + minor*256 + patch).
2. Add `docs/release-notes/vX.Y.Z[-pre].md` and, for Android, `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
3. Push a tag `vX.Y.Z[-pre]`, or run **Actions → Release → Run workflow** with the tag name (the tag is created on that branch's head).

`.github/workflows/release.yml` then:

- **guard**: checks the tag, fails if the private nuclear-effects simulator files appear in the tree or a workflow enables `nuke-sim`, and runs a gitleaks secret scan (`.gitleaks.toml`).
- builds Linux x86_64 (tar.gz + AppImage), Windows x86_64 (zip), macOS universal (zip + dmg, ad-hoc signed) and Android (universal APK via cargo-apk);
- publishes a GitHub release (pre-release when the tag has a `-suffix`) with `SHA256SUMS`.

Android is optional for publishing: if its job fails, the release still goes out and says the APK is missing.

## Signing (not set up yet: roadmap M4-4 / M4-8)

Builds are unsigned. Each signing step is a hook that only runs when its secrets exist; no keys are in the repo.

| Platform | Secrets |
| --- | --- |
| macOS Developer ID + notarization | `APPLE_DEVELOPER_ID_P12_B64`, `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_NOTARY_API_KEY_B64`, `APPLE_NOTARY_API_KEY_ID`, `APPLE_NOTARY_ISSUER_ID` |
| Windows Authenticode | `WINDOWS_CODESIGN_PFX_B64`, `WINDOWS_CODESIGN_PFX_PASSWORD` |
| Android release key | `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD` |
| Checksums | `RELEASE_GPG_KEY_B64` |

Until `ANDROID_KEYSTORE_B64` exists, the APK is signed with a throwaway debug key generated on the runner and named `*-debugsigned.apk`. Each build gets a new key, so testers must uninstall before installing a newer alpha.

## Build locally

```bash
cd rust
cargo test --workspace
cargo build --release -p downtime-globe-native     # target/release/downtime-globe
# Android (needs Android SDK + NDK r27, rustup targets, cargo-apk 0.10)
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-apk --version 0.10.0 --locked
export ANDROID_HOME=... ANDROID_NDK_ROOT=...
CARGO_APK_RELEASE_KEYSTORE=/path/debug.keystore CARGO_APK_RELEASE_KEYSTORE_PASSWORD=android \
  cargo apk build -p downtime-globe-native --lib --release   # target/release/apk/GlobalStatus.apk
```

## F-Droid

- App ID: `app.globalstatus`.
- Store text and images: `fastlane/metadata/android/en-US/` (F-Droid reads these from the tagged source).
- Draft fdroiddata recipe: `fdroid/app.globalstatus.yml`.

To submit: fork https://gitlab.com/fdroid/fdroiddata, copy the recipe to `metadata/app.globalstatus.yml`, run `fdroid readmeta`, `fdroid rewritemeta app.globalstatus`, `fdroid lint app.globalstatus` and `fdroid build -v -l app.globalstatus` (fdroidserver, ideally in its Docker image), then open a merge request using the "App inclusion" template.

## Private code

The nuclear-effects calculator/simulator is not in this repository and stays private until its authors say it is ready. If it is ever added, it goes behind the non-default `nuke-sim` cargo feature in `globe-native`, and release builds must not enable it.
