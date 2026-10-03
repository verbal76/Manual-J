// Builds and self-validates an OTA channel manifest for a zipped web bundle. Usage: tsx scripts/make-manifest.ts <zip> <out.json>
// Inputs via env: OTA_CHANNEL OTA_ID OTA_SEQ OTA_NAME OTA_SOURCE_SHA OTA_PUBLISHED OTA_URL_BASE OTA_MIN_VERSION_CODE
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { parseManifest } from '../src/ota/manifest';
import { RUNTIME_VERSION } from '../src/ota/runtime';
import { SCHEMA_VERSION } from '../src/model/factory';

const [zip, out] = process.argv.slice(2);
const e = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const manifest = {
  schema: 1, channel: e('OTA_CHANNEL'), id: e('OTA_ID'), name: e('OTA_NAME'), seq: Number(e('OTA_SEQ')), sourceSha: e('OTA_SOURCE_SHA'), publishedAt: e('OTA_PUBLISHED'),
  minRuntime: RUNTIME_VERSION, minVersionCode: Number(process.env.OTA_MIN_VERSION_CODE ?? 1), projectSchema: SCHEMA_VERSION,
  url: `${e('OTA_URL_BASE')}/${basename(zip)}`, sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'), size: statSync(zip).size,
};
const parsed = parseManifest(manifest);
if (!parsed.ok) throw new Error(`generated manifest is invalid: ${parsed.error}`);
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n'); console.log(JSON.stringify(manifest, null, 2));
