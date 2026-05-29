use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Shared payload ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagePayload {
    pub id: String,
    pub conversation_id: String,
    pub sender_id: String,
    pub timestamp: i64,
}

// ── Client → Server ──

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientMessage {
    Authenticate { token: String },
    NewMessage { message: MessagePayload },
    StatusUpdate { status: String },
    Ping,
    CallInvite { conversation_id: Uuid, sdp: String },
    CallAnswer { conversation_id: Uuid, sdp: String },
    CallDecline { conversation_id: Uuid, reason: Option<String> },
    CallEnd { conversation_id: Uuid },
    IceCandidate { conversation_id: Uuid, candidate: String },
}

// ── Server → Client ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ServerMessage {
    Authenticated { user_id: String },
    AuthError { error: String },
    NewMessage { message: MessagePayload },
    StatusUpdate { user_id: String, status: String },
    Pong,
    CallInvite {
        conversation_id: Uuid,
        sdp: String,
        from_user_id: Uuid,
        from_device_id: Option<Uuid>,
    },
    CallAnswer {
        conversation_id: Uuid,
        sdp: String,
        from_user_id: Uuid,
        from_device_id: Option<Uuid>,
    },
    CallDecline {
        conversation_id: Uuid,
        reason: Option<String>,
        from_user_id: Uuid,
        from_device_id: Option<Uuid>,
    },
    CallEnd {
        conversation_id: Uuid,
        from_user_id: Uuid,
        from_device_id: Option<Uuid>,
    },
    IceCandidate {
        conversation_id: Uuid,
        candidate: String,
        from_user_id: Uuid,
        from_device_id: Option<Uuid>,
    },
    CallAcceptedElsewhere { conversation_id: Uuid },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_call_invite_deserializes_from_snake_case() {
        let conv = Uuid::new_v4();
        let json = format!(
            r#"{{"action":"call_invite","conversation_id":"{}","sdp":"v=0..."}}"#,
            conv
        );
        let msg: ClientMessage = serde_json::from_str(&json).unwrap();
        match msg {
            ClientMessage::CallInvite { conversation_id, sdp } => {
                assert_eq!(conversation_id, conv);
                assert_eq!(sdp, "v=0...");
            }
            _ => panic!("expected CallInvite"),
        }
    }

    #[test]
    fn client_call_decline_accepts_missing_reason() {
        let conv = Uuid::new_v4();
        let json = format!(
            r#"{{"action":"call_decline","conversation_id":"{}"}}"#,
            conv
        );
        let msg: ClientMessage = serde_json::from_str(&json).unwrap();
        match msg {
            ClientMessage::CallDecline { conversation_id, reason } => {
                assert_eq!(conversation_id, conv);
                assert!(reason.is_none());
            }
            _ => panic!("expected CallDecline"),
        }
    }

    #[test]
    fn client_ice_candidate_roundtrips() {
        let conv = Uuid::new_v4();
        let json = format!(
            r#"{{"action":"ice_candidate","conversation_id":"{}","candidate":"candidate:1 ..."}}"#,
            conv
        );
        let msg: ClientMessage = serde_json::from_str(&json).unwrap();
        match msg {
            ClientMessage::IceCandidate { conversation_id, candidate } => {
                assert_eq!(conversation_id, conv);
                assert_eq!(candidate, "candidate:1 ...");
            }
            _ => panic!("expected IceCandidate"),
        }
    }

    #[test]
    fn server_call_invite_serializes_with_sender_attribution() {
        let conv = Uuid::new_v4();
        let from = Uuid::new_v4();
        let msg = ServerMessage::CallInvite {
            conversation_id: conv,
            sdp: "v=0...".to_string(),
            from_user_id: from,
            from_device_id: None,
        };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["action"], "call_invite");
        assert_eq!(json["conversation_id"], conv.to_string());
        assert_eq!(json["from_user_id"], from.to_string());
        assert_eq!(json["sdp"], "v=0...");
        assert!(json["from_device_id"].is_null());
    }

    #[test]
    fn server_call_accepted_elsewhere_has_only_conversation_id() {
        let conv = Uuid::new_v4();
        let msg = ServerMessage::CallAcceptedElsewhere { conversation_id: conv };
        let json: serde_json::Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["action"], "call_accepted_elsewhere");
        assert_eq!(json["conversation_id"], conv.to_string());
        assert!(json.get("from_user_id").is_none());
    }

    #[test]
    fn server_ice_candidate_roundtrips_through_serde() {
        let conv = Uuid::new_v4();
        let from = Uuid::new_v4();
        let original = ServerMessage::IceCandidate {
            conversation_id: conv,
            candidate: "candidate:1 ...".to_string(),
            from_user_id: from,
            from_device_id: None,
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: ServerMessage = serde_json::from_str(&json).unwrap();
        match parsed {
            ServerMessage::IceCandidate {
                conversation_id,
                candidate,
                from_user_id,
                from_device_id,
            } => {
                assert_eq!(conversation_id, conv);
                assert_eq!(candidate, "candidate:1 ...");
                assert_eq!(from_user_id, from);
                assert!(from_device_id.is_none());
            }
            _ => panic!("expected IceCandidate"),
        }
    }
}
