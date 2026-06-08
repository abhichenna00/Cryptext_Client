// Landing sections: WhyNShroud, HowItWorks, Features, SecurityPosture.

const HATCH = 'repeating-linear-gradient(-45deg, transparent 0 5px, var(--border-strong) 5px 6px)'

// ─── WHY NSHROUD ──────────────────────────────────────────────────────────
const REASONS = [
  {
    n: '01',
    t: 'Private by design.',
    d: 'Every message and file is locked on your own devices before it leaves. A breach, an insider, or a legal demand turns up only encrypted data, because the keys to open it never reach our servers.',
  },
  {
    n: '02',
    t: 'No trade-off for privacy.',
    d: 'Most private tools feel like a step backward, so people stop using them. NShroud works like the modern messenger your team already uses, so they stay with it.',
  },
  {
    n: '03',
    t: 'Ready for how IT works.',
    d: 'Single sign-on with Microsoft Entra and Google Workspace, silent provisioning for new hires, and managed AWS hosting with an uptime target. Your IT team gets the controls it expects.',
  },
  {
    n: '04',
    t: 'Run it anywhere.',
    d: 'NShroud ships as a single Docker container you can run in your own cloud, on-prem, or fully offline. The full client and server are on GitHub. You can also let us host it for you.',
  },
]

export function WhyNShroud() {
  return (
    <section id="why" className="section">
      <div className="container section-inner">
        <div style={{ maxWidth: 760, marginBottom: 8 }}>
          <span className="eyebrow">Why NShroud</span>
          <h2 className="h-1" style={{ marginTop: 16 }}>
            Most work chat can read every word you send.
          </h2>
          <p className="lede" style={{ marginTop: 20 }}>
            Most work chat keeps your messages in plain text on its servers. The
            provider can read them, so can anyone they are forced to share them with,
            and so can anyone who breaks in. NShroud is built so that none of this
            is possible.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 40 }}>
          {REASONS.map((r, i) => {
            const right = i % 2 === 1
            return (
              <div
                key={r.n}
                style={{
                  borderTop: '1px solid var(--border)',
                  padding: right ? '34px 0 34px 48px' : '34px 48px 34px 0',
                  borderLeft: right ? '1px solid var(--border)' : 'none',
                }}
              >
                <div className="mono" style={{ fontSize: 11, color: 'var(--hl)', marginBottom: 16 }}>
                  {r.n}
                </div>
                <h3 className="h-2" style={{ marginBottom: 12 }}>
                  {r.t}
                </h3>
                <p className="lede" style={{ fontSize: 15.5, color: 'var(--fg-2)', marginTop: 0 }}>
                  {r.d}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── HOW IT WORKS ─────────────────────────────────────────────────────────
function StatusPill({ kind }) {
  const encrypted = kind === 'encrypted'
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: encrypted ? 'var(--hl)' : 'var(--fg-2)',
        border: encrypted
          ? '1px solid color-mix(in srgb, var(--hl) 35%, transparent)'
          : '1px solid var(--border-strong)',
        borderRadius: 999,
        padding: '3px 9px',
        whiteSpace: 'nowrap',
      }}
    >
      {encrypted ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 1,
            background: 'var(--fg-3)',
            display: 'inline-block',
          }}
        />
      )}
      {encrypted ? 'encrypted' : 'readable'}
    </span>
  )
}

function Endpoint({ role, sub, text, align }) {
  return (
    <div
      className="surface"
      style={{
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              border: '1px solid color-mix(in srgb, var(--hl) 30%, transparent)',
              background: 'var(--hl-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--hl)" strokeWidth="1.6">
              <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
              <line x1="10" y1="18.5" x2="14" y2="18.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{role}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>
              {sub}
            </div>
          </div>
        </div>
        <StatusPill kind="readable" />
      </div>
      <div
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          borderTopLeftRadius: align === 'right' ? 10 : 3,
          borderTopRightRadius: align === 'right' ? 3 : 10,
          padding: '12px 14px',
          fontSize: 13.5,
          lineHeight: 1.45,
          color: 'var(--fg)',
        }}
      >
        “{text}”
      </div>
      <div className="small" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 'auto' }}>
        Plain text that exists only here, on a device that holds the keys.
      </div>
    </div>
  )
}

function Boundary({ label }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 4px',
        minWidth: 64,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 9.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--fg-3)',
        }}
      >
        {label}
      </span>
      <svg
        width="56"
        height="14"
        viewBox="0 0 56 14"
        preserveAspectRatio="none"
        style={{ overflow: 'visible', opacity: 0.9, color: 'var(--hl)' }}
      >
        <line
          x1="0"
          y1="7"
          x2="48"
          y2="7"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <polygon points="56,7 47,2.5 47,11.5" fill="currentColor" />
      </svg>
    </div>
  )
}

function ServerNode() {
  const cipher = 'a91f3c7e2d8b04f6 5c1e9a7740bd2f83 e0c4ab19d6720f5e 8f23c1a90b4d7e62 11ad5fbc8093e4a7'
  return (
    <div
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              border: '1px solid color-mix(in srgb, var(--hl) 30%, transparent)',
              background: 'var(--hl-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--hl)"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <rect x="3" y="5" width="18" height="6" rx="1.5" />
              <rect x="3" y="13" width="18" height="6" rx="1.5" />
              <line x1="7" y1="8" x2="7.01" y2="8" />
              <line x1="7" y1="16" x2="7.01" y2="16" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>NShroud servers</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--fg-3)' }}>
              relay + storage on AWS
            </div>
          </div>
        </div>
        <StatusPill kind="encrypted" />
      </div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          padding: '16px',
          background: HATCH,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            lineHeight: 1.7,
            color: 'var(--fg-2)',
            wordBreak: 'break-all',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
          }}
        >
          {cipher}
          <span style={{ color: 'var(--fg-4)' }}> …</span>
        </div>
        <div className="small" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
          Ciphertext is all we relay and store. No keys live here, so there is nothing for us, or anyone who breaks in, to read.
        </div>
      </div>
    </div>
  )
}

function MessageLifecycle() {
  const msg = "Let's move the launch to Friday."
  return (
    <div className="surface" style={{ padding: 'clamp(20px, 3vw, 32px)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1.15fr auto 1fr',
          alignItems: 'stretch',
          gap: 0,
        }}
      >
        <Endpoint role="You" sub="sender" text={msg} align="left" />
        <Boundary label="seal" />
        <ServerNode />
        <Boundary label="open" />
        <Endpoint role="John" sub="recipient" text={msg} align="right" />
      </div>
      <p
        className="small"
        style={{
          textAlign: 'center',
          marginTop: 20,
          color: 'var(--fg-3)',
          maxWidth: 640,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}
      >
        You and the people you message can read it. Everywhere in between, on the network and on our servers, it stays encrypted.
      </p>
    </div>
  )
}

const STEPS = [
  {
    n: '01',
    t: 'Sealed on your device',
    d: 'When you hit send, your message is encrypted on your device with keys that only your conversation holds. The readable version never leaves your device.',
  },
  {
    n: '02',
    t: 'Sent through our servers',
    d: 'Our servers deliver the encrypted message to the right people and hold it until their devices come online. We can see that a message was sent, but not what it says.',
  },
  {
    n: '03',
    t: 'Opened by the recipient',
    d: 'Only your teammates’ devices hold the keys to open it. The message is decrypted inside their app and appears in the conversation. It arrives in an instant, and no server, network, or observer in between can read it.',
  },
]

export function HowItWorks() {
  return (
    <section id="how" className="section">
      <div className="container section-inner">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            marginBottom: 48,
          }}
        >
          <span className="eyebrow">How it works</span>
          <h2 className="h-1" style={{ marginTop: 16, maxWidth: 760 }}>
            Follow one message, end to end.
          </h2>
          <p className="lede" style={{ marginTop: 18, maxWidth: 640 }}>
            Encryption is easy to claim and hard to picture. Here is the full path
            of a single message, from the moment you send it to the moment
            it's read, and exactly what we can see along the way.
          </p>
        </div>

        <MessageLifecycle />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            background: 'var(--border)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            marginTop: 40,
          }}
        >
          {STEPS.map((s) => (
            <div key={s.n} style={{ background: 'var(--bg)', padding: 28, minHeight: 188 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--hl)', marginBottom: 16 }}>
                {s.n}
              </div>
              <h3 className="h-3" style={{ marginBottom: 10 }}>
                {s.t}
              </h3>
              <p className="small">{s.d}</p>
            </div>
          ))}
        </div>

        <details style={{ marginTop: 40 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 13.5,
              color: 'var(--fg-2)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              listStyle: 'none',
            }}
          >
            <span style={{ color: 'var(--fg)' }}>Read more</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
              forward secrecy, post-compromise, and the deeper crypto
            </span>
          </summary>
          <div className="surface" style={{ padding: 28, marginTop: 16 }}>
            <p className="small" style={{ marginBottom: 16 }}>
              NShroud uses <strong style={{ color: 'var(--fg)' }}>Messaging Layer Security</strong> (RFC&nbsp;9420), the modern E2E protocol designed for groups. Each conversation is an MLS{' '}
              <strong style={{ color: 'var(--fg)' }}>group</strong>; each device is a{' '}
              <strong style={{ color: 'var(--fg)' }}>leaf</strong> in a binary ratchet tree.
            </p>
            <p className="small" style={{ marginBottom: 16 }}>
              <strong style={{ color: 'var(--fg)' }}>Forward secrecy:</strong> keys ratchet forward on every message. Compromise a device and you still can't read history.
            </p>
            <p className="small" style={{ marginBottom: 16 }}>
              <strong style={{ color: 'var(--fg)' }}>Post-compromise security:</strong> the ratchet also heals. Once a compromised member commits a fresh key, future messages are out of reach again.
            </p>
            <p className="small">
              <strong style={{ color: 'var(--fg)' }}>What we use:</strong> X25519 key exchange, AES-128-GCM symmetric encryption, SHA-256 hashing, Ed25519 signatures, all specified by MLS ciphersuite 1. Media gets a separate AES-256-GCM key delivered inside the MLS-encrypted message and stored as a ciphertext blob in S3.
            </p>
          </div>
        </details>
      </div>
    </section>
  )
}

// ─── FEATURE GRID ──────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: 'users',
    title: 'Group chats',
    body: 'Bring your team into rooms of any size. Add and remove members, rename, and leave a group, all end-to-end encrypted.',
  },
  {
    icon: 'image',
    title: 'Encrypted files',
    body: 'Share images, videos, and documents by dragging them into a conversation. Files are encrypted on your device and opened only by the people in the chat.',
  },
  {
    icon: 'video',
    title: 'Voice & video calls',
    body: 'Start a 1:1 or group call from any conversation. The audio and video are encrypted the same way your messages are.',
  },
  {
    icon: 'building',
    title: 'Single sign-on',
    body: 'Sign in with Microsoft Entra, Google Workspace, or email and password. New hires arrive in the app already set up, with no manual steps.',
  },
  {
    icon: 'desktop',
    title: 'Native desktop app',
    body: 'Built with Tauri, so it stays small (~12MB), fast, and signed. Windows and Linux today, with macOS, iOS, and Android in development.',
  },
  {
    icon: 'database',
    title: 'On-device vault',
    body: 'Your message history lives in an encrypted vault on your own machine, unlocked by a PIN that never reaches our servers. Lock the vault and the app’s contents are hidden.',
  },
]

const FEATURE_ICONS = {
  lock: 'M6 10V7a6 6 0 1 1 12 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm2 0h8V7a4 4 0 0 0-8 0z',
  arrow: 'M4 12h13m0 0-5-5m5 5-5 5',
  users:
    'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-8 0a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v3h11M16 13c-.71 0-1.51.1-2.36.27a5.93 5.93 0 0 1 2.36 4.73v2H24v-3c0-2.66-5.33-4-8-4z',
  image:
    'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4zM5 18l4-5 3 3.5L15 12l4 6z',
  building: 'M3 21V7l9-4 9 4v14h-6v-7h-6v7zM9 11h2M13 11h2M9 15h2',
  server: 'M3 5h18v6H3zM3 13h18v6H3zM7 8h.01M7 16h.01M11 8h.01M11 16h.01',
  desktop: 'M2 4h20v13H2zM8 21h8M12 17v4',
  database:
    'M4 7c0-2 3.58-4 8-4s8 2 8 4-3.58 4-8 4-8-2-8-4zm0 5c0 2 3.58 4 8 4s8-2 8-4M4 7v10c0 2 3.58 4 8 4s8-2 8-4V7',
  video: 'M2 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM17 10l5-3v10l-5-3z',
}

function FeatureIcon({ name }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: 'var(--hl-soft)',
        border: '1px solid color-mix(in srgb, var(--hl) 28%, transparent)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--hl)',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={FEATURE_ICONS[name]} />
      </svg>
    </div>
  )
}

export function Features() {
  return (
    <section id="features" className="section">
      <div className="container section-inner">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'end',
            flexWrap: 'wrap',
            gap: 24,
            marginBottom: 48,
          }}
        >
          <div style={{ maxWidth: 600 }}>
            <span className="eyebrow">What you get</span>
            <h2 className="h-1" style={{ marginTop: 16 }}>
              Everything your team needs to talk.
            </h2>
          </div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridAutoRows: 'minmax(168px, auto)',
            gap: 14,
          }}
        >
          {/* Group chats — tall */}
          <div
            className="surface"
            style={{
              gridRow: 'span 2',
              padding: 26,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <FeatureIcon name="users" />
            <div>
              <h3 className="h-3" style={{ marginBottom: 8, fontSize: 19 }}>
                Group chats
              </h3>
              <p className="small">{FEATURES[0].body}</p>
            </div>
          </div>
          {/* Voice & video — wide, featured */}
          <div
            className="surface"
            style={{
              gridColumn: 'span 2',
              padding: 26,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div style={{ position: 'relative' }}>
              <FeatureIcon name="video" />
            </div>
            <div style={{ position: 'relative' }}>
              <h3 className="h-3" style={{ marginBottom: 8, fontSize: 19 }}>
                Voice &amp; video calls
              </h3>
              <p className="small" style={{ maxWidth: '52ch' }}>
                {FEATURES[2].body}
              </p>
            </div>
          </div>
          {/* Encrypted files */}
          <div
            className="surface"
            style={{ padding: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
          >
            <FeatureIcon name="image" />
            <div>
              <h3 className="h-3" style={{ marginBottom: 6, fontSize: 17 }}>
                Encrypted files
              </h3>
              <p className="small">{FEATURES[1].body}</p>
            </div>
          </div>
          {/* Single sign-on */}
          <div
            className="surface"
            style={{ padding: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
          >
            <FeatureIcon name="building" />
            <div>
              <h3 className="h-3" style={{ marginBottom: 6, fontSize: 17 }}>
                Single sign-on
              </h3>
              <p className="small">{FEATURES[3].body}</p>
            </div>
          </div>
          {/* Native desktop */}
          <div
            className="surface"
            style={{ padding: 26, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
          >
            <FeatureIcon name="desktop" />
            <div>
              <h3 className="h-3" style={{ marginBottom: 6, fontSize: 17 }}>
                Native desktop app
              </h3>
              <p className="small">{FEATURES[4].body}</p>
            </div>
          </div>
          {/* On-device vault — wide */}
          <div
            className="surface"
            style={{ gridColumn: 'span 2', padding: 26, display: 'flex', gap: 20, alignItems: 'center' }}
          >
            <FeatureIcon name="database" />
            <div>
              <h3 className="h-3" style={{ marginBottom: 6, fontSize: 17 }}>
                On-device vault
              </h3>
              <p className="small" style={{ maxWidth: '60ch' }}>
                {FEATURES[5].body}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── SECURITY POSTURE ─────────────────────────────────────────────────────
const STATS = [
  { v: 'MLS', l: 'RFC 9420' },
  { v: 'AES-256', l: 'GCM media' },
  { v: 'AES-128', l: 'GCM messages' },
  { v: 'X25519', l: 'key exchange' },
  { v: 'Ed25519', l: 'signatures' },
  { v: 'Argon2id', l: 'vault KDF' },
  { v: 'SQLCipher', l: 'local DB' },
  { v: 'Tauri v2', l: 'sandboxed' },
]

const MEASURES = [
  ['Rate-limited', 'Per-IP 60 req/s (burst 30). Per-user key-package upload cap 500, 5KB each.'],
  ['Validated', 'UUID checks on every path param. Magic-byte verification on every uploaded image.'],
  ['CSP-locked', 'Tauri rejects external script/style loads. CORS restricted to explicit Tauri origins.'],
  [
    'Header-hardened',
    'HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy on every server response.',
  ],
  ['Redacted', 'Internal errors never reach the client. No HTTP bodies or user IDs leak to logs.'],
  [
    'Auth-gated',
    'Group endpoints require membership. Key-package claims require auth. Welcome size capped at 32KB.',
  ],
]

export function SecurityPosture() {
  return (
    <section id="security" className="section">
      <div className="container section-inner">
        <div style={{ maxWidth: 720, marginBottom: 56 }}>
          <span className="eyebrow">Security posture</span>
          <h2 className="h-1" style={{ marginTop: 16 }}>
            What the server sees: ciphertext only.
          </h2>
          <p className="lede" style={{ marginTop: 20 }}>
            Encryption is the floor, not the ceiling. NShroud also enforces rate limits, input validation, error redaction, and header hardening across every endpoint — so a compromised credential doesn't unlock anything beyond one account.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            marginBottom: 56,
          }}
        >
          {STATS.map((s, i) => (
            <div
              key={i}
              style={{
                padding: '28px 24px',
                borderRight: i % 4 !== 3 ? '1px solid var(--border)' : 'none',
                borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div className="mono" style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em' }}>
                {s.v}
              </div>
              <div
                className="small"
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--hl)',
                }}
              >
                {s.l}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 64, alignItems: 'start' }}>
          <div>
            <h3 className="h-2">Defense in depth.</h3>
            <p className="lede" style={{ marginTop: 14, fontSize: 15 }}>
              Even if encryption broke tomorrow, the server's attack surface is small and audited. Every endpoint that takes a list has a length cap. Every path parameter is validated. Every error is generic to the client and detailed in our own logs.
            </p>
            <a href="#" className="btn btn-secondary btn-sm btn-arrow" style={{ marginTop: 24 }}>
              Read the security model
            </a>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {MEASURES.map(([tag, body]) => (
              <li
                key={tag}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: 24,
                  padding: '18px 0',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--hl)' }}>
                  {tag}
                </span>
                <span className="small">{body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
