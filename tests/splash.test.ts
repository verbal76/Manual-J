import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { SPLASH_FADE_OUT_MS, SPLASH_HARD_CAP_MS, SPLASH_TOTAL_MS } from '../src/ui/splash';

const LOGO = 'Hot_Attic_Games_Master_Logo_ALPHA_FINAL.png';
// Git blob id of the owner-supplied canonical file (pins the exact bytes; any edit to the artwork fails this test).
const RUNTIME = 'src/assets/hag-splash.webp';
const RUNTIME_SHA256 = 'd5b95e806f0487806343f4ba060f2468fab9dc07a72af83f6597ca69d63d2bd0';
const CANONICAL_GIT_BLOB = 'e11f8c576652b82780967a02ee4b4acd12e8a3c8';
const gitBlobSha = (b: Buffer) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');

describe('Hot Attic Games studio splash', () => {
  it('canonical asset exists at the repo root and is byte-identical to the owner-supplied file', () => {
    expect(existsSync(LOGO)).toBe(true);
    expect(gitBlobSha(readFileSync(LOGO))).toBe(CANONICAL_GIT_BLOB);
  });
  it('is a transparent RGBA PNG with the expected aspect ratio (1536x1024)', () => {
    const b = readFileSync(LOGO);
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    expect(b.readUInt32BE(16)).toBe(1536); expect(b.readUInt32BE(20)).toBe(1024);
    expect(b[25]).toBe(6); // colour type 6 = RGBA (has an alpha channel)
  });
  it('the runtime asset is a lossless WebP with alpha at full 1536x1024; its bytes are pinned (re-derive with scripts/make_splash_asset.py)', () => {
    const b = readFileSync(RUNTIME);
    expect(b.subarray(0, 4).toString()).toBe('RIFF'); expect(b.subarray(8, 12).toString()).toBe('WEBP'); expect(b.subarray(12, 16).toString()).toBe('VP8L'); // VP8L = lossless
    const bits = b.readUInt32LE(21); expect((bits & 0x3fff) + 1).toBe(1536); expect(((bits >> 14) & 0x3fff) + 1).toBe(1024); expect((bits >> 28) & 1).toBe(1); // alpha_is_used
    expect(createHash('sha256').update(b).digest('hex')).toBe(RUNTIME_SHA256);
    expect(b.length).toBeLessThan(readFileSync(LOGO).length);
  });
  it('index.html shows the runtime asset derived from the canonical master, contain-fit, never stretched; old path is not referenced', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('src="/src/assets/hag-splash.webp"'); expect(html).toContain(LOGO); // provenance comment names the canonical file
    expect(html).toContain('object-fit:contain'); expect(html).toContain('width:auto;height:auto');
    expect(html).not.toMatch(/object-fit:\s*(cover|fill)/);
    for (const f of ['index.html', 'src/ui/splash.ts', 'src/main.ts']) expect(readFileSync(f, 'utf8')).not.toContain('branding/Hot_Attic_Games_Master_Logo.png');
  });
  it('total display time is 2-3 s, includes the fade-out, and a hard cap prevents stranding', () => {
    expect(SPLASH_TOTAL_MS).toBeGreaterThanOrEqual(2000); expect(SPLASH_TOTAL_MS).toBeLessThanOrEqual(3000);
    expect(SPLASH_FADE_OUT_MS).toBeLessThan(SPLASH_TOTAL_MS); expect(SPLASH_HARD_CAP_MS).toBeGreaterThan(SPLASH_TOTAL_MS);
  });
  it('is cold-launch only: it is driven from main.ts at page load, never from lifecycle/resume handlers', () => {
    const app = readFileSync('src/ui/app.ts', 'utf8');
    expect(app).not.toMatch(/runSplash|showSplash/);
    expect(app).not.toMatch(/visibilitychange[^)]*\)\s*=>\s*{[^}]*splash/i);
    expect(readFileSync('src/main.ts', 'utf8')).toContain('runSplash()');
  });
});
