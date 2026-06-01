import Logo from './Logo.jsx'

const GROUPS = [
  {
    title: 'Product',
    links: [
      ['Features', '/#features'],
      ['Security', '/#security'],
      ['Architecture', '/#architecture'],
      ['Pricing', '/#pricing'],
      ['Changelog', '/changelog'],
    ],
  },
  {
    title: 'Developers',
    links: [
      ['GitHub', 'https://github.com/abhichenna00/Cryptext_Client'],
      ['Documentation', 'https://datatracker.ietf.org/doc/rfc9420/'],
      ['API reference', '#'],
      ['MLS protocol (RFC 9420)', 'https://datatracker.ietf.org/doc/rfc9420/'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About', '#'],
      ['Contact', '#'],
      ['Security disclosure', '#'],
      ['Privacy', '#'],
      ['Terms', '#'],
    ],
  },
]

export default function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div className="container" style={{ padding: '64px 24px 32px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr repeat(3, 1fr)',
            gap: 48,
            paddingBottom: 48,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <Logo />
            <p className="small" style={{ marginTop: 16, maxWidth: 280 }}>
              End-to-end encrypted enterprise messaging built on MLS (RFC 9420). Hosted on AWS, audited in the open. Your keys never leave your device.
            </p>
          </div>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="eyebrow" style={{ marginBottom: 16 }}>
                {g.title}
              </div>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {g.links.map(([label, href]) => (
                  <li key={label}>
                    <a
                      href={href}
                      style={{ fontSize: 13.5, color: 'var(--fg-2)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-2)')}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 24,
            color: 'var(--fg-3)',
            fontSize: 12,
          }}
        >
          <span className="mono">© {new Date().getFullYear()} NShroud. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span className="mono">Source-available · pre-1.0</span>
            <span className="pill">
              <span className="pill-dot" />
              Systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}
