// src-tauri/src/lib.rs

mod auth;
mod config;
mod conversations;
mod friends;
mod http_client;
mod local_db;
mod mls;
mod profile;
mod sync_utils;
mod updates;
mod vault;

pub use auth::SessionStore;
pub use local_db::LocalDb;
pub use mls::MlsState;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        .manage(MlsState::default())
        .manage(LocalDb::default())
        .invoke_handler(tauri::generate_handler![
            // Updates
            updates::check_for_updates,
            updates::install_update,
            // Auth
            auth::sign_in,
            auth::sign_up,
            auth::sign_out,
            auth::get_session,
            auth::get_auth_token,
            auth::get_user_id,
            auth::refresh_session,
            auth::sync_oauth_session,
            auth::confirm_sign_up,
            auth::get_websocket_url,
            auth::sign_in_with_google,
            // Friends
            friends::get_friends,
            friends::get_incoming_friend_requests,
            friends::get_outgoing_friend_requests,
            friends::send_friend_request,
            friends::accept_friend_request,
            friends::decline_friend_request,
            friends::cancel_friend_request,
            friends::remove_friend,
            // Conversations
            conversations::get_conversations,
            conversations::get_or_create_dm,
            conversations::get_messages,
            conversations::send_message,
            conversations::mark_read,
            // Local encrypted message storage
            local_db::has_vault,
            local_db::setup_vault,
            local_db::unlock_vault,
            local_db::change_pin,
            local_db::init_local_db,
            local_db::get_local_messages,
            local_db::store_decrypted_message,
            // MLS (E2E Encryption)
            mls::mls_init,
            mls::mls_upload_key_packages,
            mls::mls_delete_key_packages,
            mls::mls_check_key_packages,
            mls::mls_create_group,
            mls::mls_encrypt_message,
            mls::mls_decrypt_message,
            mls::mls_fetch_welcomes,
            mls::mls_has_group,
            // Profile
            profile::get_profile,
            profile::get_profiles_by_ids,
            profile::create_profile,
            profile::update_profile,
            profile::update_status,
            profile::upload_avatar,
            profile::generate_placeholder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}