// Platform adapter entry point. Detects the shell and exposes ONE object
// (`platform`) with net / storage / secureStore / fs / print / realtime. This is
// the only place allowed to know which shell we're on.
//
// Only the web adapter exists today. Tauri (Stage 12) and Capacitor (Stage 13)
// add their own modules here; until then native shells run the web adapter inside
// their webview (fetch/EventSource/localStorage all work there), so nothing breaks.
import webAdapter from './web';

function detect() {
  if (typeof window !== 'undefined') {
    if (window.__TAURI__ || window.__TAURI_INTERNALS__) return 'tauri';
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'capacitor';
  }
  return 'web';
}

const name = detect();

export const platform = { name, isNative: name !== 'web', ...webAdapter };
export default platform;
