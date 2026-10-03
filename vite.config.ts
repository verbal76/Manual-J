import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const sha = (process.env.BUILD_SHA || '').slice(0, 7) || (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'unknown'; } })();
// SDK levels come from the real Android build config so About cannot drift from the native build.
const gradleVars = readFileSync('android/variables.gradle', 'utf8');
const sdk = (k: string) => Number(gradleVars.match(new RegExp(`${k}\\s*=\\s*(\\d+)`))?.[1] ?? 0);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const env = (k: string, d = '') => process.env[k] ?? d;

export default defineConfig({
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MIN_SDK__: sdk('minSdkVersion'), __TARGET_SDK__: sdk('targetSdkVersion'), __COMPILE_SDK__: sdk('compileSdkVersion'),
    __SIGNING_STATE__: JSON.stringify(env('SIGNING_STATE', 'DEBUG')),
    __BUILD_TYPE__: JSON.stringify(env('BUILD_TYPE', 'debug')),
    // OTA channel this binary follows, and where it looks for the channel pointer. Empty URL = updates disabled.
    __OTA_CHANNEL__: JSON.stringify(env('OTA_CHANNEL', 'internal')),
    __OTA_MANIFEST_URL__: JSON.stringify(env('OTA_MANIFEST_URL', '')),
    // Identity of THIS web bundle. Empty for the embedded baseline; set by the OTA publish workflow.
    __OTA_ID__: JSON.stringify(env('OTA_ID', '')), __OTA_SEQ__: Number(env('OTA_SEQ', '0')),
    __OTA_NAME__: JSON.stringify(env('OTA_NAME', '')), __OTA_SHA__: JSON.stringify(env('OTA_SOURCE_SHA', '')),
    __OTA_PUBLISHED__: JSON.stringify(env('OTA_PUBLISHED', '')),
  },
  test: { include: ['tests/**/*.test.ts'] },
});
