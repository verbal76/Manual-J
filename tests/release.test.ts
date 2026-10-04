import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('public version convention', () => {
  it('release/VERSION is a single positive integer (public versions are plain sequential numbers)', () => {
    const v = readFileSync('release/VERSION', 'utf8').trim();
    expect(v).toMatch(/^[1-9][0-9]*$/);
  });
  it('Gradle versionName is technical only; the public version never uses semver-style names in file naming', () => {
    const wf = readFileSync('.github/workflows/deliver.yml', 'utf8');
    expect(wf).toContain('Manual-J-v${N}');
    expect(wf).not.toMatch(/Manual-J-v[0-9]+\.[0-9]+/);
  });
});
