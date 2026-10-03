import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import type { OtaAdapter } from './updater';

/** Capacitor-native adapter. Only usable inside the Android app; the web build gets a disabled updater. */
export const isNative = () => Capacitor.isNativePlatform();

export const capgoAdapter: OtaAdapter = {
  async fetchManifest(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  },
  async download(m) {
    const b = await CapacitorUpdater.download({ url: m.url, version: m.id, checksum: m.sha256 });
    return { bundleId: b.id, checksum: b.checksum ?? '' };
  },
  async deleteBundle(id) { await CapacitorUpdater.delete({ id }); },
  async activate(id) { await CapacitorUpdater.set({ id }); },
  async notifyReady() { await CapacitorUpdater.notifyAppReady(); },
};
