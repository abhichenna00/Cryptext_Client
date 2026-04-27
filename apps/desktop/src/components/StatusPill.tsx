import { STATUS_COLORS, STATUS_LABELS, Status } from '@/constants/status'
import { cn } from '@/lib/utils'

interface StatusPillProps {
  status?: string | null
  className?: string
}

/**
 * Colored rounded pill that carries the status (Online / Idle / DND / Offline).
 * Text and border take the status color; background is the same color at 15%
 * alpha via `color-mix` so every state reads as a tinted badge rather than a
 * flat color block.
 */
export default function StatusPill({ status, className }: StatusPillProps) {
  const s = (status as Status) || 'offline'
  const color = STATUS_COLORS[s]
  return (
    <span
      className={cn(
        'inline-block rounded-full border px-[7px] py-[1px] text-[10px] font-semibold tracking-[0.02em]',
        className,
      )}
      style={{
        color,
        backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`,
        borderColor: `color-mix(in oklch, ${color} 30%, transparent)`,
      }}
    >
      {STATUS_LABELS[s]}
    </span>
  )
}
