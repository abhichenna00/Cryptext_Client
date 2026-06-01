import FlickeringGrid from './FlickeringGrid.jsx'

function HeroBackdrop() {
  const fade = 'radial-gradient(115% 95% at 50% 0%, #000 0%, #000 32%, transparent 76%)'
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        maskImage: fade,
        WebkitMaskImage: fade,
      }}
    >
      <FlickeringGrid squareSize={4} gridGap={7} flickerChance={0.22} maxOpacity={0.2} color="#f59e0b" />
    </div>
  )
}

function HeroEyebrow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)' }}>
        For Windows &amp; Linux · macOS, iOS &amp; Android in development
      </span>
    </div>
  )
}

function HeroCTAs() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 36 }}>
      <a href="#pricing" className="btn btn-primary btn-arrow">
        Get started
      </a>
      <a href="#how" className="btn btn-secondary">
        How it works
      </a>
    </div>
  )
}

function HeroTicker() {
  return (
    <div className="ticker" style={{ marginTop: 56, borderTop: '1px solid var(--border)' }}>
      <span>1:1 &amp; group chats</span>
      <span>Encrypted file sharing</span>
      <span>Forward secrecy (MLS)</span>
      <span>Microsoft Entra SSO</span>
      <span>On-device encrypted vault</span>
      <span>Hosted on AWS</span>
    </div>
  )
}

function MsgBubble({ who, name, body, attach }) {
  const me = who === 'me'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: me ? 'flex-end' : 'flex-start',
        gap: 2,
      }}
    >
      {!me && name && (
        <div style={{ fontSize: 9.5, color: 'var(--fg-3)', paddingLeft: 8 }}>{name}</div>
      )}
      <div
        style={{
          maxWidth: '78%',
          padding: attach ? 4 : '8px 12px',
          borderRadius: 10,
          background: me ? 'var(--fg)' : 'var(--surface-2)',
          color: me ? 'var(--bg)' : 'var(--fg)',
          border: me ? 'none' : '1px solid var(--border)',
          fontSize: 12,
          lineHeight: 1.4,
        }}
      >
        {attach ? (
          <div
            style={{
              width: 140,
              height: 86,
              borderRadius: 7,
              background: 'repeating-linear-gradient(45deg, var(--surface-3) 0 8px, var(--surface-2) 8px 16px)',
            }}
          />
        ) : (
          body
        )}
      </div>
    </div>
  )
}

const ICON_PATHS = [
  { active: true, path: 'M3 4h18v3H3zM3 10h18v3H3zM3 16h18v3H3z' },
  { path: 'M12 2a5 5 0 0 0-5 5v3H6a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3z' },
  { path: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 6v2h16v-2c0-4-4-6-8-6z' },
]

const CHATS = [
  { name: 'Security Engineering', last: 'ratchet roll-up shipped to staging', t: '12m', active: true, dot: 'online' },
  { name: 'Asha Patel', last: 'Sent an image · 2.1mb', t: '1h', dot: 'idle' },
  { name: '#all-hands', last: 'Reminder: Q2 review Thursday', t: '3h', dot: null, group: true },
  { name: 'Diego Romero', last: 'lgtm shipping it', t: '5h', dot: 'online' },
  { name: 'Maya Chen', last: 'Could you share the audit report?', t: '1d', dot: 'offline' },
  { name: '#nshroud-infra', last: 'Watchtower picked up :latest', t: '2d', dot: null, group: true },
]

function AppMockup({ wide = false }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: wide ? 1100 : 600,
        margin: wide ? '0 auto' : 0,
        aspectRatio: wide ? '1.6 / 1' : '1.1 / 1',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 28,
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          color: 'var(--fg-3)',
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--surface-3)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--surface-3)' }} />
        <span style={{ width: 10, height: 10, borderRadius: 99, background: 'var(--surface-3)' }} />
        <span style={{ flex: 1, textAlign: 'center', letterSpacing: '0.04em' }}>NShroud</span>
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            width: 44,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface-2)',
            padding: '12px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {ICON_PATHS.map((it, i) => (
            <div
              key={i}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: it.active ? 'var(--surface-3)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: it.active ? 'var(--fg)' : 'var(--fg-3)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d={it.path} />
              </svg>
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 99,
              background: 'var(--surface-3)',
              border: '1px solid var(--border)',
            }}
          />
        </div>
        <div
          style={{
            width: '34%',
            minWidth: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '14px 16px 10px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: 'var(--fg-3)',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Recent messages
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {CHATS.map((c, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: c.active ? 'var(--surface-2)' : 'transparent',
                  borderLeft: c.active ? '2px solid var(--fg)' : '2px solid transparent',
                  minWidth: 0,
                }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: c.group ? 6 : 99,
                      background: 'var(--surface-3)',
                    }}
                  />
                  {c.dot && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: -1,
                        right: -1,
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background:
                          c.dot === 'online'
                            ? 'var(--fg)'
                            : c.dot === 'idle'
                              ? 'var(--fg-3)'
                              : 'var(--surface-3)',
                        border: '2px solid var(--surface)',
                      }}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: 'var(--fg)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: 'var(--fg-3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.last}
                  </div>
                </div>
                <span style={{ fontSize: 9.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                  {c.t}
                </span>
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ width: 24, height: 24, borderRadius: 99, background: 'var(--surface-3)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--fg)' }}>you</div>
              <div style={{ fontSize: 10, color: 'var(--fg-3)' }}>online</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surface-3)' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Security Engineering</div>
              <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                7 members · group · MLS epoch 184
              </div>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '12px 18px',
              gap: 10,
            }}
          >
            <div style={{ alignSelf: 'center', fontSize: 9.5, fontFamily: 'var(--font-mono)', color: 'var(--fg-4)' }}>
              Today · 09:42
            </div>
            <MsgBubble who="them" name="Asha" body="MLS ratchet roll-up shipped. epoch 184 ok across all 7 leaves." />
            <MsgBubble who="me" body="In review. Going out with 0.5.2." />
            <MsgBubble who="them" name="Asha" body="" attach />
          </div>
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 30,
                borderRadius: 6,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                fontSize: 11,
                color: 'var(--fg-3)',
              }}
            >
              Message Security Engineering — encrypted
            </div>
            <div style={{ width: 30, height: 30, borderRadius: 6, background: 'var(--fg)' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Hero({ grid = true }) {
  return (
    <header className="section" style={{ position: 'relative', overflow: 'hidden' }}>
      {grid && <HeroBackdrop />}
      <div
        className="container"
        style={{ position: 'relative', zIndex: 1, paddingTop: 72, paddingBottom: 96 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 64, alignItems: 'center' }}>
          <div>
            <HeroEyebrow />
            <h1 className="h-display">
              Message freely.
              <br />
              <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--fg-2)' }}>
                And securely.
              </em>
            </h1>
            <p className="lede" style={{ marginTop: 28 }}>
              NShroud is private team chat for companies that handle things they can't afford to leak. It feels like the messenger your team already knows — but every conversation is locked to your own devices, leaving the people who run the service, us included, with nothing but ciphertext.
            </p>
            <HeroCTAs />
          </div>
          <AppMockup />
        </div>
        <HeroTicker />
      </div>
    </header>
  )
}
