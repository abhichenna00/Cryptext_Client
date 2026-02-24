// src-tauri/src/lib.rs

mod auth;
mod config;

pub use auth::{
    confirm_sign_up, get_auth_token, get_session, get_user_id, get_websocket_url,
    refresh_session, sign_in, sign_out, sign_up, sync_oauth_session, SessionStore,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env from project root (parent of src-tauri)
    let parent_env = std::path::Path::new("../.env");
    if parent_env.exists() {
        dotenvy::from_path(parent_env).ok();
    } else {
        dotenvy::dotenv().ok();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            println!("Single instance triggered with args: {:?}", argv);

            if let Some(url) = argv.iter().find(|arg| arg.starts_with("cryptex://")) {
                println!("Deep link URL: {}", url);
                use tauri::Emitter;
                let _ = app.emit("deep-link", url);
            }

            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(SessionStore::default())
        .invoke_handler(tauri::generate_handler![
            sign_in,
            sign_up,
            sign_out,
            get_session,
            get_auth_token,
            get_user_id,
            refresh_session,
            sync_oauth_session,
            confirm_sign_up,
            get_websocket_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}