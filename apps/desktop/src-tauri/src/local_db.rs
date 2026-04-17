// src-tauri/src/local_db.rs

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};
use zeroize::Zeroizing;

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
        .map_err(|_| "Invalid PIN — could not unlock database".to_string())?;

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
        );",
    )
    .map_err(|e| format!("Failed to init schema: {}", e))
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
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    let mut guard = local_db.conn.lock_or_err()?;
    *guard = Some(conn);
    let mut dek_guard = local_db.dek.lock_or_err()?;
    *dek_guard = Some(dek);
    Ok(())
}

/// Check if a vault (encryption PIN) has been set up for this user.
#[command]
pub fn has_vault(
    app: AppHandle,
    user_id: String,
) -> Result<bool, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(vault::vault_exists(&app_data, &user_id))
}

/// First-time setup: create vault with password and open encrypted database.
#[command]
pub fn setup_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    password: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create dir: {}", e))?;

    if vault::vault_exists(&app_data, &user_id) {
        return Err("Vault already exists for this user".to_string());
    }

    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let unencrypted_path = app_data.join(format!("messages_{}.db.unencrypted", user_id));
    if db_path.exists() && !unencrypted_path.exists() {
        std::fs::rename(&db_path, &unencrypted_path)
            .map_err(|e| format!("Failed to rename old DB for migration: {}", e))?;
        let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-wal", user_id)));
        let _ = std::fs::remove_file(app_data.join(format!("messages_{}.db-shm", user_id)));
    }

    let dek = vault::create_vault(&app_data, &user_id, &password)?;
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    if unencrypted_path.exists() {
        let msgs = {
            let old_conn = Connection::open(&unencrypted_path)
                .map_err(|e| format!("Failed to open old DB for migration: {}", e))?;
            let mut stmt = old_conn.prepare(
                "SELECT id, conversation_id, sender_id, content, timestamp, content_type FROM messages"
            ).map_err(|e| format!("Failed to query old DB: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map([], |row| {
                    local_message_from_row(row)
                })
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

/// Unlock vault with password (used on new device or first login).
#[command]
pub fn unlock_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    secret: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dek = vault::open_vault(&app_data, &user_id, &secret)?;
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    let mut guard = local_db.conn.lock_or_err()?;
    *guard = Some(conn);
    let mut dek_guard = local_db.dek.lock_or_err()?;
    *dek_guard = Some(dek);
    Ok(())
}

// PIN / multi-method commands — disabled for now. Vault is unlocked by
// password only. Re-enable if we reintroduce a PIN or additional unlock method.
/*
/// Ensure the "password" method exists in the vault (handles legacy migration).
#[command]
pub fn ensure_password_method(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    password: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let methods = vault::available_methods(&app_data, &user_id)?;
    if methods.contains(&"password".to_string()) {
        return Ok(());
    }

    let dek_guard = local_db.dek.lock_or_err()?;
    let dek = dek_guard.ok_or("Vault not unlocked")?;

    let path = vault::vault_path(&app_data, &user_id);
    let entry = vault::create_wrapped_key_pub(password.as_bytes(), &dek)?;
    vault::add_method(&app_data, &user_id, "password", entry)
}

/// Add a PIN convenience unlock method. Requires vault to be already unlocked (DEK in memory).
#[command]
pub fn add_pin(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    pin: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dek_guard = local_db.dek.lock_or_err()?;
    let dek = dek_guard.ok_or("Vault not unlocked")?;
    vault::add_pin_method(&app_data, &user_id, &dek, &pin)
}
*/

/// Change the password. Re-wraps DEK with new password-derived KEK.
#[command]
pub fn change_password(
    app: AppHandle,
    user_id: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    vault::change_password(&app_data, &user_id, &old_password, &new_password)
}

/*
/// Change the PIN. Requires vault to be already unlocked (DEK in memory).
#[command]
pub fn change_pin(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    new_pin: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dek_guard = local_db.dek.lock_or_err()?;
    let dek = dek_guard.ok_or("Vault not unlocked")?;
    vault::change_pin(&app_data, &user_id, &dek, &new_pin)
}
*/

/// Check if the vault is currently unlocked (DEK in session memory).
#[command]
pub fn is_vault_unlocked(
    local_db: State<'_, LocalDb>,
) -> Result<bool, String> {
    let guard = local_db.dek.lock_or_err()?;
    Ok(guard.is_some())
}

/*
/// Check which unlock methods are available for this user's vault.
#[command]
pub fn vault_methods(
    app: AppHandle,
    user_id: String,
) -> Result<Vec<String>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    vault::available_methods(&app_data, &user_id)
}
*/

/// Legacy init for unencrypted DB — renamed to prepare for migration.
#[command]
pub fn init_local_db(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create dir: {}", e))?;

    // If vault exists, user needs to unlock with PIN instead
    if vault::vault_exists(&app_data, &user_id) {
        return Err("Vault exists — use unlock_vault with PIN".to_string());
    }

    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn =
        Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;",
    )
    .map_err(|e| format!("Failed to set pragmas: {}", e))?;

    init_schema(&conn)?;

    let mut guard = local_db.conn.lock_or_err()?;
    *guard = Some(conn);
    Ok(())
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
