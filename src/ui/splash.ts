// Hot Attic Games studio card. The markup and artwork live in index.html (first paint); this module owns the timeline.
// Cold launch only: it runs once per page load, so background/resume never replays it. A reload that the OTA updater
// triggers on purpose sets SKIP_KEY so the studio card is not shown a second time right after "applying update".
export const SPLASH_TOTAL_MS = 2600;        // fade-in 450 + hold 1650 + fade-out 500
export const SPLASH_FADE_OUT_MS = 500;
export const SPLASH_HARD_CAP_MS = 6000;     // nothing can strand the user on the card
export const SKIP_KEY = 'manualj:skipSplashOnce';

const safeStorage = <T>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
export const markSkipNextSplash = () => safeStorage(() => sessionStorage.setItem(SKIP_KEY, '1'), undefined);
export const clearSkipNextSplash = () => safeStorage(() => sessionStorage.removeItem(SKIP_KEY), undefined);

/** Resolves when the card is fully gone. Initialization runs concurrently behind it (nothing here awaits the app). */
export function runSplash(doc: Document = document): Promise<void> {
  const el = doc.getElementById('hag-splash'); if (!el) return Promise.resolve();
  if (safeStorage(() => sessionStorage.getItem(SKIP_KEY), null)) { safeStorage(() => sessionStorage.removeItem(SKIP_KEY), undefined); el.remove(); return Promise.resolve(); }
  const img = doc.getElementById('hag-logo') as HTMLImageElement | null;
  const reduced = safeStorage(() => matchMedia('(prefers-reduced-motion: reduce)').matches, false);
  return new Promise(resolve => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; el.remove(); resolve(); };
    const fadeOut = () => { el.classList.add('out'); setTimeout(finish, reduced ? 0 : SPLASH_FADE_OUT_MS); };
    // Timed from first paint of the card; a broken image skips the card rather than showing an empty one.
    if (img) { img.onerror = finish; }
    setTimeout(fadeOut, SPLASH_TOTAL_MS - (reduced ? 0 : SPLASH_FADE_OUT_MS));
    setTimeout(finish, SPLASH_HARD_CAP_MS);
  });
}
