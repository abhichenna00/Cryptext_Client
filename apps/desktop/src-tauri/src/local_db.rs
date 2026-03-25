// src-tauri/src/local_db.rs

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

use crate::vault;

pub struct LocalDb {
    pub conn: Mutex<Option<Connection>>,
}

impl Default for LocalDb {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }
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
            ON messages (conversation_id, timestamp);",
    )
    .map_err(|e| format!("Failed to init schema: {}", e))
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

/// First-time setup: create vault with PIN and open encrypted database.
#[command]
pub fn setup_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    pin: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    std::fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create dir: {}", e))?;

    if vault::vault_exists(&app_data, &user_id) {
        return Err("Vault already exists for this user".to_string());
    }

    let dek = vault::create_vault(&app_data, &user_id, &pin)?;
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    // Migrate any existing unencrypted messages
    let unencrypted_path = app_data.join(format!("messages_{}.db.unencrypted", user_id));

    if unencrypted_path.exists() {
        let msgs = {
            let old_conn = Connection::open(&unencrypted_path)
                .map_err(|e| format!("Failed to open old DB for migration: {}", e))?;
            let mut stmt = old_conn.prepare(
                "SELECT id, conversation_id, sender_id, content, timestamp, content_type FROM messages"
            ).map_err(|e| format!("Failed to query old DB: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map([], |row| {
                    Ok(LocalMessage {
                        id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        sender_id: row.get(2)?,
                        content: row.get(3)?,
                        timestamp: row.get(4)?,
                        content_type: row.get(5)?,
                    })
                })
                .map_err(|e| format!("Failed to read old messages: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }; // old_conn dropped here

        for msg in &msgs {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO messages (id, conversation_id, sender_id, content, timestamp, content_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![msg.id, msg.conversation_id, msg.sender_id, msg.content, msg.timestamp, msg.content_type],
            );
        }
        let _ = std::fs::remove_file(&unencrypted_path);
    }

    let mut guard = local_db.conn.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(())
}

/// Unlock existing vault with PIN and open encrypted database.
#[command]
pub fn unlock_vault(
    app: AppHandle,
    local_db: State<'_, LocalDb>,
    user_id: String,
    pin: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let dek = vault::open_vault(&app_data, &user_id, &pin)?;
    let db_path = app_data.join(format!("messages_{}.db", user_id));
    let conn = open_encrypted_db(&db_path, &dek)?;
    init_schema(&conn)?;

    let mut guard = local_db.conn.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(())
}

/// Change the encryption PIN.
#[command]
pub fn change_pin(
    app: AppHandle,
    user_id: String,
    old_pin: String,
    new_pin: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    vault::change_pin(&app_data, &user_id, &old_pin, &new_pin)
}

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

    let mut guard = local_db.conn.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);
    Ok(())
}

pub fn store_message(db: &LocalDb, msg: &LocalMessage) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

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

pub fn store_messages(db: &LocalDb, msgs: &[LocalMessage]) -> Result<(), String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    for msg in msgs {
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
    }

    Ok(())
}

pub fn get_existing_message_ids(
    db: &LocalDb,
    conversation_id: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
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
) -> Result<Vec<LocalMessage>, String> {
    get_local_messages_inner(&local_db, &conversation_id, limit, before_timestamp)
}

pub fn get_local_messages_inner(
    db: &LocalDb,
    conversation_id: &str,
    limit: Option<u32>,
    before_timestamp: Option<i64>,
) -> Result<Vec<LocalMessage>, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Local DB not initialized")?;

    let limit = limit.unwrap_or(50);

    let mut messages = match before_timestamp {
        Some(before_ts) => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type
                     FROM messages
                     WHERE conversation_id = ?1 AND timestamp < ?2
                     ORDER BY timestamp DESC
                     LIMIT ?3",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map(params![conversation_id, before_ts, limit], |row| {
                    Ok(LocalMessage {
                        id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        sender_id: row.get(2)?,
                        content: row.get(3)?,
                        timestamp: row.get(4)?,
                        content_type: row.get(5)?,
                    })
                })
                .map_err(|e| format!("Failed to query: {}", e))?
                .filter_map(|r| r.ok())
                .collect();
            results
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, conversation_id, sender_id, content, timestamp, content_type
                     FROM messages
                     WHERE conversation_id = ?1
                     ORDER BY timestamp DESC
                     LIMIT ?2",
                )
                .map_err(|e| format!("Failed to prepare query: {}", e))?;

            let results: Vec<LocalMessage> = stmt
                .query_map(params![conversation_id, limit], |row| {
                    Ok(LocalMessage {
                        id: row.get(0)?,
                        conversation_id: row.get(1)?,
                        sender_id: row.get(2)?,
                        content: row.get(3)?,
                        timestamp: row.get(4)?,
                        content_type: row.get(5)?,
                    })
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
