# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Voice and video calling between users — peer-to-peer WebRTC with a call modal, an in-call overlay, and start-call buttons on the DM page. Call state is managed by an app-wide `CallProvider`; signaling (offer, answer, ICE candidates, hangup) is carried over the existing WebSocket connection.
- Audio & Video settings section in the profile dialog — device pickers for camera, microphone, and speaker, persisted user preferences, and an in-app media-permissions diagnostic.
- Live-updating conversation list — the home sidebar now reflects new messages, new conversations, and unread counts in real time over WebSocket, without requiring a refresh.
- Per-conversation unread counts — server-side count of unseen messages is returned in the conversation-list response and rendered as a badge on each sidebar row; the badge clears when the conversation is opened.
- Idempotent message sends — each outgoing message carries a `client_message_id`; the server collapses repeated submissions to the same logical message, and the desktop client persists an outbox so in-flight sends survive an app restart.
- NShroud marketing website (`apps/web/`) — Astro + React landing and changelog pages, with the changelog sourced from this file at build time.

### Changed
- WebSocket connection lifted to an App-level provider — a single socket per session is shared across pages, replacing the previous per-page hook instances.
- NShroud mark — the slatted-N logo is now an inline React component (recolorable gradient + knockout N), and replaces the previous icon in the favicon, splash screen, auth header, and sidebar.
- Server shares a single S3 client across handlers via `OnceCell`, avoiding a fresh AWS client and connection pool on every avatar/media request.
- Group member inserts batched via Postgres `UNNEST` — a single query replaces the per-row loop on group creation, cutting round-trips for larger groups.
- `accept_friend_request` wrapped in a transaction — the row update and friendship insert now succeed or fail together; previously a crash between the two could leave a half-accepted request.
- Conversation `updated_at` write failures are surfaced as warnings instead of silently swallowed.
- Removed the unused `sync_oauth_session` command, the stale `pending_welcomes` cleanup path with its swallowed errors, and the legacy plaintext-MLS-state migration.
- Sidebar message rows now group consecutive messages from the same sender without gaps, and grid rows no longer stretch to inherited line-height.
- Chat pages fetch only new messages when opening a conversation, instead of refetching the whole history.

### Fixed
- MLS decrypt loop and the local message store are now kept in lockstep — read errors during decryption are surfaced instead of silently dropped, and the two no longer drift apart on partial failures.
- Chat-page render race when the sidebar finishes decrypting before the chat page mounts — the chat page now re-reads from the local DB after fetch, so the new messages appear.
- Sidebar pushes now decrypt inbound messages on receipt, so the preview text and unread count update without opening the conversation.
- Clicking a conversation row in the sidebar now clears its unread badge immediately.
- `register_group` no longer leaks `creator_id` back in the response.

### Security
- WebSocket connections now authenticate with a short-lived, single-use ticket fetched over HTTPS — replaces passing the long-lived JWT as a query-string parameter, which was visible to proxies and logs.
- WebSocket broadcast verifies the sender is a participant of the conversation before relaying; the per-conversation member cache is also invalidated on conversation creation so newly-added members start receiving messages immediately.
- Friend-request submission no longer enumerates accounts — the server returns a generic success whether or not the target username exists.
- Vault commands now require an authenticated session — previously some vault operations could be invoked without auth.
- Avatar S3 keys are built entirely from server-side values, preventing client-supplied path components from steering uploads.
- Signup-failure responses no longer return raw AWS SDK error strings; the server returns a scrubbed generic error instead.
- Legacy plaintext MLS-state files on disk are now rejected at load time, forcing a re-key so the app never reads from pre-0.3.6 unencrypted state.

## [0.5.1] - 2026-05-15

### Changed
- MLS layer refactored into `MlsState` struct methods — internal restructure with no behavior, wire-format, or on-disk format changes. Sets up follow-up work on persistence atomicity and welcome-acknowledgment handling.
- Residual "Cryptext" branding cleaned up in the release workflow (Windows installer publisher field, release notes, code-signing artifacts) and project documentation (README, LICENSE) to complete the 0.5.0 rebrand.

## [0.5.0] - 2026-05-15

### Changed
- Application rebranded from Cryptext to NShroud — product name, window titles, splash screen, sidebar icon, auth-page header, and profile-dialog copy all reflect the new name
- Bundle identifier changed from `cryptex.app.com` to `com.nshroud.app` — existing installs will treat the first NShroud build as a fresh install since the local vault, keyring entry, message database, and MLS state are all keyed off the bundle ID
- Deep link scheme changed from `cryptex://` to `nshroud://`
- API server URL default changed from `cryptext.duckdns.org` to `api.nshroud.com`; the WebSocket URL derives from this and updates automatically
- Code-signing info URL on the Windows installer updated to `nshroud.com`

## [0.4.0] - 2026-05-11

### Added
- Microsoft Entra users get a fully silent onboarding — username and display name are auto-prefilled from the Cognito identity attributes and the profile is created in the background, so new enterprise users land directly on the home screen instead of going through the profile-setup page
- Username for Entra-federated profiles is locked and visually marked "Set by your organization" in both the create flow and the settings panel; nickname remains editable

### Changed
- Session persistence rebuilt into a single `SessionPersistence` struct; all session lifecycle (save / restore / clear / wipe) flows through one type instead of free functions
- HTTP layer rebuilt around typed `HttpClient` (anonymous) and `AuthorizedClient` (bearer-authed) wrappers; the legacy free-function API is removed and every call site (auth, conversations, friends, profile, media, sync, MLS) now goes through the typed wrappers
- Filesystem path helpers consolidated into a single `AppPaths` struct keyed by user_id

### Fixed
- Sign-out no longer destroys the local message vault — signing back in on the same device restores access to existing message history. The previous behavior wiped the device's encryption key on every sign-out, leaving the encrypted local DB permanently unrecoverable
- Transient session-restore failures (network blips, missing session file, identity mismatch on refresh) no longer wipe credentials — the user is routed back to the login screen and can retry without losing local state
- Sign-out button icon corrected — was using a shield (which read as "security"); now uses the standard log-out glyph

## [0.3.6] - 2026-04-30

### Added
- Microsoft Entra (Azure AD) sign-in option on the auth page

### Changed
- Google and Entra OAuth flows share one client-side helper for the browser-open and status-poll cycle

### Security
- MLS state and metadata files at rest are now encrypted with the per-user DEK, matching the messages DB and session blob; existing plaintext files are migrated automatically on next launch
- OAuth callback transitions are now guarded so a stale `?error=` callback cannot overwrite an already-completed sign-in
- OAuth callback now surfaces IdP-side failures (`?error=`, `?error_description=`) instead of treating them as missing-state errors

## [0.3.5] - 2026-04-27

### Added
- Icon-rail left sidebar replaces the old labelled sidebar, with theme toggle and profile card launcher
- `useTheme` hook drives dark/light mode from system preference with a manual override
- IBM Plex Sans / Mono / Serif type system via `@fontsource` packages
- `useAutoDownloadMedia` hook pre-fetches and decrypts inline media on chat open; video thumbnails generated client-side

### Changed
- Signup folded into the auth page — standalone `SignupPage` removed
- Home, DM, and auth pages rebuilt around shadcn `Avatar`, `Badge`, and `Tabs` primitives plus a new `StatusPill`
- Sidebar conversation preview now reads the decrypted last message from the local SQLCipher DB; previously showed the server's `[encrypted]` placeholder

### Fixed
- Image and video rendering was broken end-to-end — cache-path extension inference corrected, auto-download wired to DM and group chat pages, CSP relaxed enough for inline blob URLs
- Per-IP rate limits were inverted — `tower_governor`'s `per_millisecond` sets replenishment period, not rate, so the three configs (global, auth, message) are now recalibrated

### Security
- Stop logging HTTP response bodies and serde error details to stderr in release builds
- Set HSTS, CSP, X-Frame-Options, X-Content-Type-Options nosniff, and Referrer-Policy response headers on the server
- Add upper length bounds and whitespace checks on signup inputs (email up to 254 chars, password 8–128, full-name up to 64)
- Validate `store_welcome` recipient_id is a UUID before INSERT

## [0.3.4] - 2026-04-17

### Fixed
- Decrypted MLS payloads now classified as media or plaintext based on content, fixing media messages rendering as junk text

### Changed
- Dropped dormant PIN and multi-method vault scaffolding that was never wired up

## [0.3.3] - 2026-04-17

### Added
- Group chat support end-to-end — server routes, MLS groups with N members, group creation dialog, dedicated `GroupMessagePage`
- Encrypted state sync to server — vault, MLS state, and local DB blobs upload/download for device recovery
- Password-derived DEK vault — vault unlocks via the account password instead of a separate PIN
- OS keyring-backed session persistence so the DEK unlocks silently on app launch

### Changed
- Session storage split — OS keyring holds the DEK, disk holds the refresh token

### Security
- Clear DEK from memory on session lock and validate identity on unlock
- Tauri CSP tightened to reject external script/style loads
- CORS restricted to explicit Tauri app origins
- JWKS cache now Redis-backed with a 24-hour TTL (replaces in-memory cache that expired on restart)
- Google OAuth error logs no longer include raw Cognito error bodies
- Google OAuth polling excluded from the tight auth rate limit (the 2s-poll consent flow was tripping the limiter)

## [0.3.2] - 2026-04-14

### Added
- Conversation intro card above messages showing partner avatar, nickname, and "beginning of history" line
- Self-profile card pinned to the bottom of the Recent Messages panel (avatar, nickname, current status) that opens the edit profile popup
- Friend row three-dot menu with "Copy username" and "Remove friend" (destructive confirm dialog)
- WebSocket server migrated from API Gateway/Lambda onto the Axum server with auth-first-message flow, connection registry, and Redis pub/sub
- Content Security Policy enabled in Tauri config

### Changed
- Home screen is now a persistent two-panel layout — Recent Messages stays on the left, and the right pane swaps between the friends list and the active DM (no more full-page navigation when opening a chat)
- Messages now stack from the bottom of the viewport and grow upward instead of filling from the top
- DM message list uses the shadcn ScrollArea for consistent scrollbar styling
- Edit profile is a popup dialog instead of a dedicated page (initial profile setup still uses the full-page flow)
- Removed the redundant DM header; partner info now lives in the sidebar and intro card
- Removed the Profile entry from the left icon sidebar (reachable via the profile card)
- Color palette switched to pure greyscale; destructive red and chart colors kept intact
- Dialog surfaces use a deliberate mid-grey in light mode and a slightly-elevated dark grey above the card in dark mode

### Fixed
- Friends list and friend-request rows now show profile pictures and status dots — the `/friends` and `/friends/requests/{incoming,outgoing}` endpoints were not selecting `avatar_url` or `status` from the `profiles` table, so the client always rendered the initial-letter fallback and a grey "offline" dot
- Dark mode palette never activated — a `.dark` class is now toggled on `<html>` so the dark color tokens (and Tailwind dark variants in portalled content like dialogs) actually apply
- SplashPage dev-mode detection uses `import.meta.env.DEV` instead of an unreliable check
- MLS initialization RwLock poison errors now propagate instead of panicking silently

### Security
- Verify avatar upload magic bytes match the declared content type
- Reject non-https avatar URLs in the Avatar component
- Remove openmls `test-utils` feature from production builds
- Validate that `register_group` members are conversation participants
- Validate WebSocket payloads at runtime before dispatch
- Cap `get_messages` response at 500 messages
- Cap `member_ids` array length in `register_group`
- Cap `user_ids` array length in `get_profiles_by_ids`
- Sanitize Google OAuth errors before returning to the client
- Redact `AppError::Internal` message before returning to the client
- Add `SameSite=Strict` flag to the sidebar cookie
- Remove debug `println!` statements from the deep-link handler
- Replace `eprintln!` with `tracing::debug` so user IDs stop leaking to logs
- Replace `.unwrap()` with proper error handling in profile routes

## [0.3.1] - 2026-04-08

### Added
- E2E encrypted image and video sharing — media encrypted client-side with AES-256-GCM, uploaded to S3 as encrypted blobs, decryption key delivered via MLS-encrypted messages
- Image thumbnail generation for message previews, click-to-expand full resolution
- Video file sharing with download-and-play (no thumbnail yet)
- Drag-and-drop media attachment onto chat area
- File preview before sending with cancel option
- Local media cache to avoid re-downloading previously viewed media
- Redis integration for server-side state — OAuth state (5-min TTL) and JWKS cache (24-hour TTL)
- Server media upload/download endpoints with conversation participant validation
- `fetch_new_messages` command — only fetches messages newer than latest local timestamp
- Server-side `?after=` query parameter on messages endpoint for incremental fetching

### Changed
- WebSocket message notifications now only fetch new messages instead of re-fetching full history
- WebSocket broadcast includes recipient_id for targeted Lambda delivery
- EC2 deployment moved from systemd to Docker Compose (Axum + Redis + Watchtower)

### Fixed
- Message delivery delay — recipients no longer need to refresh to see incoming messages

## [0.3.0] - 2026-04-03

### Security
- Enforce authentication on `claim_key_package` endpoint — prevent users from claiming other users' key packages
- Enforce group membership verification on `store_welcome` endpoint with 32KB payload size limit
- Verify group creator is included in member list during MLS group registration
- Add 5KB size limit per individual key package upload to prevent storage exhaustion
- Validate avatar upload content-type against whitelist (PNG, JPEG, WebP, GIF only)
- Redact server error details from frontend — return generic messages, log full errors to stderr
- Add per-IP rate limiting (60 req/s, burst 30) and per-user key package upload cap (max 500)
- Add UUID validation on all friend and MLS path parameter endpoints

### Fixed
- Add 60-second buffer to session expiry checks to guard against clock skew between client and server
- Skip duplicate Welcome processing when MLS group already exists for a conversation
- Fix pagination edge case where same-timestamp messages could be skipped or duplicated (composite cursor with id tiebreaker)
- Surface MLS initialization failures to the user instead of silently swallowing them
- Add exponential backoff with jitter and reconnect failure callback to WebSocket hook
- Add explicit 30s request timeout and 10s connect timeout to HTTP client

### Changed
- Add discriminated union types (`WsNewMessage`, `WsStatusUpdate`) for type-safe WebSocket messages
- Replace `process_welcome_public` wrapper with direct `process_welcome` export
- Extract `MutexExt` trait to replace 28 instances of `.lock().map_err()` boilerplate
- Extract `local_message_from_row` helper to deduplicate 4 row mapping sites in local DB
- Extract shared `ErrorMessage` component to replace 7 inline error display patterns
- Replace tuple destructuring with `sqlx::FromRow` derives in server friend and MLS routes
