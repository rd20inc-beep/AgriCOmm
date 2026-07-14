# AgriRice Desktop (Tauri)

A thin native shell that hosts the existing web app (`../dist`) in a desktop
window. All offline capability (precache, local DB, outbox, sync) comes from the
web bundle unchanged — this shell adds no business logic and embeds no secrets.

## Build

The Windows `.msi` is built by the **Build Windows Desktop (Tauri)** GitHub
Actions workflow (`.github/workflows/tauri-windows.yml`) — run it via *Actions →
Run workflow*, or push a `desktop-v*` tag. It builds on a Windows runner (Rust +
WebView2) and uploads the installer artifact.

Local build (on a machine with Rust + the platform WebView installed):

    VITE_API_URL=https://agricommodities.online npx @tauri-apps/cli@2 build

## Notes / follow-ups
- The installer is currently **unsigned**. For a signed `.msi`, add a code-signing
  certificate secret and the `tauri-action` signing inputs.
- Encrypted local storage (SQLCipher) + auto-update + a Tauri-native platform
  adapter (OS keychain / filesystem / print) are follow-ups; today the app uses
  the browser storage that already works inside the webview.
