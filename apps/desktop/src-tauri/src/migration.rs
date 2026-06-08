// src-tauri/src/migration.rs
//
// One-time startup migrations that port a pre-rebrand install onto the current
// bundle identifier. The NShroud rebrand changed the identifier from
// `cryptex.app.com` to `com.nshroud.app`, which moves Tauri's app-data directory
// (the keyring service name is handled separately in session.rs). Without this,
// an existing user's vault, message DB, and MLS state are stranded in the old
// directory and the app treats them as a brand-new user.

use std::path::Path;

use tauri::{AppHandle, Manager};

/// Pre-rebrand bundle identifiers whose app-data directory should be ported into
/// the current one. New installs have no such directory, so this is a no-op.
const LEGACY_IDENTIFIERS: &[&str] = &["cryptex.app.com"];

/// Copy user-data files from a legacy app-data directory into the current one.
/// Idempotent and non-destructive: a file already present in the current
/// directory is never overwritten, and the legacy directory is left in place.
/// Best-effort — failures are logged, never fatal, so launch always proceeds.
pub(crate) fn migrate_legacy_app_data(app: &AppHandle) {
    let current = match app.path().app_data_dir() {
        Ok(p) => p,
        Err(e) => {
            log::warn!("migration: could not resolve app data dir: {}", e);
            return;
        }
    };
    let base = match current.parent().map(Path::to_path_buf) {
        Some(b) => b,
        None => return,
    };

    for legacy_id in LEGACY_IDENTIFIERS {
        let legacy = base.join(legacy_id);
        if legacy == current || !legacy.is_dir() {
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&current) {
            log::warn!("migration: could not create app data dir: {}", e);
            return;
        }
        let entries = match std::fs::read_dir(&legacy) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("migration: could not read legacy dir '{}': {}", legacy_id, e);
                continue;
            }
        };
        let mut copied = 0u32;
        for entry in entries.flatten() {
            let path = entry.path();
            // Only top-level files (vault, message DB + SQLite companions, MLS
            // state, session.enc). Skip subdirectories such as webview caches.
            if !path.is_file() {
                continue;
            }
            let dest = current.join(entry.file_name());
            if dest.exists() {
                continue; // never clobber data already in the current dir
            }
            match std::fs::copy(&path, &dest) {
                Ok(_) => copied += 1,
                Err(e) => {
                    log::warn!("migration: failed to copy {:?}: {}", entry.file_name(), e)
                }
            }
        }
        if copied > 0 {
            log::info!(
                "migration: ported {} file(s) from legacy app-data '{}' onto the current identifier",
                copied,
                legacy_id
            );
        }
    }
}
