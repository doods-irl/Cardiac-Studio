// Prevents extra console on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Cache-buster: touching any line in this file invalidates cargo's
// incremental cache for the crate and forces a full rebuild on next
// `tauri:dev`. Needed after CSP / capability edits in tauri.conf.json
// or capabilities/*.json — `tauri_build` tracks those files, but the
// CSP header is known to silently miss regeneration with incremental
// builds. Bump: 1.
mod format;
mod project;
mod assets;
mod export;

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            app_version,
            project::new_project,
            project::open_project,
            project::save_project,
            project::autosave_project,
            project::list_backups,
            project::restore_backup,
            assets::import_image,
            assets::import_font,
            assets::list_assets,
            assets::remove_asset,
            export::export_card_png,
            export::export_deck_pngs,
            export::export_deck_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cardiac");
}
