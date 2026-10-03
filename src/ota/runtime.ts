/**
 * RUNTIME COMPATIBILITY VERSION of the native binary this web bundle is built for.
 * Bump it (and ship a new APK/AAB) whenever the web bundle starts needing something the installed native
 * binary may not have: a new/changed Capacitor plugin, a new Android permission, a WebView assumption, etc.
 * An OTA manifest declares `minRuntime`; installed apps refuse any OTA whose minRuntime is above their own.
 */
export const RUNTIME_VERSION = 1;
