# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-06-02

### Added
- The marketing site now deploys automatically. A self-hosted GitHub Actions workflow runs on push to `main` when `apps/web/**` changes, builds the static site, and ships it through `wrangler deploy` to Cloudflare Workers Static Assets.
- The changelog page refetches `CHANGELOG.md` from `main` on mount. The build-time inline still drives the initial render and SSR, while the runtime fetch keeps the live site in sync with the source file without requiring a redeploy.

### Changed
- The marketing site landing was redesigned for tightness. Section padding tokens are roughly halved, repeated copy is condensed, the SecurityPosture and Architecture sections are dropped, the hero ticker is removed, the HowItWorks metadata panel is restructured into a single "honest part" view, and the Features grid is reduced from four columns of eight tiles to three columns of six tiles. The "Voice and video calls" tile replaces dropped duplicates of "Encrypted by default", "Forward secrecy", and "Managed on AWS".
- `CHANGELOG.md` was rewritten for a formal, consistent tone. Every entry is a complete sentence, em-dashes are removed in favor of more precise punctuation, and internal-process citations (plan references, PR numbers, review notes) are stripped from the user-facing text.
- `apps/web/wrangler.jsonc` was restored to a Workers Static Assets configuration with `name`, `compatibility_date`, and `assets.directory` after Cloudflare's Workers Git integration was disabled. The repository's own GitHub Actions workflow is now the sole deploy path for the marketing site.

### Fixed
- The theme toggle correctly flips both Tailwind utility consumers and Radix Themes components without requiring an app restart. The fix combines three underlying changes: `useTheme` state is shared across all hook instances through a module-level store, the `.dark` class is written to `<html>` synchronously inside the store setter rather than via a React effect, and the icon rail chrome design tokens now follow the theme in light mode.
- The `WebSocketContext` value is memoized so subscriber identity stays stable across provider re-renders. Hooks like `useLiveConversationList` no longer resubscribe on every render of the provider, eliminating spurious WebSocket churn.
- `fetch_welcomes` on the desktop client logs failures via `log::error` instead of `eprintln`, matching the rest of the receive path.
- `welcome_ack` on the server now runs its confirmed-epoch update and pending-message delete inside a single transaction. A partial failure between the two writes can no longer leave a member marked confirmed while their pending messages remain queued.
- `mark_conversation_read` on the server performs an explicit participant check before the update. Non-participants now receive an unauthorized response instead of a misleading success from a zero-row update.
- `delete_all_sync_data` on the server surfaces per-file delete failures in the response instead of swallowing them silently. Each failed sync file is listed in the response body so the client can retry or report it.

## [0.6.0] - 2026-06-02

### Added
- Voice and video calling between users via peer-to-peer WebRTC, including a call modal, an in-call overlay, and start-call buttons on the DM page. Call state is managed by an app-wide `CallProvider`, and signaling (offer, answer, ICE candidates, hangup) is carried over the existing WebSocket connection.
- Audio and Video settings section in the profile dialog, providing device pickers for camera, microphone, and speaker, persisted user preferences, and an in-app media-permissions diagnostic.
- Live-updating conversation list. The home sidebar now reflects new messages, new conversations, and unread counts in real time over WebSocket, without requiring a refresh.
- Per-conversation unread counts. The server-side count of unseen messages is returned in the conversation-list response and rendered as a badge on each sidebar row. The badge clears when the conversation is opened.
- Idempotent message sends. Each outgoing message carries a `client_message_id`, the server collapses repeated submissions to the same logical message, and the desktop client persists an outbox so in-flight sends survive an app restart.
- NShroud marketing website (`apps/web/`): Astro and React landing and changelog pages, with the changelog sourced from this file at build time.

### Changed
- WebSocket connection lifted to an App-level provider. A single socket per session is shared across pages, replacing the previous per-page hook instances.
- NShroud mark: the slatted-N logo is now an inline React component (recolorable gradient with knockout N), and replaces the previous icon in the favicon, splash screen, auth header, and sidebar.
- Server shares a single S3 client across handlers via `OnceCell`, avoiding a fresh AWS client and connection pool on every avatar or media request.
- Group member inserts are batched via Postgres `UNNEST`. A single query replaces the per-row loop on group creation, cutting round-trips for larger groups.
- `accept_friend_request` is wrapped in a transaction. The row update and friendship insert now succeed or fail together. Previously, a crash between the two could leave a half-accepted request.
- Conversation `updated_at` write failures are surfaced as warnings instead of silently swallowed.
- Removed the unused `sync_oauth_session` command, the stale `pending_welcomes` cleanup path with its swallowed errors, and the legacy plaintext-MLS-state migration.
- Sidebar message rows now group consecutive messages from the same sender without gaps, and grid rows no longer stretch to inherited line-height.
- Chat pages fetch only new messages when opening a conversation, instead of refetching the whole history.

### Fixed
- The MLS decrypt loop and the local message store are now kept in lockstep. Read errors during decryption are surfaced instead of silently dropped, and the two no longer drift apart on partial failures.
- Chat-page render race resolved when the sidebar finishes decrypting before the chat page mounts. The chat page now re-reads from the local DB after fetch, so the new messages appear.
- Sidebar pushes now decrypt inbound messages on receipt, so the preview text and unread count update without opening the conversation.
- Clicking a conversation row in the sidebar now clears its unread badge immediately.
- `register_group` no longer leaks `creator_id` back in the response.

### Security
- WebSocket connections now authenticate with a short-lived, single-use ticket fetched over HTTPS. This replaces passing the long-lived JWT as a query-string parameter, which was visible to proxies and logs.
- WebSocket broadcast verifies the sender is a participant of the conversation before relaying. The per-conversation member cache is also invalidated on conversation creation so newly-added members start receiving messages immediately.
- Friend-request submission no longer enumerates accounts. The server returns a generic success whether or not the target username exists.
- Vault commands now require an authenticated session. Previously, some vault operations could be invoked without auth.
- Avatar S3 keys are built entirely from server-side values, preventing client-supplied path components from steering uploads.
- Signup-failure responses no longer return raw AWS SDK error strings. The server returns a scrubbed generic error instead.
- Legacy plaintext MLS-state files on disk are now rejected at load time, forcing a re-key so the app never reads from pre-0.3.6 unencrypted state.

## [0.5.1] - 2026-05-15

### Changed
- MLS layer refactored into `MlsState` struct methods. This is an internal restructure with no behavior, wire-format, or on-disk format changes. It sets up follow-up work on persistence atomicity and welcome-acknowledgment handling.
- Residual "Cryptext" branding cleaned up in the release workflow (Windows installer publisher field, release notes, code-signing artifacts) and project documentation (README, LICENSE) to complete the 0.5.0 rebrand.

## [0.5.0] - 2026-05-15

### Changed
- Application rebranded from Cryptext to NShroud. The product name, window titles, splash screen, sidebar icon, auth-page header, and profile-dialog copy all reflect the new name.
- Bundle identifier changed from `cryptex.app.com` to `com.nshroud.app`. Existing installs will treat the first NShroud build as a fresh install, since the local vault, keyring entry, message database, and MLS state are all keyed off the bundle ID.
- Deep link scheme changed from `cryptex://` to `nshroud://`.
- API server URL default changed from `cryptext.duckdns.org` to `api.nshroud.com`. The WebSocket URL derives from this and updates automatically.
- Code-signing info URL on the Windows installer updated to `nshroud.com`.

## [0.4.0] - 2026-05-11

### Added
- Microsoft Entra users now receive a fully silent onboarding. The username and display name are auto-prefilled from the Cognito identity attributes, and the profile is created in the background, so new enterprise users land directly on the home screen instead of going through the profile-setup page.
- Username for Entra-federated profiles is locked and visually marked "Set by your organization" in both the create flow and the settings panel. The nickname remains editable.

### Changed
- Session persistence rebuilt into a single `SessionPersistence` struct. All session lifecycle operations (save, restore, clear, wipe) flow through one type instead of free functions.
- HTTP layer rebuilt around typed `HttpClient` (anonymous) and `AuthorizedClient` (bearer-authed) wrappers. The legacy free-function API is removed, and every call site (auth, conversations, friends, profile, media, sync, MLS) now goes through the typed wrappers.
- Filesystem path helpers consolidated into a single `AppPaths` struct keyed by user_id.

### Fixed
- Sign-out no longer destroys the local message vault. Signing back in on the same device restores access to existing message history. The previous behavior wiped the device's encryption key on every sign-out, leaving the encrypted local DB permanently unrecoverable.
- Transient session-restore failures (network blips, missing session file, identity mismatch on refresh) no longer wipe credentials. The user is routed back to the login screen and can retry without losing local state.
- Sign-out button icon corrected. It previously used a shield (which read as "security") and now uses the standard log-out glyph.

## [0.3.6] - 2026-04-30

### Added
- Microsoft Entra (Azure AD) sign-in option on the auth page.

### Changed
- Google and Entra OAuth flows share one client-side helper for the browser-open and status-poll cycle.

### Security
- MLS state and metadata files at rest are now encrypted with the per-user DEK, matching the messages DB and session blob. Existing plaintext files are migrated automatically on next launch.
- OAuth callback transitions are now guarded so a stale `?error=` callback cannot overwrite an already-completed sign-in.
- OAuth callback now surfaces IdP-side failures (`?error=`, `?error_description=`) instead of treating them as missing-state errors.

## [0.3.5] - 2026-04-27

### Added
- Icon-rail left sidebar replaces the old labelled sidebar, with a theme toggle and a profile card launcher.
- `useTheme` hook drives dark and light mode from system preference with a manual override.
- IBM Plex Sans, Mono, and Serif type system via `@fontsource` packages.
- `useAutoDownloadMedia` hook pre-fetches and decrypts inline media on chat open. Video thumbnails are generated client-side.

### Changed
- Signup folded into the auth page. The standalone `SignupPage` was removed.
- Home, DM, and auth pages rebuilt around shadcn `Avatar`, `Badge`, and `Tabs` primitives, plus a new `StatusPill`.
- Sidebar conversation preview now reads the decrypted last message from the local SQLCipher DB. It previously showed the server's `[encrypted]` placeholder.

### Fixed
- Image and video rendering was broken end-to-end. The cache-path extension inference was corrected, auto-download was wired to DM and group chat pages, and CSP was relaxed enough for inline blob URLs.
- Per-IP rate limits were inverted. `tower_governor`'s `per_millisecond` sets the replenishment period, not the rate, so the three configs (global, auth, message) are now recalibrated.

### Security
- Stop logging HTTP response bodies and serde error details to stderr in release builds.
- Set HSTS, CSP, X-Frame-Options, X-Content-Type-Options nosniff, and Referrer-Policy response headers on the server.
- Add upper length bounds and whitespace checks on signup inputs (email up to 254 chars, password 8 to 128, full-name up to 64).
- Validate `store_welcome` recipient_id is a UUID before INSERT.

## [0.3.4] - 2026-04-17

### Fixed
- Decrypted MLS payloads are now classified as media or plaintext based on content, fixing media messages rendering as junk text.

### Changed
- Dropped dormant PIN and multi-method vault scaffolding that was never wired up.

## [0.3.3] - 2026-04-17

### Added
- Group chat support end-to-end, including server routes, MLS groups with N members, a group creation dialog, and a dedicated `GroupMessagePage`.
- Encrypted state sync to server. Vault, MLS state, and local DB blobs upload and download for device recovery.
- Password-derived DEK vault. The vault unlocks via the account password instead of a separate PIN.
- OS keyring-backed session persistence so the DEK unlocks silently on app launch.

### Changed
- Session storage split: the OS keyring holds the DEK, and disk holds the refresh token.

### Security
- Clear DEK from memory on session lock and validate identity on unlock.
- Tauri CSP tightened to reject external script and style loads.
- CORS restricted to explicit Tauri app origins.
- JWKS cache is now Redis-backed with a 24-hour TTL, replacing the in-memory cache that expired on restart.
- Google OAuth error logs no longer include raw Cognito error bodies.
- Google OAuth polling excluded from the tight auth rate limit. The 2-second-poll consent flow was tripping the limiter.

## [0.3.2] - 2026-04-14

### Added
- Conversation intro card above messages showing partner avatar, nickname, and "beginning of history" line.
- Self-profile card pinned to the bottom of the Recent Messages panel (avatar, nickname, current status) that opens the edit profile popup.
- Friend row three-dot menu with "Copy username" and "Remove friend" (destructive confirm dialog).
- WebSocket server migrated from API Gateway and Lambda onto the Axum server with an auth-first-message flow, connection registry, and Redis pub/sub.
- Content Security Policy enabled in Tauri config.

### Changed
- Home screen is now a persistent two-panel layout. Recent Messages stays on the left, and the right pane swaps between the friends list and the active DM, so there is no more full-page navigation when opening a chat.
- Messages now stack from the bottom of the viewport and grow upward instead of filling from the top.
- DM message list uses the shadcn ScrollArea for consistent scrollbar styling.
- Edit profile is a popup dialog instead of a dedicated page. Initial profile setup still uses the full-page flow.
- Removed the redundant DM header. Partner info now lives in the sidebar and intro card.
- Removed the Profile entry from the left icon sidebar (reachable via the profile card).
- Color palette switched to pure greyscale. Destructive red and chart colors are kept intact.
- Dialog surfaces use a deliberate mid-grey in light mode and a slightly-elevated dark grey above the card in dark mode.

### Fixed
- Friends list and friend-request rows now show profile pictures and status dots. The `/friends` and `/friends/requests/{incoming,outgoing}` endpoints were not selecting `avatar_url` or `status` from the `profiles` table, so the client always rendered the initial-letter fallback and a grey "offline" dot.
- Dark mode palette never activated. A `.dark` class is now toggled on `<html>` so the dark color tokens (and Tailwind dark variants in portalled content like dialogs) actually apply.
- SplashPage dev-mode detection uses `import.meta.env.DEV` instead of an unreliable check.
- MLS initialization RwLock poison errors now propagate instead of panicking silently.

### Security
- Verify avatar upload magic bytes match the declared content type.
- Reject non-https avatar URLs in the Avatar component.
- Remove openmls `test-utils` feature from production builds.
- Validate that `register_group` members are conversation participants.
- Validate WebSocket payloads at runtime before dispatch.
- Cap `get_messages` response at 500 messages.
- Cap `member_ids` array length in `register_group`.
- Cap `user_ids` array length in `get_profiles_by_ids`.
- Sanitize Google OAuth errors before returning to the client.
- Redact `AppError::Internal` message before returning to the client.
- Add `SameSite=Strict` flag to the sidebar cookie.
- Remove debug `println!` statements from the deep-link handler.
- Replace `eprintln!` with `tracing::debug` so user IDs stop leaking to logs.
- Replace `.unwrap()` with proper error handling in profile routes.

## [0.3.1] - 2026-04-08

### Added
- E2E encrypted image and video sharing. Media is encrypted client-side with AES-256-GCM, uploaded to S3 as encrypted blobs, with the decryption key delivered via MLS-encrypted messages.
- Image thumbnail generation for message previews, with click-to-expand full resolution.
- Video file sharing with download-and-play (no thumbnail yet).
- Drag-and-drop media attachment onto chat area.
- File preview before sending with cancel option.
- Local media cache to avoid re-downloading previously viewed media.
- Redis integration for server-side state: OAuth state (5-minute TTL) and JWKS cache (24-hour TTL).
- Server media upload and download endpoints with conversation participant validation.
- `fetch_new_messages` command that only fetches messages newer than the latest local timestamp.
- Server-side `?after=` query parameter on the messages endpoint for incremental fetching.

### Changed
- WebSocket message notifications now only fetch new messages instead of re-fetching the full history.
- WebSocket broadcast includes recipient_id for targeted Lambda delivery.
- EC2 deployment moved from systemd to Docker Compose (Axum, Redis, Watchtower).

### Fixed
- Message delivery delay resolved. Recipients no longer need to refresh to see incoming messages.

## [0.3.0] - 2026-04-03

### Security
- Enforce authentication on the `claim_key_package` endpoint to prevent users from claiming other users' key packages.
- Enforce group membership verification on the `store_welcome` endpoint with a 32KB payload size limit.
- Verify the group creator is included in the member list during MLS group registration.
- Add a 5KB size limit per individual key package upload to prevent storage exhaustion.
- Validate avatar upload content-type against a whitelist (PNG, JPEG, WebP, GIF only).
- Redact server error details from the frontend. Return generic messages and log full errors to stderr.
- Add per-IP rate limiting (60 req/s, burst 30) and per-user key package upload cap (max 500).
- Add UUID validation on all friend and MLS path parameter endpoints.

### Fixed
- Add a 60-second buffer to session expiry checks to guard against clock skew between client and server.
- Skip duplicate Welcome processing when an MLS group already exists for a conversation.
- Fix a pagination edge case where same-timestamp messages could be skipped or duplicated (composite cursor with id tiebreaker).
- Surface MLS initialization failures to the user instead of silently swallowing them.
- Add exponential backoff with jitter and a reconnect failure callback to the WebSocket hook.
- Add explicit 30-second request timeout and 10-second connect timeout to the HTTP client.

### Changed
- Add discriminated union types (`WsNewMessage`, `WsStatusUpdate`) for type-safe WebSocket messages.
- Replace the `process_welcome_public` wrapper with a direct `process_welcome` export.
- Extract a `MutexExt` trait to replace 28 instances of `.lock().map_err()` boilerplate.
- Extract a `local_message_from_row` helper to deduplicate 4 row mapping sites in the local DB.
- Extract a shared `ErrorMessage` component to replace 7 inline error display patterns.
- Replace tuple destructuring with `sqlx::FromRow` derives in server friend and MLS routes.
