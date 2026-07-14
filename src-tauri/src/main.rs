// AgriRice desktop host (Tauri v2). Intentionally thin: it just hosts the existing
// web bundle (../dist) in a native window. All business logic + offline sync lives
// in the web app, which runs unchanged in the webview. No secrets are embedded —
// the app talks to the same REST API with the user's JWT.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the AgriRice desktop app");
}
