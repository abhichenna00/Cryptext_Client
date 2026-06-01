// Landing sections: WhyNShroud, HowItWorks, Features, SecurityPosture.

const HATCH = 'repeating-linear-gradient(-45deg, transparent 0 5px, var(--border-strong) 5px 6px)'

// ─── WHY NSHROUD ──────────────────────────────────────────────────────────
const REASONS = [
  {
    n: '01',
    t: 'A breach reveals nothing.',
    d: 'We only ever hold ciphertext. A server compromise, a rogue insider, or a legal demand turns up unreadable bytes — never the contents of a conversation.',
  },
  {
    n: '02',
    t: 'No trade-off for privacy.',
    d: 'Private tools usually feel like a downgrade. NShroud keeps the group chats, encrypted file sharing, and single sign-on your team already expects.',
  },
  {
    n: '03',
    t: 'Trust the math, not the vendor.',
    d: 'You don’t have to believe a privacy promise. Keys never leave your devices, so nobody else can read your messages. That includes us.',
  },
  {
    n: '04',
    t: 'Ready for a real company.',
    d: 'SSO with Microsoft Entra and Google Workspace, silent provisioning, and managed AWS hosting. It fits IT — not just privacy enthusiasts.',
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
            Most work chat keeps your messages in plaintext on its servers — legible to the provider, to anyone they're compelled to hand them to, and to anyone who breaches them. NShroud is built so that simply isn't possible.
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
        Plaintext — exists only here, on a device that holds the keys.
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
          Ciphertext — what we relay and store. No keys live here, so there is nothing for us, or anyone who breaches us, to read.
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
        Same message, two readable ends. Between them — across the network and on our servers — it only ever exists as ciphertext.
      </p>
    </div>
  )
}

const STEPS = [
  {
    n: '01',
    t: 'Sealed on your device',
    d: 'The moment you hit send, your message is encrypted locally with keys that only your conversation holds. The readable version never leaves your laptop.',
  },
  {
    n: '02',
    t: 'Relayed, never read',
    d: 'Our servers route the sealed bytes to the right people and hold them until devices come online. We can see that a message moved — never what it said.',
  },
  {
    n: '03',
    t: 'Opened by the recipient',
    d: 'Only your teammates’ devices hold the keys to open it. The message decrypts inside their app and appears in the conversation — instant and familiar, with no server, network, or onlooker in between that could ever read along.',
  },
]

const CAN_SEE = [
  'Account identifiers (who has an account)',
  'Which accounts exchange messages, and when',
  'Approximate message and file sizes',
  'Public key packages devices publish to start a chat',
]

const CANT_SEE = [
  'The text of any message',
  'Files, images, and attachments',
  'Group, channel, and conversation names',
  'Anything you actually say to each other',
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
            Encryption is easy to claim and hard to picture. So here is the whole journey of a single message — from the moment you send it to the moment it's read — and exactly what we can do with it along the way.
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

        <div style={{ marginTop: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <h3 className="h-2">Where the line falls.</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="surface" style={{ padding: 28 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 18,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--fg-2)',
                  }}
                >
                  What we can see
                </span>
                <span className="small" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                  metadata
                </span>
              </div>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {CAN_SEE.map((c, i) => (
                  <li
                    key={i}
                    className="small"
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '11px 0',
                      borderTop: i ? '1px solid var(--border)' : 'none',
                      alignItems: 'flex-start',
                    }}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--hl)"
                      strokeWidth="1.8"
                      style={{ flexShrink: 0, marginTop: 2 }}
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    </svg>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div
              style={{
                position: 'relative',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                padding: 28,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: HATCH,
                  opacity: 0.5,
                  pointerEvents: 'none',
                }}
              />
              <div style={{ position: 'relative' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 18,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--fg)',
                    }}
                  >
                    What we can never see
                  </span>
                  <span className="small" style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
                    content
                  </span>
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {CANT_SEE.map((c, i) => (
                    <li
                      key={i}
                      className="small"
                      style={{
                        display: 'flex',
                        gap: 12,
                        padding: '11px 0',
                        borderTop: i ? '1px solid var(--border)' : 'none',
                        alignItems: 'flex-start',
                        color: 'var(--fg)',
                      }}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--hl)"
                        strokeWidth="1.8"
                        style={{ flexShrink: 0, marginTop: 2 }}
                      >
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                      </svg>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
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
              — the deeper crypto, forward secrecy, post-compromise security
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
              <strong style={{ color: 'var(--fg)' }}>Post-compromise security:</strong> the ratchet also heals — once a compromised member commits a fresh key, future messages are out of reach again.
            </p>
            <p className="small">
              <strong style={{ color: 'var(--fg)' }}>What we use:</strong> X25519 key exchange, AES-128-GCM symmetric encryption, SHA-256 hashing, Ed25519 signatures — all specified by MLS ciphersuite 1. Media gets a separate AES-256-GCM key delivered inside the MLS-encrypted message and stored as a ciphertext blob in S3.
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
    body: 'Bring your team into rooms of any size. Add and remove members, change names, leave a group — all end-to-end encrypted.',
  },
  {
    icon: 'image',
    title: 'Encrypted files',
    body: 'Share images, videos, and documents. Drag, drop, done. Encrypted on your device, stored as opaque bytes, opened only by the people in the chat.',
  },
  {
    icon: 'lock',
    title: 'Encrypted by default',
    body: 'There is no “privacy mode.” Every conversation is end-to-end encrypted the moment it starts — no setting to flip, no tier to upgrade, no admin checkbox to forget.',
  },
  {
    icon: 'arrow',
    title: 'Forward secrecy',
    body: 'Keys roll forward with every message. If a device is ever lost or compromised, past conversations stay locked. The cryptography heals itself.',
  },
  {
    icon: 'building',
    title: 'Single sign-on',
    body: 'Microsoft Entra (Azure AD), Google Workspace, and email/password. New hires onboard silently — federated users land in the app, already provisioned.',
  },
  {
    icon: 'server',
    title: 'Managed on AWS',
    body: "We run the production stack on AWS so you don't have to. Managed updates, monitoring, and a 99.9% uptime target — included in every paid plan.",
  },
  {
    icon: 'desktop',
    title: 'Native desktop client',
    body: 'Built with Tauri — small (~12MB), fast, and signed. Available for Windows and Linux today, with macOS, iOS, and Android in development.',
  },
  {
    icon: 'database',
    title: 'On-device vault',
    body: 'Your message history lives in a SQLCipher vault on your own machine, unlocked by a PIN that never reaches our servers. Lock the vault and the app goes dark.',
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
          <p className="lede" style={{ maxWidth: 380 }}>
            Direct messages, group chats, encrypted files, and single sign-on — the messaging surface your team needs, encrypted top to bottom.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {FEATURES.map((f, i) => (
            <div
              key={i}
              style={{
                padding: 24,
                borderRight: i % 4 !== 3 ? '1px solid var(--border)' : 'none',
                borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                minHeight: 220,
              }}
            >
              <FeatureIcon name={f.icon} />
              <h3 className="h-3" style={{ marginTop: 20, marginBottom: 8 }}>
                {f.title}
              </h3>
              <p className="small">{f.body}</p>
            </div>
          ))}
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
