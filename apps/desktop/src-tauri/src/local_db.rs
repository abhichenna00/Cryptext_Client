// src-tauri/src/local_db.rs

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::session;
use crate::sync_utils::MutexExt;
use crate::vault;

pub struct LocalDb {
    pub conn: Mutex<Option<Connection>>,
    // Wrapped in Zeroizing so the key bytes are wiped when the slot is
    // replaced or the process drops the struct. Prevents the DEK from
    // lingering in freed memory after sign-out or app exit.
    pub dek: Mutex<Option<Zeroizing<[u8; 32]>>>,
}

impl Default for LocalDb {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            dek: Mutex::new(None),
        }
    }
}

/// Drop the encrypted DB connection and wipe the DEK. Used on sign-out so
/// the vault is no longer accessible in-process until next unlock.
pub(crate) fn clear_vault_state(local_db: &State<'_, LocalDb>) -> Result<(), String> {
    let mut conn_guard = local_db.conn.lock_or_err()?;
    *conn_guard = None;
    let mut dek_guard = local_db.dek.lock_or_err()?;
    *dek_guard = None;
    Ok(())
}

/// Open a SQLCipher database with the given DEK.
fn open_encrypted_db(db_path: &Path, dek: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Pass raw hex key to SQLCipher — skips its internal PBKDF2
    let hex_key = format!("x'{}'", hex::encode(dek));
    conn.pragma_update(None, "key", &hex_key)
        .map_err(|e| format!("Failed to set encryption key: {}", e))?;

    // Verify the key works by reading a page
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| "Could not unlock database — DEK does not match".to_string())?;

    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;",
    )
    .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    Ok(conn)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalMessage {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub content: String,
    pub timestamp: i64,
    pub content_type: String,
}

fn local_message_from_row(row: &rusqlite::Row) -> rusqlite::Result<LocalMessage> {
    Ok(LocalMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        sender_id: row.get(2)?,
        content: row.get(3)?,
        timestamp: row.get(4)?,
        content_type: row.get(5)?,
    })
}

/// Durable outbox row for messages whose ciphertext has been generated
/// (ratchet already advanced) but whose server ACK has not yet been seen.
/// Retried via `retry_pending_sends`; deleted once the server confirms.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingSend {
    pub client_message_id: String,
    pub conversation_id: String,
    pub content_type: String,
    pub ciphertext: Vec<u8>,
    pub welcome_data: Option<Vec<u8>>,
    pub plaintext: String,
    pub other_user_id: Option<String>,
    pub created_at: i64,
    pub attempts: i64,
    pub last_error: Option<String>,
}

fn pending_send_from_row(row: &rusqlite::Row) -> rusqlite::Result<PendingSend> {
    Ok(PendingSend {
        client_message_id: row.get(0)?,
        conversation_id: row.get(1)?,
        content_type: row.get(2)?,
        ciphertext: row.get(3)?,
        welcome_data: row.get(4)?,
        plaintext: row.get(5)?,
        other_user_id: row.get(6)?,
        created_at: row.get(7)?,
        attempts: row.get(8)?,
        last_error: row.get(9)?,
    })
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'plaintext'
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp
            ON messages (conversation_id, timestamp);
        CREATE TABLE IF NOT EXISTS media_cache (
            message_id TEXT NOT NULL,
            is_thumbnail INTEGER NOT NULL DEFAULT 0,
            local_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            cached_at INTEGER NOT NULL,
            PRIMARY KEY (message_id, is_thumbnail)
        );
        CREATE TABLE IF NOT EXISTS pending_sends (
            client_message_id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            content_type TEXT NOT NULL,
            ciphertext BLOB NOT NULL,
            welcome_data BLOB,
            plaintext TEXT NOT NULL,
            other_user_id TEXT,
            created_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pending_sends_created_at
            ON pending_sends (created_at);",
    )
    .map_err(|e| format!("Failed to init schema: {}", e))
}

fn mount_dek_inner(
    app_data: &Path,
    local_db: &State<'_, LocalDb>,
    user_id: &str,
    dek: Zeroizing<[u8; 32]>,
) -> Result<(), String> {
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    let mut guard = local_db.conn.lock_or_err()?;
    *guard = Some(conn);
    let mut dek_guard = local_db.dek.lock_or_err()?;
    *dek_guard = Some(dek);
    Ok(())
}

/// Mount a recovered DEK into LocalDb: open the encrypted DB, init schema,
/// stash the connection and DEK in state. Used by session restore when the
/// DEK comes from the OS keyring instead of password-derived unlock.
pub(crate) fn mount_dek(
    app_data: &Path,
    local_db: &State<'_, LocalDb>,
    user_id: &str,
    dek: Zeroizing<[u8; 32]>,
) -> Result<(), String> {
    mount_dek_inner(app_data, local_db, user_id, dek)
}

/// Status of the on-disk vault for a given user.
#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "PascalCase")]
pub enum VaultStatus {
    /// No vault file on disk for this user.
    None,
    /// Vault file on disk; the DEK is in the OS keyring but not yet mounted
    /// in process memory (or the keyring entry is missing/wrong, in which
    /// case the unlock path will surface a loud error).
    Locked,
    /// Vault is mounted and the DEK is in process memory.
    Unlocked,
}

fn compute_vault_status(
    app_data: &Path,
    local_db: &State<'_, LocalDb>,
    user_id: &str,
) -> Result<VaultStatus, String> {
    if !vault::vault_exists(app_data, user_id) {
        return Ok(VaultStatus::None);
    }
    // Unlocked requires both an in-memory DEK *and* a fingerprint match
    // against the on-disk vault. A mismatch means the mounted DEK doesn't
    // belong to this vault — report Locked so the unlock path runs and
    // surfaces a loud failure to the user instead of letting downstream
    // code silently operate on the wrong DB.
    let dek_guard = local_db.dek.lock_or_err()?;
    if let Some(dek) = dek_guard.as_ref() {
        if vault::verify_fingerprint(app_data, user_id, dek).is_ok() {
            return Ok(VaultStatus::Unlocked);
        }
    }
    Ok(VaultStatus::Locked)
}

/// Inspect the on-disk vault and in-memory state to tell the frontend what
/// flow to take next (fresh setup, migrate, unlock from keyring, or already
/// good to go).
#[command]
pub fn vault_status(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
) -> Result<VaultStatus, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    compute_vault_status(&app_data, &local_db, &user_id)
}

/// Create a fresh v2 vault and mount the encrypted DB. Used on first
/// sign-up or first sign-in for any auth method (password, Google, Entra)
/// when no prior vault exists.
#[command]
pub fn setup_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
) -> Result<(), String> {
    log::info!("setup_vault: invoked for user_id={}", user_id);
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create dir: {}", e))?;

    if vault::vault_exists(&app_data, &user_id) {
        log::warn!("setup_vault: vault file already exists for user_id={}", user_id);
        return Err("Vault already exists for this user".to_string());
    }

    // If a stray unencrypted DB was left behind by a much older build, set it
    // aside so the new SQLCipher-encrypted DB can take its place. Migrating
    // those rows is best-effort.
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let unencrypted_path = app_data.join(format!("messages_{}.db.unencrypted", user_id));
    if db_path.exists() && !unencrypted_path.exists() {
        std::fs::rename(&db_path, &unencrypted_path)
            .map_err(|e| format!("Failed to rename old DB for migration: {}", e))?;
        let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-wal", user_id)));
        let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-shm", user_id)));
    }

    let dek = vault::create_vault(&app_data, &user_id)?;
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    if unencrypted_path.exists() {
        let msgs = {
            let old_conn = Connection::open(&unencrypted_path)
                .map_err(|e| format!("Failed to open old DB for migration: {}", e))?;
            let mut stmt = old_conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type FROM messages",
                )
                .map_err(|e| format!("Failed to query old DB: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map([], |row| local_message_from_row(row))
                .map_err(|e| format!("Failed to read old messages: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        };

        for msg in &msgs {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO messages (id, conversation_id, sender_id, content, timestamp, content_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![msg.id, msg.conversation_id, msg.sender_id, msg.content, msg.timestamp, msg.content_type],
            );
        }
        let _ = std::fs::remove_file(&unencrypted_path);
    }

    let mut guard = local_db.conn.lock_or_err()?;
    *guard = Some(conn);
    let mut dek_guard = local_db.dek.lock_or_err()?;
    *dek_guard = Some(dek);
    Ok(())
}

/// Mount an existing vault using the DEK already stored in the OS keyring.
/// Returns Err if there is no vault on disk, the keyring entry is missing
/// or the stored user_id doesn't match, or the keyring DEK's fingerprint
/// doesn't match the on-disk vault — the frontend should route to the
/// login screen on any of those.
#[command]
pub fn unlock_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
) -> Result<(), String> {
    log::info!("unlock_vault: invoked for user_id={}", user_id);
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    if !vault::vault_exists(&app_data, &user_id) {
        log::warn!("unlock_vault: no vault file on disk for user_id={}", user_id);
        return Err("No vault on disk for this user".to_string());
    }

    let dek = session::load_dek_for_user(&user_id)?.ok_or_else(|| {
        log::error!(
            "unlock_vault: keyring entry missing for user_id={} — vault file exists but no DEK",
            user_id
        );
        "Keyring entry missing — cannot unlock vault".to_string()
    })?;
    vault::verify_fingerprint(&app_data, &user_id, &dek)?;
    log::info!("unlock_vault: SUCCESS for user_id={}", user_id);
    mount_dek_inner(&app_data, &local_db, &user_id, dek)
}

/// Check if the vault is currently unlocked (DEK in session memory).
#[command]
pub fn is_vault_unlocked(local_db: State<'_, LocalDb>) -> Result<bool, String> {
    let guard = local_db.dek.lock_or_err()?;
    Ok(guard.is_some())
}

/// Wipe local message DB and MLS state, then write a fresh vault. Used
/// by the "Discard local history" migration choice. The fresh vault is
/// written first via the atomic helper; only if that succeeds do we delete
/// the old DB / MLS state. A write failure aborts cleanly with the user's
/// previous state intact.
#[command]
pub fn discard_and_reset_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create dir: {}", e))?;

    // Drop in-memory state first so we don't leave a stale connection pointing
    // at a file we're about to delete.
    {
        let mut conn_guard = local_db.conn.lock_or_err()?;
        *conn_guard = None;
        let mut dek_guard = local_db.dek.lock_or_err()?;
        *dek_guard = None;
    }

    // Atomically replace the existing vault with a fresh v2 keyed to a new
    // random DEK. write_v2_file does temp+rename, so the user's old vault
    // file remains intact if this fails (disk full, permissions, etc.) and
    // they can retry.
    let dek = vault::create_vault(&app_data, &user_id)?;

    // Vault is now in place — safe to drop the old SQLCipher DB and MLS
    // state. Their keys derived from the discarded DEK so they would no
    // longer decrypt anyway.
    let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db", user_id)));
    let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-wal", user_id)));
    let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-shm", user_id)));
    let _ = std::fs::remove_file(app_data.join(format!("mls_{}.json", user_id)));
    let _ = std::fs::remove_file(app_data.join(format!("mls_{}.meta.json", user_id)));

    mount_dek_inner(&app_data, &local_db, &user_id, dek)
}

fn insert_message(conn: &rusqlite::Connection, msg: &LocalMessage) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO messages (id, conversation_id, sender_id, content, timestamp, content_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            msg.id,
            msg.conversation_id,
            msg.sender_id,
            msg.content,
            msg.timestamp,
            msg.content_type,
        ],
    )
    .map_err(|e| format!("Failed to store message: {}", e))?;
    Ok(())
}

pub fn store_message(db: &LocalDb, msg: &LocalMessage) -> Result<(), String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;
    insert_message(conn, msg)
}

pub fn store_messages(db: &LocalDb, msgs: &[LocalMessage]) -> Result<(), String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;
    for msg in msgs {
        insert_message(conn, msg)?;
    }
    Ok(())
}

pub fn get_latest_timestamp(
    db: &LocalDb,
    conversation_id: &str,
) -> Result<Option<i64>, String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let result: Option<i64> = conn
        .query_row(
            "SELECT MAX(timestamp) FROM messages WHERE conversation_id = ?1",
            params![conversation_id],
            |row| row.get(0),
        )
        .ok()
        .flatten();

    Ok(result)
}

/// Return the most recent stored (decrypted) message per conversation, for
/// the given ids. Used to render sidebar previews — the server only has the
/// `[encrypted]` placeholder, so last-message text lives here.
pub fn get_latest_messages_for_conversations(
    db: &LocalDb,
    conversation_ids: &[String],
) -> Result<std::collections::HashMap<String, LocalMessage>, String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, sender_id, content, timestamp, content_type
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY timestamp DESC, id DESC
             LIMIT 1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut result = std::collections::HashMap::new();
    for cid in conversation_ids {
        if let Ok(row) = stmt.query_row(params![cid], local_message_from_row) {
            result.insert(cid.clone(), row);
        }
    }
    Ok(result)
}

pub fn get_existing_message_ids(
    db: &LocalDb,
    conversation_id: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let mut stmt = conn
        .prepare("SELECT id FROM messages WHERE conversation_id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let ids = stmt
        .query_map(params![conversation_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(ids)
}

/// Persist an outbox row for an encrypted-but-not-yet-acked message. Must be
/// called BEFORE the HTTP POST so a crash mid-flight leaves the ciphertext
/// recoverable — the MLS ratchet has already advanced and re-encrypting the
/// same plaintext would yield different bytes.
pub fn insert_pending_send(db: &LocalDb, row: &PendingSend) -> Result<(), String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;
    conn.execute(
        "INSERT INTO pending_sends (
            client_message_id, conversation_id, content_type, ciphertext,
            welcome_data, plaintext, other_user_id, created_at, attempts, last_error
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            row.client_message_id,
            row.conversation_id,
            row.content_type,
            row.ciphertext,
            row.welcome_data,
            row.plaintext,
            row.other_user_id,
            row.created_at,
            row.attempts,
            row.last_error,
        ],
    )
    .map_err(|e| format!("Failed to insert pending send: {}", e))?;
    Ok(())
}

pub fn delete_pending_send(db: &LocalDb, client_message_id: &str) -> Result<(), String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;
    conn.execute(
        "DELETE FROM pending_sends WHERE client_message_id = ?1",
        params![client_message_id],
    )
    .map_err(|e| format!("Failed to delete pending send: {}", e))?;
    Ok(())
}

pub fn list_pending_sends(
    db: &LocalDb,
    conversation_id: Option<&str>,
) -> Result<Vec<PendingSend>, String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let rows: Vec<PendingSend> = match conversation_id {
        Some(cid) => {
            let mut stmt = conn
                .prepare(
                    "SELECT client_message_id, conversation_id, content_type, ciphertext,
                            welcome_data, plaintext, other_user_id, created_at, attempts, last_error
                     FROM pending_sends
                     WHERE conversation_id = ?1
                     ORDER BY created_at ASC",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let results: Vec<PendingSend> = stmt
                .query_map(params![cid], pending_send_from_row)
                .map_err(|e| format!("Failed to query pending sends: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT client_message_id, conversation_id, content_type, ciphertext,
                            welcome_data, plaintext, other_user_id, created_at, attempts, last_error
                     FROM pending_sends
                     ORDER BY created_at ASC",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let results: Vec<PendingSend> = stmt
                .query_map([], pending_send_from_row)
                .map_err(|e| format!("Failed to query pending sends: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
    };

    Ok(rows)
}

pub fn increment_pending_send_attempt(
    db: &LocalDb,
    client_message_id: &str,
    error_msg: Option<&str>,
) -> Result<(), String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;
    conn.execute(
        "UPDATE pending_sends
         SET attempts = attempts + 1, last_error = ?2
         WHERE client_message_id = ?1",
        params![client_message_id, error_msg],
    )
    .map_err(|e| format!("Failed to update pending send attempt: {}", e))?;
    Ok(())
}

#[command]
pub fn get_local_messages(
    local_db: State<'_, LocalDb>,
    conversation_id: String,
    limit: Option<u32>,
    before_timestamp: Option<i64>,
    before_id: Option<String>,
) -> Result<Vec<LocalMessage>, String> {
    get_local_messages_inner(&local_db, &conversation_id, limit, before_timestamp, before_id.as_deref())
}

pub fn get_local_messages_inner(
    db: &LocalDb,
    conversation_id: &str,
    limit: Option<u32>,
    before_timestamp: Option<i64>,
    before_id: Option<&str>,
) -> Result<Vec<LocalMessage>, String> {
    let guard = db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let limit = limit.unwrap_or(50);

    let mut messages = match (before_timestamp, before_id) {
        (Some(before_ts), Some(b_id)) => {
            // Composite cursor: messages strictly before (timestamp, id) to avoid
            // skipping or duplicating rows that share the same timestamp.
            let mut stmt = conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type
                     FROM messages
                     WHERE conversation_id = ?1
                       AND (timestamp < ?2 OR (timestamp = ?2 AND id < ?3))
                     ORDER BY timestamp DESC, id DESC
                     LIMIT ?4",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map(params![conversation_id, before_ts, b_id, limit], |row| {
                    local_message_from_row(row)
                })
                .map_err(|e| format!("Failed to query: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
        (Some(before_ts), None) => {
            // Backwards-compatible: timestamp-only cursor
            let mut stmt = conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type
                     FROM messages
                     WHERE conversation_id = ?1 AND timestamp < ?2
                     ORDER BY timestamp DESC, id DESC
                     LIMIT ?3",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map(params![conversation_id, before_ts, limit], |row| {
                    local_message_from_row(row)
                })
                .map_err(|e| format!("Failed to query: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
        _ => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type
                     FROM messages
                     WHERE conversation_id = ?1
                     ORDER BY timestamp DESC, id DESC
                     LIMIT ?2",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map(params![conversation_id, limit], |row| {
                    local_message_from_row(row)
                })
                .map_err(|e| format!("Failed to query: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
    };

    // Reverse so oldest first
    messages.reverse();
    Ok(messages)
}

/// Read messages with timestamp strictly greater than `after_timestamp`,
/// ordered chronologically. Used by chat pages to pick up new messages
/// after `fetch_new_messages` may have returned empty due to a race with
/// another subscriber that won the decrypt mutex first.
#[command]
pub fn get_local_messages_after(
    local_db: State<'_, LocalDb>,
    conversation_id: String,
    after_timestamp: i64,
    limit: Option<u32>,
) -> Result<Vec<LocalMessage>, String> {
    let guard = local_db.conn.lock_or_err()?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let limit = limit.unwrap_or(100);

    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, sender_id, content, timestamp, content_type
             FROM messages
             WHERE conversation_id = ?1 AND timestamp > ?2
             ORDER BY timestamp ASC, id ASC
             LIMIT ?3",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let results: Vec<LocalMessage> = stmt
        .query_map(params![conversation_id, after_timestamp, limit], |row| {
            local_message_from_row(row)
        })
        .map_err(|e| format!("Failed to query: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(results)
}

#[command]
pub fn store_decrypted_message(
    local_db: State<'_, LocalDb>,
    id: String,
    conversation_id: String,
    sender_id: String,
    content: String,
    timestamp: i64,
    content_type: Option<String>,
) -> Result<(), String> {
    let msg = LocalMessage {
        id,
        conversation_id,
        sender_id,
        content,
        timestamp,
        content_type: content_type.unwrap_or_else(|| "plaintext".to_string()),
    };
    store_message(&local_db, &msg)
}
