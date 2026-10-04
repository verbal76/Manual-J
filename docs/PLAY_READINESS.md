# Project / Android / Google Play identity and readiness
Status legend: CONFIRMED (from repository) · OWNER-CONFIRM · OWNER-ACTION. Last audited 2026-10-03.

| Item | Value | Status |
|---|---|---|
| App name | Manual J Survey | CONFIRMED |
| Package ID | **com.hotatticgames.manualj** (canonical; owner-approved 2026-10-03, before any Play upload). History: the first test APKs (CI runs #3–#6) used com.verbal76.manualj; Android treats the new ID as a different app and old local data does not transfer — accepted | CONFIRMED |
| versionName | 0.1.0 (package.json + android/app/build.gradle; keep in sync) | CONFIRMED |
| versionCode | Delivered builds: `100 + N` where N is the public version (`release/VERSION`), so the number rises with every delivered build; development CI builds use the Actions run number | CONFIRMED |
| min / target / compile SDK | see `android/variables.gradle` (single source; About reads it at build time) | CONFIRMED |
| Play target requirement | API 36 for new apps/updates from 2026-08-31 (extension to 2026-11-01 possible). Source: developer.android.com/google/play/requirements/target-sdk, fetched 2026-10-03 | VERIFIED |
| Play API compliant | YES by configuration since commit ddf475a (targetSdk 36; CI debug build green, run #5). Device behaviour at API 36 not yet tested. Was NO (targetSdk 35) at the start of this phase | CONFIRMED (config) / OWNER device test |
| Remediation class | Class A candidate (targetSdk/compileSdk 36 + AGP minor bump; Gradle 8.11.1 and JDK 21 already suitable; no framework major upgrade). Proven only by a green CI build and device test; if CI rejects it, revert and treat as Class B | see commit history |
| Stack | TypeScript, Vite 8.3, vanilla DOM, Capacitor 7, Gradle 8.11.1, AGP 8.10.1 (8.7.2 before the API-36 change), JDK 21 (CI) | CONFIRMED |
| APK | debug APK per push (`android.yml`), debug-signed, sideload only | CONFIRMED |
| AAB | `android-release.yml` (manual). Not yet run: needs upload-key secrets | PREPARED |
| Signing | Debug today. Release path reads `UPLOAD_KEYSTORE_*`; Gradle and workflow both FAIL HARD when absent — never fall back to debug signing | PREPARED |
| Upload key / Play App Signing | None yet | OWNER-ACTION |
| Permissions | Verified from the APK: INTERNET, WAKE_LOCK, ACCESS_NETWORK_STATE (+ the app's own signature-level receiver permission). RECEIVE_BOOT_COMPLETED and FOREGROUND_SERVICE (pulled in by the OTA plugin's WorkManager) are removed by manifest merge rules. `scripts/qualify-apk.sh` fails any build with another permission. | VERIFIED from APK |
| Third-party SDKs | Capacitor core/android/app/device/share/filesystem; `@capgo/capacitor-updater` (WorkManager, Room, Play app-update/tasks, okhttp). Updater stats endpoint disabled (`statsUrl: ""`); updates disabled until a manifest URL is configured | CONFIRMED + device check |
| Ads / IAP / accounts / login | None | CONFIRMED |
| Analytics / crash reporting | None | CONFIRMED |
| Camera / mic / location / media / notifications | None used | CONFIRMED |
| Internet required | No. Only the optional OTA check uses the network | CONFIRMED |
| User data | Project data (client name, address, house dimensions) in on-device localStorage only. Leaves the device only if the user shares/saves a report | CONFIRMED |
| Privacy policy | Draft factual text in `docs/PRIVACY_DRAFT.md`; no hosted URL | OWNER-ACTION |
| Data safety | Preparation: no data collected or shared by the app; OTA check sends a plain HTTPS GET (host sees IP/user-agent). Owner must confirm on the Play form | OWNER-CONFIRM |
| Content rating | Utility/productivity, no UGC, no ads — owner completes questionnaire | OWNER-ACTION |
| Store assets | Launcher icon done (adaptive + monochrome). Missing: feature graphic, screenshots, descriptions. The studio logo is for the in-app splash only | OWNER-ACTION |
| Internal-testing readiness | NOT READY: upload key + secrets, Play Console app, privacy URL, store graphics/screenshots. Technically: API 36, no native libs (16 KB n/a), real icon, stable package ID are in place | |

## Owner actions remaining
1. (done: package ID approved) 2. Create upload key; add four GitHub secrets (`UPLOAD_KEYSTORE_BASE64`, `UPLOAD_KEYSTORE_PASSWORD`, `UPLOAD_KEY_ALIAS`, `UPLOAD_KEY_PASSWORD`). 3. Play Developer account + create app + enable Play App Signing. 4. Host privacy policy. 5. Data safety + content rating forms. 6. Store listing assets. 7. Run `android-release.yml`, upload the AAB to Internal testing.
