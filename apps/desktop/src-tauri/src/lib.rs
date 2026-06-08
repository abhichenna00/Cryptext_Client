// src-tauri/src/lib.rs

mod app_path;
mod auth;
mod config;
mod conversations;
mod friends;
mod http_client;
mod ice;
mod local_db;
mod media;
mod mls;
mod profile;
mod session;
mod session_store;
mod sync;
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: None },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stderr,
                ))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = argv.iter().find(|arg| arg.starts_with("nshroud://")) {
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
            auth::get_ws_ticket,
            auth::get_user_id,
            auth::refresh_session,
            auth::confirm_sign_up,
            auth::get_websocket_url,
            ice::get_ice_servers,
            auth::sign_in_with_google,
            auth::sign_in_with_entra,
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
            conversations::fetch_new_messages,
            conversations::send_message,
            conversations::retry_pending_sends,
            conversations::mark_read,
            conversations::create_group,
            conversations::get_group_members,
            // Local encrypted message storage
            local_db::vault_status,
            local_db::setup_vault,
            local_db::unlock_vault,
            local_db::is_vault_unlocked,
            local_db::discard_and_reset_vault,
            local_db::get_local_messages,
            local_db::get_local_messages_after,
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
            // Media
            media::send_media,
            media::download_media,
            media::get_cached_media_path,
            // Profile
            profile::get_profile,
            profile::get_profiles_by_ids,
            profile::create_profile,
            profile::update_profile,
            profile::update_status,
            profile::upload_avatar,
            profile::generate_placeholder,
            profile::get_enterprise_prefill,
            // Session persistence (OS keyring)
            session::session_save,
            session::session_stored,
            session::session_restore,
            session::session_clear,
            // Sync (encrypted state backup)
            sync::sync_upload_vault,
            sync::sync_upload_mls_state,
            sync::sync_upload_messages_db,
            sync::sync_flush_backup,
            sync::sync_check_exists,
            sync::sync_download_vault,
            sync::sync_restore_mls_state,
            sync::sync_download_messages_db,
            sync::sync_recover_local_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
