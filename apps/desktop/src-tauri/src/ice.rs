// src-tauri/src/ice.rs
//
// Fetches ICE servers (STUN + short-lived TURN credentials) from the server so
// WebRTC calls can traverse NAT. TURN credentials are time-limited, so the
// frontend calls this fresh before each call.

use serde::{Deserialize, Serialize};
use tauri::{command, State};

use crate::auth::SessionStore;
use crate::http_client::AuthorizedClient;

#[derive(Deserialize, Serialize)]
struct IceServersResponse {
    ice_servers: serde_json::Value,
}

/// Return the ICE server list (as the array RTCPeerConnection expects) from the
/// server's `/config/ice-servers` endpoint. Authenticated — the server gates
/// TURN relay credentials on a valid session.
#[command]
pub async fn get_ice_servers(
    session_store: State<'_, SessionStore>,
) -> Result<serde_json::Value, String> {
    let client = AuthorizedClient::from_session(&session_store)?;
    let resp: IceServersResponse = client.get("/config/ice-servers").await?;
    Ok(resp.ice_servers)
}
