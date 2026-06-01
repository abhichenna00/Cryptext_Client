import { useState } from 'react'

const KIND_META = {
  Added: { dot: '+', tint: 'rgba(34, 197, 94, 0.16)' },
  Changed: { dot: '~', tint: 'rgba(244, 244, 245, 0.08)' },
  Fixed: { dot: '✓', tint: 'rgba(6, 182, 212, 0.16)' },
  Security: { dot: '!', tint: 'rgba(245, 158, 11, 0.16)' },
  Removed: { dot: '−', tint: 'rgba(244, 63, 94, 0.16)' },
}

function ReleaseEntry({ release, first }) {
  const meta = (kind) => KIND_META[kind] ?? KIND_META.Changed
  return (
    <article
      id={`v${release.version}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 56,
        padding: '56px 0',
        borderTop: '1px solid var(--border)',
        position: 'relative',
        scrollMarginTop: 80,
      }}
    >
      <div style={{ position: 'sticky', top: 88, alignSelf: 'start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span
            style={{
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: '-0.025em',
              color: 'var(--hl)',
            }}
          >
            v{release.version}
          </span>
          {first && (
            <span className="pill">
              <span className="pill-dot" />
              Latest
            </span>
          )}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--fg-3)' }}>
          {release.date}
        </div>
        <div style={{ marginTop: 16 }}>
          <span
            className="pill"
            style={{
              background: release.tag === 'minor' ? 'var(--surface-2)' : 'transparent',
            }}
          >
            {release.tag}
          </span>
        </div>
        <a
          href={`https://github.com/abhichenna00/Cryptext_Client/releases/tag/v${release.version}`}
          target="_blank"
          rel="noopener"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 20,
            fontSize: 12,
            color: 'var(--fg-2)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.67.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
          </svg>
          View on GitHub
          <span style={{ color: 'var(--fg-3)' }}>↗</span>
        </a>
      </div>

      <div>
        {release.summary && (
          <h2 className="h-2" style={{ marginBottom: 28, color: 'var(--fg)' }}>
            {release.summary}
          </h2>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {release.sections.map((s) => {
            const m = meta(s.kind)
            return (
              <div key={s.kind}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: m.tint,
                      border: '1px solid var(--border)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      fontWeight: 500,
                      color: 'var(--fg)',
                    }}
                  >
                    {m.dot}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--fg)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {s.kind}
                  </span>
                  <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span className="mono" style={{ fontSize: 11, color: 'var(--fg-4)' }}>
                    {s.items.length}
                  </span>
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {s.items.map((item, idx) => (
                    <li
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '14px 1fr',
                        gap: 14,
                        fontSize: 14,
                        lineHeight: 1.55,
                        color: 'var(--fg-2)',
                      }}
                    >
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          marginTop: 9,
                          borderRadius: 99,
                          background: 'var(--fg-3)',
                        }}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </article>
  )
}

export default function ChangelogPage({ releases = [] }) {
  const [filter, setFilter] = useState('all')

  const filtered = releases.filter((r) => {
    if (filter === 'all') return true
    if (filter === 'security') return r.sections.some((s) => s.kind === 'Security')
    return r.tag === filter
  })

  return (
    <main>
      <section className="section">
        <div className="container" style={{ paddingTop: 72, paddingBottom: 48 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 64, alignItems: 'end' }}>
            <div>
              <span className="eyebrow">Changelog</span>
              <h1 className="h-display" style={{ marginTop: 16, fontSize: 'clamp(40px, 5.6vw, 64px)' }}>
                Every change, shipped.
              </h1>
              <p className="lede" style={{ marginTop: 24 }}>
                Sourced live from <code className="kbd">CHANGELOG.md</code> on{' '}
                <a
                  href="https://github.com/abhichenna00/Cryptext_Client/blob/main/CHANGELOG.md"
                  target="_blank"
                  rel="noopener"
                  style={{ borderBottom: '1px solid var(--border-strong)', paddingBottom: 1 }}
                >
                  GitHub
                </a>
                . Format follows <span className="mono">Keep a Changelog</span>; versions follow{' '}
                <span className="mono">SemVer</span>.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                Filter
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[
                  ['all', 'All'],
                  ['minor', 'Minor'],
                  ['patch', 'Patch'],
                  ['security', 'Security'],
                ].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    style={{
                      appearance: 'none',
                      padding: '6px 14px',
                      border: filter === k ? '1px solid var(--hl)' : '1px solid var(--border-strong)',
                      background: filter === k ? 'var(--hl)' : 'transparent',
                      color: filter === k ? '#fff' : 'var(--fg-2)',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="small" style={{ marginTop: 4 }}>
                Showing{' '}
                <span className="mono" style={{ color: 'var(--fg)' }}>
                  {filtered.length}
                </span>{' '}
                of <span className="mono">{releases.length}</span> releases
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ paddingTop: 32, paddingBottom: 120 }}>
          {filtered.map((r, i) => (
            <ReleaseEntry key={r.version} release={r} first={i === 0} />
          ))}
          {filtered.length === 0 && (
            <div
              style={{
                padding: 64,
                textAlign: 'center',
                color: 'var(--fg-3)',
                border: '1px dashed var(--border)',
                borderRadius: 12,
              }}
            >
              No releases match this filter.
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
