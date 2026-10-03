# OTA architecture
**Stack:** TypeScript/Vite web bundle inside a Capacitor 7 Android shell. **Previous OTA state:** none.

## Boundary
- **OTA-safe:** anything in the Vite bundle (UI, engine, report, persistence code, CSS, bundled assets, the studio-logo image).
- **Native-build-required:** `android/`, Capacitor core or plugins (adding/removing/upgrading), permissions, applicationId, SDK levels, WebView assumptions, native launch theme (black launch frame), anything that needs a newer native capability.
- **Uncertain / validate:** project-data schema bumps (an older bundle after rollback must not destroy newer data — `migrate()` refuses newer schemas, so schema bumps need a deliberate compatibility plan and `projectSchema` in the manifest blocks downgrades); engine behaviour changes (results change with the bundle: engine version is in About).

## Compatibility
`RUNTIME_VERSION` (`src/ota/runtime.ts`) = what the installed native binary supports. Bump it with any native change. Manifest carries `minRuntime`, `minVersionCode`, `projectSchema`. The client refuses: wrong channel, runtime too new, native too old, schema downgrade, older/duplicate seq, previously failed seq. Native build identity (versionCode) and OTA identity (id/seq) are separate.

## Publication (GitHub Actions `ota-publish.yml`, manual, dry-run by default)
source → typecheck/tests/validate → build bundle stamped with OTA id/seq/name/sha/time → zip (index.html at root) → SHA-256 → manifest self-validated by the client's own parser → immutable `bundles/ota-<seq>.zip` + mutable `channels/<channel>.json` on branch `ota`. **Hosting is an OWNER DECISION:** installed apps cannot read a private repo; the `ota` branch via raw.githubusercontent.com works only if the repository is public (or use another static host). Until `OTA_MANIFEST_URL` is set at build time, updates are disabled ("no update server configured") and the app is purely offline.
Channels: `internal` (default baked in) and any other name; installed app follows the channel compiled into it (`OTA_CHANNEL`).

## Client (`src/ota/`)
Discovery at app start (throttled to once per 15 min; never blocks startup; 10 s fetch timeout). Download via `@capgo/capacitor-updater` in manual mode (`autoUpdate:false`, stats disabled). Integrity: SHA-256 passed to the plugin AND compared with the checksum the plugin reports; empty/mismatch ⇒ payload deleted, seq blacklisted (fail closed). Staged update activates only at a safe point (Home screen, splash finished; projects autosave) after showing "Please wait, applying update"; activation watchdog 20 s. Known-good retained by the plugin; the new bundle must call `notifyAppReady()` within 10 s of start or the plugin rolls back; the app then detects the rollback on next start, blacklists that seq and records it in About. Offline ⇒ current known-good runs, no error UI.
Identify the running OTA: Settings → About (Running from / OTA id / name / sequence / source commit / published).

## Honest status
Logic is unit-tested with a fake adapter (33 tests). Plugin behaviours that can only be proven on a device are UNVERIFIED: checksum reporting/enforcement, rollback timing, reload behaviour, and that no traffic goes to the plugin vendor.
