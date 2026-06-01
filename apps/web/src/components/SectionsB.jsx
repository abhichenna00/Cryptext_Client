// Landing sections: Architecture, Pricing, ChangelogTeaser, FinalCTA.

// ─── ARCHITECTURE ─────────────────────────────────────────────────────────
const ARCH_META = [
  ['Ships as', 'A single Docker image · pulled from GHCR'],
  ['Run it on', 'Our cloud · your VPC · on-prem · air-gapped'],
  ['Data residency', 'Your region, your retention, your control'],
  ['Backing services', 'Postgres · object storage · Redis — yours or managed'],
  ['Identity', 'Email/password · Google · Microsoft Entra SSO'],
  ['Managed option', 'Prefer hands-off? We host and operate it for you'],
]

function Col({ title, children }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--fg-3)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 4,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Node({ title, sub, highlight }) {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--bg)',
        border: highlight ? '1px solid var(--border-strong)' : '1px solid var(--border)',
        borderRadius: 8,
        position: 'relative',
        ...(highlight && { boxShadow: '0 0 0 3px var(--accent-soft)' }),
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)' }}>{title}</div>
      {sub && (
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)', marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function ArchDiagram() {
  return (
    <div
      style={{
        position: 'relative',
        padding: 28,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(circle at 1px 1px, var(--border-strong) 1px, transparent 0)',
        backgroundSize: '20px 20px',
      }}
    >
      <div style={{ display: 'flex', gap: 28, position: 'relative', zIndex: 1 }}>
        <Col title="Your devices">
          <Node title="Desktop client" sub="Windows · Linux · macOS soon" highlight />
          <Node title="OpenMLS" sub="encrypt · decrypt · ratchet" />
          <Node title="SQLCipher" sub="local vault" />
          <Node title="Mobile (coming)" sub="iOS · Android" />
        </Col>
        <Col title="The container">
          <Node title="Axum + Tokio" sub="routes ciphertext" highlight />
          <Node title="Redis" sub="JWKS · OAuth · WS pub/sub" />
          <Node title="Watchtower" sub="auto-deploys :latest" />
          <Node title="Docker Compose" sub="any host you choose" />
        </Col>
        <Col title="Backing services">
          <Node title="Postgres" sub="ciphertext · metadata" />
          <Node title="Object storage" sub="encrypted media blobs" />
          <Node title="Identity / SSO" sub="OIDC · Entra · Google" />
          <Node title="CDN" sub="avatar delivery" />
        </Col>
      </div>
      <svg
        style={{
          position: 'absolute',
          inset: 28,
          pointerEvents: 'none',
          width: 'calc(100% - 56px)',
          height: 'calc(100% - 56px)',
        }}
        preserveAspectRatio="none"
      >
        <line x1="33%" y1="50%" x2="36%" y2="50%" stroke="var(--fg-3)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="66%" y1="50%" x2="69%" y2="50%" stroke="var(--fg-3)" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      <div
        className="mono"
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          fontSize: 10.5,
          color: 'var(--fg-3)',
          textAlign: 'center',
          letterSpacing: '0.04em',
        }}
      >
        ←—— ciphertext over HTTPS + WSS ——→
      </div>
    </div>
  )
}

export function Architecture() {
  return (
    <section id="architecture" className="section" style={{ background: 'var(--surface)' }}>
      <div className="container section-inner">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 64, alignItems: 'start' }}>
          <div>
            <span className="eyebrow">Deployment</span>
            <h2 className="h-1" style={{ marginTop: 16 }}>
              Your servers, or ours.
            </h2>
            <p className="lede" style={{ marginTop: 20, fontSize: 15 }}>
              NShroud ships as a single Docker container. Because the server only ever holds ciphertext, where it runs is your call — our managed cloud, your own VPC, on-prem, or fully air-gapped. Nothing about the security model is tied to AWS, or to us.
            </p>
            <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {ARCH_META.map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr',
                    gap: 16,
                    padding: '12px 0',
                    borderTop: '1px solid var(--border)',
                    fontSize: 13,
                  }}
                >
                  <span className="mono" style={{ fontSize: 11, color: 'var(--hl)' }}>
                    {k}
                  </span>
                  <span style={{ color: 'var(--fg-2)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <ArchDiagram />
        </div>
      </div>
    </section>
  )
}

// ─── PRICING ──────────────────────────────────────────────────────────────
const TIERS = [
  {
    name: 'Free',
    price: 'Free',
    sub: 'for public use, forever',
    blurb:
      'The full end-to-end encrypted core, hosted by us, for individuals and teams that just want to message privately. Every conversation is sealed the same way.',
    features: [
      '1:1 & group chats, encrypted media & files',
      'Forward secrecy on every message (MLS)',
      'Email/password & Google sign-in',
      'Managed hosting on our infrastructure',
      'Community support',
    ],
    cta: 'Get started',
    ctaSecondary: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    sub: 'annual contract',
    blurb:
      'For organizations that need control. Self-host the container on your own infrastructure, set your data residency, and get the SSO and operational guarantees IT signs off on.',
    features: [
      'Self-host the container on your infra, or have us run it',
      'Microsoft Entra & Google Workspace SSO',
      'Choose your region · BYOK envelope encryption',
      'Security review · DPA · custom terms',
      'Named CSM · 4-hour incident SLA',
    ],
    cta: 'Contact sales',
    featured: true,
  },
]

export function Pricing() {
  return (
    <section id="pricing" className="section">
      <div className="container section-inner">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            marginBottom: 56,
          }}
        >
          <span className="eyebrow">Pricing</span>
          <h2 className="h-1" style={{ marginTop: 16, maxWidth: 720 }}>
            Free for everyone. Enterprise when you need control.
          </h2>
          <p className="lede" style={{ marginTop: 18 }}>
            Every plan ships the same end-to-end encrypted core. Use it free on our hosting, or run the container on your own infrastructure with the controls enterprises require.
          </p>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 0,
            maxWidth: 820,
            margin: '0 auto',
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          {TIERS.map((t, i) => (
            <div
              key={t.name}
              style={{
                padding: 32,
                background: t.featured ? 'var(--surface)' : 'var(--bg)',
                borderRight: i < TIERS.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
              }}
            >
              {t.featured && (
                <span className="pill" style={{ position: 'absolute', top: 20, right: 20 }}>
                  <span className="pill-dot" /> Recommended
                </span>
              )}
              <div className="eyebrow">{t.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 18 }}>
                <span style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em' }}>{t.price}</span>
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
                {t.sub}
              </div>
              <p className="small" style={{ marginTop: 16, minHeight: 60 }}>
                {t.blurb}
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '24px 0 28px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  flex: 1,
                }}
              >
                {t.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: 'flex',
                      alignItems: 'start',
                      gap: 10,
                      fontSize: 13,
                      color: 'var(--fg-2)',
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ marginTop: 4, color: 'var(--hl)', flexShrink: 0 }}
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a href="#" className={t.ctaSecondary ? 'btn btn-secondary btn-arrow' : 'btn btn-primary btn-arrow'}>
                {t.cta}
              </a>
            </div>
          ))}
        </div>
        <div className="small" style={{ textAlign: 'center', marginTop: 28, color: 'var(--fg-3)' }}>
          Enterprise pricing is scoped to your deployment. Talk to us.
        </div>
      </div>
    </section>
  )
}

// ─── CHANGELOG TEASER ─────────────────────────────────────────────────────
export function ChangelogTeaser({ releases = [] }) {
  const recent = releases.slice(0, 3)
  return (
    <section id="changelog" className="section">
      <div className="container section-inner">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'end',
            marginBottom: 40,
            flexWrap: 'wrap',
            gap: 24,
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <span className="eyebrow">Changelog</span>
            <h2 className="h-1" style={{ marginTop: 16 }}>
              Shipped, weekly.
            </h2>
            <p className="lede" style={{ marginTop: 18, fontSize: 16 }}>
              We publish every change, from security fixes to refactors to the occasional user-visible feature. Sourced live from <code className="kbd">CHANGELOG.md</code>.
            </p>
          </div>
          <a href="/changelog" className="btn btn-secondary btn-arrow">
            Full changelog
          </a>
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          {recent.map((r, i) => (
            <a
              key={r.version}
              href={`/changelog#v${r.version}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr auto',
                gap: 24,
                padding: '24px 28px',
                borderTop: i ? '1px solid var(--border)' : 'none',
                transition: 'background .15s ease',
                alignItems: 'start',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    color: 'var(--hl)',
                  }}
                >
                  v{r.version}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 4 }}>
                  {r.date}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 10 }}>{r.summary}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {r.sections.map((s) => (
                    <span key={s.kind} className="pill" style={{ borderColor: 'var(--border)' }}>
                      {s.kind} · {s.items.length}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ color: 'var(--hl)', fontSize: 18 }}>→</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── FINAL CTA ────────────────────────────────────────────────────────────
export function FinalCTA() {
  return (
    <section className="section" style={{ background: 'var(--surface)' }}>
      <div className="container" style={{ padding: '60px 24px', textAlign: 'center' }}>
        <span className="eyebrow">Get started</span>
        <h2
          className="h-display"
          style={{ marginTop: 20, maxWidth: 820, marginLeft: 'auto', marginRight: 'auto' }}
        >
          Bring your team
          <br />
          <em style={{ fontStyle: 'italic', fontWeight: 400, color: 'var(--fg-2)' }}>
            into private rooms.
          </em>
        </h2>
        <p className="lede" style={{ marginTop: 24, marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}>
          Free for public use, or self-hosted on your own infrastructure. Your team is messaging privately by the end of the afternoon.
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 12,
            marginTop: 36,
            flexWrap: 'wrap',
          }}
        >
          <a href="#pricing" className="btn btn-primary btn-arrow">
            Get started
          </a>
          <a href="#" className="btn btn-secondary">
            Book a demo
          </a>
        </div>
      </div>
    </section>
  )
}
