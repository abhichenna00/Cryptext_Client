import { useId, type SVGProps } from 'react'

interface NshroudMarkProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'xmlns'> {
  /** Hover tooltip text. Also sets role="img" and aria-label for accessibility. */
  title?: string
}

/**
 * NShroud brand mark, inlined as a React component so `currentColor` resolves
 * to the host element's `color`. Style with `className="text-fg"` (or any
 * Tailwind text-color utility) to recolor the frame, hatch lines, and
 * dashed outline.
 *
 * The N silhouette is rendered as a transparent knockout through the hatched
 * frame — whatever sits behind the mark shows through it. That means the
 * "N color" follows the page background automatically with no theme wiring.
 */
export default function NshroudMark({ title, ...props }: NshroudMarkProps) {
  // Per-instance unique ids so multiple marks on the same page don't collide.
  const reactId = useId()
  const hatchId = `nshroud-hatch-${reactId}`
  const maskId = `nshroud-mask-${reactId}`

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
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.4" />
        </pattern>
        <mask id={maskId}>
          <rect x="4" y="4" width="56" height="56" fill="white" />
          <path d="M17 16 H25 L40 38 V16 H47 V48 H39 L24 26 V48 H17 Z" fill="black" />
        </mask>
      </defs>

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
        d="M14 13 H26.5 L37 28 V13 H50 V51 H37.5 L27 36 V51 H14 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 2"
        opacity="0.85"
      />
    </svg>
  )
}
