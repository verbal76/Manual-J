import { PLAY_REQUIRED_TARGET_SDK, PLAY_REQUIREMENT_VERIFIED_ON, playCompliance } from './play';

export interface DiagnosticsInput {
  capturedAt: string;
  native: { platform: string; osVersion?: string; apiLevel?: number; model?: string; locale?: string; appId?: string; versionName?: string; versionCode?: string };
  build: { appName: string; publicVersion: string; appVersion: string; sourceSha: string; buildType: string; signing: string; minSdk: number; targetSdk: number; compileSdk: number; runtime: number };
  ota: { enabled: boolean; why?: string; channel: string; runningFrom: 'EMBEDDED' | 'OTA'; id: string; name: string; seq: number; sourceSha: string; published: string; status: string; lastCheck: string; lastResult: string };
  engine: { version: string; projectSchema: number };
}
const v = (x: unknown) => (x === undefined || x === null || x === '' ? 'n/a' : String(x));

/** Plain text for pasting into a chat. Contains no project data, personal data, endpoints or secrets by construction. */
export function buildDiagnostics(d: DiagnosticsInput): string {
  const { native: n, build: b, ota: o, engine: e } = d;
  return [
    `${b.appName.toUpperCase()} DIAGNOSTICS`, `Captured at: ${d.capturedAt}`, '',
    'APPLICATION', `  Product: ${b.appName}`, `  Version: ${b.publicVersion}`, `  Technical app version: ${b.appVersion}`, `  Source commit: ${b.sourceSha}`, `  Build type: ${b.buildType}`,
    `  Engine: ${e.version}`, `  Project data schema: ${e.projectSchema}`, '',
    'INSTALL (native)', `  Package ID: ${v(n.appId)}`, `  Native versionName: ${v(n.versionName)}`, `  Native versionCode: ${v(n.versionCode)}`, `  Runtime compatibility: ${b.runtime}`, '',
    'DEVICE', `  Platform: ${n.platform}`, `  Android: ${v(n.osVersion)} (API ${v(n.apiLevel)})`, `  Model: ${v(n.model)}`, `  Locale: ${v(n.locale)}`, '',
    'OTA', `  Updates enabled: ${o.enabled ? 'yes' : `no (${v(o.why)})`}`, `  Channel: ${o.channel}`, `  Running from: ${o.runningFrom}${o.runningFrom === 'EMBEDDED' ? ' (native baseline)' : ''}`,
    `  OTA id: ${v(o.id)}`, `  OTA name: ${v(o.name)}`, `  OTA sequence: ${o.seq}`, `  OTA source commit: ${v(o.sourceSha)}`, `  OTA published: ${v(o.published)}`,
    `  Update state: ${o.status}`, `  Last check: ${o.lastCheck}`, `  Last result: ${o.lastResult}`, '',
    'GOOGLE PLAY / ANDROID', `  minSdk: ${b.minSdk}`, `  targetSdk: ${b.targetSdk}`, `  compileSdk: ${b.compileSdk}`,
    `  Play required targetSdk: ${PLAY_REQUIRED_TARGET_SDK} (verified ${PLAY_REQUIREMENT_VERIFIED_ON})`, `  Play API compliant: ${playCompliance(b.targetSdk)}`, `  Signing: ${b.signing}`,
  ].join('\n');
}
