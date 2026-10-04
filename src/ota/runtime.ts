/**
 * RUNTIME COMPATIBILITY VERSION of the native binary this web bundle is built for.
 * Bump it (and ship a new APK/AAB) whenever the web bundle starts needing something the installed native
 * binary may not have: a new/changed Capacitor plugin, a new Android permission, a WebView assumption, etc.
 * An OTA manifest declares `minRuntime`; installed apps refuse any OTA whose minRuntime is above their own.
 */
export const RUNTIME_VERSION = 2;
// History: 1 = Manual-J-v5 native (Capacitor 7, App/Device/Updater plugins, no system-bar inset handling).
//          2 = v6 native: MainActivity handles edge-to-edge insets + keyboard, new launcher icon/theme. The v6 web UI assumes this.
