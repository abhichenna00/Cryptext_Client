import { useEffect, useState } from 'react'
import Logo from './Logo.jsx'

export default function Nav({ active = 'home', changelogVersion = 'v0.5.1' }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '/#features', label: 'Product', key: 'product' },
    { href: '/#how', label: 'How it works', key: 'how' },
    { href: '/#pricing', label: 'Pricing', key: 'pricing' },
    { href: 'https://datatracker.ietf.org/doc/rfc9420/', label: 'Docs', key: 'docs', external: true },
    { href: '/changelog', label: 'Changelog', key: 'changelog' },
  ]

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
        background: scrolled ? 'color-mix(in srgb, var(--bg) 78%, transparent)' : 'transparent',
        backdropFilter: scrolled ? 'blur(16px) saturate(160%)' : 'none',
        transition: 'background .2s ease, border-color .2s ease',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
        }}
      >
        <a href="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <Logo />
          <span
            style={{
              marginLeft: 10,
              padding: '2px 6px',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--hl)',
              border: '1px solid color-mix(in srgb, var(--hl) 35%, transparent)',
              borderRadius: 4,
            }}
          >
            {changelogVersion}
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {links.map((l) => (
            <a
              key={l.key}
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
              style={{
                padding: '6px 12px',
                fontSize: 13.5,
                color: active === l.key ? 'var(--fg)' : 'var(--fg-2)',
                fontWeight: active === l.key ? 500 : 400,
                transition: 'color .15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg)')}
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = active === l.key ? 'var(--fg)' : 'var(--fg-2)')
              }
            >
              {l.label}
            </a>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a
            href="https://github.com/abhichenna00/NShroud"
            className="btn btn-ghost btn-sm"
            target="_blank"
            rel="noopener"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.67.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
            </svg>
            GitHub
          </a>
          <a href="#" className="btn btn-secondary btn-sm">
            Sign in
          </a>
          <a href="/#pricing" className="btn btn-primary btn-sm btn-arrow">
            Get hosted
          </a>
        </div>
      </div>
    </nav>
  )
}
