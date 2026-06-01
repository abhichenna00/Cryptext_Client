import { useId } from 'react'

// NShroud mark — the slatted-N: the N silhouette filled with horizontal
// rounded louvers ("slats"), painted in a recolorable gradient (--ns-from →
// --ns-to). This is the brand's one splash of color on an otherwise mono site.
const NI_PATH = 'M16.5 15.5 H25.3 L39.5 36.3 V15.5 H47.5 V48.5 H38.7 L24.5 27.7 V48.5 H16.5 Z'

export default function Logo({ size = 24, showWordmark = true }) {
  const uid = useId().replace(/:/g, '')
  const gradId = `ns-grad-${uid}`
  const hatchId = `ns-hatch-${uid}`
  const nmaskId = `ns-nmask-${uid}`
  const inkId = `ns-ink-${uid}`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11, color: 'var(--fg)' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gradId} x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--ns-from)" />
            <stop offset="1" stopColor="var(--ns-to)" />
          </linearGradient>
          <pattern
            id={hatchId}
            width="2.6"
            height="2.6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-45)"
          >
            <line x1="0" y1="0" x2="0" y2="2.6" stroke="#fff" strokeWidth="1.6" />
          </pattern>
          <mask id={nmaskId}>
            <rect x="4" y="4" width="56" height="56" fill="#fff" />
            <path d={NI_PATH} fill="#000" />
          </mask>
          <mask id={inkId}>
            <rect x="4" y="4" width="56" height="56" fill="none" stroke="#fff" strokeWidth="3" />
            <rect x="4" y="4" width="56" height="56" fill={`url(#${hatchId})`} mask={`url(#${nmaskId})`} />
            <path d={NI_PATH} fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
          </mask>
        </defs>
        <rect x="0" y="0" width="64" height="64" fill={`url(#${gradId})`} mask={`url(#${inkId})`} />
      </svg>
      {showWordmark && (
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 17,
            letterSpacing: '-0.02em',
          }}
        >
          N<span style={{ opacity: 0.62, fontWeight: 500 }}>Shroud</span>
        </span>
      )}
    </span>
  )
}
