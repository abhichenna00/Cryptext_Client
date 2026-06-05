import { useId, type SVGProps } from 'react'

interface NshroudMarkProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'> {
  /** Hover tooltip text. Also sets role="img" and aria-label for accessibility. */
  title?: string
  /**
   * Paint the mark with the NShroud ember gradient (amber → red) instead of
   * `currentColor`. Matches the canonical brand icon
   * (`apps/web/public/NShroud-icon.svg`).
   */
  gradient?: boolean
}

// Shared geometry, hoisted so the mono and gradient renders can't drift apart.
// The N silhouette is knocked out of the hatched frame; the dashed path is the
// decorative inner outline.
const N_KNOCKOUT = 'M17 16 H25 L40 38 V16 H47 V48 H39 L24 26 V48 H17 Z'
const N_OUTLINE = 'M14 13 H26.5 L37 28 V13 H50 V51 H37.5 L27 36 V51 H14 Z'

/**
 * NShroud brand mark, inlined as a React component so `currentColor` resolves
 * to the host element's `color`. Style with `className="text-fg"` (or any
 * Tailwind text-color utility) to recolor the frame, hatch lines, and
 * dashed outline.
 *
 * The N silhouette is rendered as a transparent knockout through the hatched
 * frame — whatever sits behind the mark shows through it. That means the
 * "N color" follows the page background automatically with no theme wiring.
 *
 * Pass `gradient` to paint the mark with the ember brand gradient instead. In
 * that mode the structural strokes become a luminance mask and a single
 * full-bleed gradient rect is painted through it — mirroring the canonical
 * icon — which also sidesteps the fact that a gradient referenced from inside
 * a `<pattern>` tile would otherwise resolve per-tile rather than icon-wide.
 */
export default function NshroudMark({ title, gradient, ...props }: NshroudMarkProps) {
  // Per-instance unique ids so multiple marks on the same page don't collide.
  const reactId = useId()
  const hatchId = `nshroud-hatch-${reactId}`
  const maskId = `nshroud-mask-${reactId}`
  const gradId = `nshroud-grad-${reactId}`
  const inkId = `nshroud-ink-${reactId}`

  // In gradient mode the strokes paint white into a mask; otherwise they paint
  // the host color directly.
  const inkColor = gradient ? '#fff' : 'currentColor'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title && <title>{title}</title>}
      <defs>
        <pattern
          id={hatchId}
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <line x1="0" y1="0" x2="0" y2="4" stroke={inkColor} strokeWidth="1.4" />
        </pattern>
        <mask id={maskId}>
          <rect x="4" y="4" width="56" height="56" fill="white" />
          <path d={N_KNOCKOUT} fill="black" />
        </mask>
        {gradient && (
          <>
            <linearGradient
              id={gradId}
              x1="14"
              y1="14"
              x2="50"
              y2="50"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#f59e0b" />
              <stop offset="1" stopColor="#ef4444" />
            </linearGradient>
            {/* Ink mask: the same frame + hatch + dashed outline, painted white
                so its luminance becomes the alpha for the gradient rect below. */}
            <mask id={inkId}>
              <rect x="4" y="4" width="56" height="56" fill="none" stroke="#fff" strokeWidth="3" />
              <rect
                x="4"
                y="4"
                width="56"
                height="56"
                fill={`url(#${hatchId})`}
                mask={`url(#${maskId})`}
              />
              <path
                d={N_OUTLINE}
                fill="none"
                stroke="#fff"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.85"
              />
            </mask>
          </>
        )}
      </defs>

      {gradient ? (
        <rect x="0" y="0" width="64" height="64" fill={`url(#${gradId})`} mask={`url(#${inkId})`} />
      ) : (
        <>
          <rect
            x="4"
            y="4"
            width="56"
            height="56"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
          <rect
            x="4"
            y="4"
            width="56"
            height="56"
            fill={`url(#${hatchId})`}
            mask={`url(#${maskId})`}
          />
          <path
            d={N_OUTLINE}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.85"
          />
        </>
      )}
    </svg>
  )
}
