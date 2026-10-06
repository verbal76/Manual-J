import { Capacitor } from '@capacitor/core';
import { ENGINE_VERSION } from '../engine/provenance';
import { SCHEMA_VERSION } from '../model/factory';
import { RUNTIME_VERSION } from '../ota/runtime';
import type { OtaUpdater } from '../ota/updater';
import { buildDiagnostics, type DiagnosticsInput } from './diagnostics';
import { formatErrors, recentErrors } from './errorlog';

export const APP_NAME = 'Manual J';
/** What the owner sees: "v6" for a delivered build; development builds say so and never claim a delivered number. */
export const PUBLIC_VERSION_LABEL = __DELIVERED__ ? `v${__PUBLIC_VERSION__}` : `v${__PUBLIC_VERSION__} (development build, not delivered)`;

async function nativeInfo(): Promise<DiagnosticsInput['native'] & { buildNumber?: number }> {
  const platform = Capacitor.getPlatform();
  if (!Capacitor.isNativePlatform()) return { platform: `${platform} (not the installed Android app)`, locale: navigator.language };
  const out: DiagnosticsInput['native'] & { buildNumber?: number } = { platform };
  try { const { App } = await import('@capacitor/app'); const i = await App.getInfo(); out.appId = i.id; out.versionName = i.version; out.versionCode = i.build; out.buildNumber = Number(i.build); } catch { /* leave n/a */ }
  try { const { Device } = await import('@capacitor/device'); const d = await Device.getInfo(); out.osVersion = d.osVersion; out.apiLevel = d.androidSDKVersion; out.model = `${d.manufacturer} ${d.model}`.trim(); out.locale = (await Device.getLanguageTag()).value; } catch { /* leave n/a */ }
  return out;
}
export const installedVersionCode = async (): Promise<number | null> => { const n = await nativeInfo(); return Number.isFinite(n.buildNumber) ? (n.buildNumber as number) : null; };

export async function collectDiagnostics(u: OtaUpdater | null): Promise<{ input: DiagnosticsInput; text: string }> {
  const n = await nativeInfo();
  const s = u?.state;
  const input: DiagnosticsInput = {
    capturedAt: new Date().toISOString(), native: n,
    build: { appName: APP_NAME, publicVersion: PUBLIC_VERSION_LABEL, appVersion: __APP_VERSION__, sourceSha: __BUILD_SHA__, buildType: __BUILD_TYPE__, signing: __SIGNING_STATE__, minSdk: __MIN_SDK__, targetSdk: __TARGET_SDK__, compileSdk: __COMPILE_SDK__, runtime: RUNTIME_VERSION },
    ota: {
      enabled: !!u && s?.kind !== 'disabled', why: s?.kind === 'disabled' ? s.why : undefined, channel: __OTA_CHANNEL__,
      runningFrom: __OTA_SEQ__ > 0 ? 'OTA' : 'EMBEDDED', id: __OTA_ID__, name: __OTA_NAME__, seq: __OTA_SEQ__, sourceSha: __OTA_SHA__, published: __OTA_PUBLISHED__,
      status: s ? (s.kind === 'staged' ? `staged: ${s.manifest.name}` : s.kind === 'failed' ? `failed: ${s.error}` : s.kind === 'rejected' ? `refused: ${s.reason}` : s.kind) : 'n/a',
      lastCheck: u && u.lastCheckAt ? new Date(u.lastCheckAt).toISOString() : 'never', lastResult: u?.lastResult ?? 'n/a',
    },
    engine: { version: ENGINE_VERSION, projectSchema: SCHEMA_VERSION }, recentErrors: formatErrors(recentErrors()),
  };
  return { input, text: buildDiagnostics(input) };
}
