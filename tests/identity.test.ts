import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const CANONICAL = 'com.hotatticgames.manualj';
const OLD = 'com.verbal76.manualj';
const read = (p: string) => readFileSync(p, 'utf8');

describe('package identity does not drift', () => {
  it('Capacitor, Gradle namespace/applicationId, strings and MainActivity all use the canonical ID', () => {
    expect(JSON.parse(read('capacitor.config.json')).appId).toBe(CANONICAL);
    const g = read('android/app/build.gradle');
    expect(g).toMatch(new RegExp(`namespace "${CANONICAL}"`));
    expect(g).toMatch(new RegExp(`applicationId "${CANONICAL}"`));
    expect(read('android/app/src/main/res/values/strings.xml')).toContain(`<string name="package_name">${CANONICAL}</string>`);
    const dir = `android/app/src/main/java/${CANONICAL.replace(/\./g, '/')}`;
    expect(existsSync(`${dir}/MainActivity.java`)).toBe(true);
    expect(read(`${dir}/MainActivity.java`)).toMatch(new RegExp(`^package ${CANONICAL.replace(/\./g, '\\.')};`));
  });
  it('old package directory is gone and no operational file still names the old ID', () => {
    expect(existsSync('android/app/src/main/java/com/verbal76')).toBe(false);
    for (const f of ['capacitor.config.json', 'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml', 'android/app/src/main/res/values/strings.xml', '.github/workflows/android.yml', '.github/workflows/android-release.yml', '.github/workflows/ota-publish.yml', 'vite.config.ts'])
      expect(read(f), f).not.toContain(OLD);
  });
  it('no hard-coded app id in runtime code: About/diagnostics read the native installed identity', () => {
    for (const f of ['src/release/identity.ts', 'src/release/diagnostics.ts', 'src/ota/updater.ts', 'src/ota/manifest.ts']) {
      expect(read(f), f).not.toContain(OLD); expect(read(f), f).not.toContain(CANONICAL);
    }
  });
});
