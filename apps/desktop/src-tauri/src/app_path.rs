// src-tauri/src/app_path.rs

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Bundle of filesystem path helpers scoped to a specific authenticated user.
pub(crate) struct AppPaths {
    app_data: PathBuf,
    user_id: String,
}

impl AppPaths {
    /// Constructs an AppPaths for the given user, resolving the app data directory.
    pub(crate) fn new(app: &AppHandle, user_id: impl Into<String>) -> Result<Self, String> {
        Ok(Self {
            app_data: app_data_dir(app)?,
            user_id: user_id.into(),
        })
    }

    /// Creates the app data directory on disk if it doesn't already exist.
    pub(crate) fn ensure_dir_exists(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.app_data)
            .map_err(|e| format!("Failed to create app data dir: {}", e))
    }

    /// Path to the vault metadata file (v2 format: version marker + DEK fingerprint).
    pub(crate) fn vault(&self) -> PathBuf {
        self.app_data.join(format!("{}.vault", self.user_id))
    }

    /// Path to the SQLCipher-encrypted local message database.
    pub(crate) fn messages_db(&self) -> PathBuf {
        self.app_data.join(format!("messages_{}.db", self.user_id))
    }

    /// Path to the SQLite write-ahead log companion of the messages database.
    pub(crate) fn messages_db_wal(&self) -> PathBuf {
        self.app_data.join(format!("messages_{}.db-wal", self.user_id))
    }

    /// Path to the SQLite shared-memory companion of the messages database.
    pub(crate) fn messages_db_shm(&self) -> PathBuf {
        self.app_data.join(format!("messages_{}.db-shm", self.user_id))
    }

    /// Path to the legacy unencrypted message database used during migration to SQLCipher.
    pub(crate) fn messages_db_unencrypted(&self) -> PathBuf {
        self.app_data.join(format!("messages_{}.db.unencrypted", self.user_id))
    }

    /// Path to the encrypted OpenMLS storage state (signer key, group ratchets, KeyPackage privates).
    pub(crate) fn mls_state(&self) -> PathBuf {
        self.app_data.join(format!("mls_{}.json", self.user_id))
    }

    /// Path to the MLS metadata companion (signer public key, conversation-to-group_id mapping).
    pub(crate) fn mls_meta(&self) -> PathBuf {
        self.app_data.join(format!("mls_{}.meta.json", self.user_id))
    }
}

/// Returns the app data directory path.
pub(crate) fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))
}

/// Path to the encrypted refresh-token file.
pub(crate) fn session_file(app_data: &Path) -> PathBuf {
    app_data.join("session.enc")
}
