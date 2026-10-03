// Hot Attic Games opening studio card: solid black, canonical logo centred and "contained" (never cropped/stretched), ~1.5 s, silent.
// Uses the exact canonical file. If it is not in the repo, no card is shown (nothing is invented or substituted).
const found = import.meta.glob('../../branding/Hot_Attic_Games_Master_Logo.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const STUDIO_LOGO_URL: string | undefined = Object.values(found)[0];
export const SPLASH_MS = 1500;

/** Resolves when the card is gone (immediately if there is no canonical asset). Shown once per real launch (page load). */
export function showSplash(host: HTMLElement): Promise<void> {
  if (!STUDIO_LOGO_URL) return Promise.resolve();
  const el = document.createElement('div'); el.className = 'splash';
  const img = new Image(); img.alt = 'Hot Attic Games'; img.decoding = 'async'; img.src = STUDIO_LOGO_URL; el.append(img); host.append(el);
  return new Promise(resolve => {
    const done = () => { el.remove(); resolve(); };
    // Time is measured from when the logo is actually visible; a broken image can't strand startup.
    const start = () => setTimeout(done, SPLASH_MS);
    img.complete ? start() : (img.onload = start, img.onerror = done);
    setTimeout(done, SPLASH_MS + 3000);
  });
}
