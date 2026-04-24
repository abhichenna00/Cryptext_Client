import { Status, STATUS_COLORS } from '@/constants/status'
import {
  Avatar as UIAvatar,
  AvatarImage,
  AvatarFallback,
} from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

interface AvatarProps {
  src?: string | null
  fallback: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  status?: string | null
  showStatus?: boolean
  /** 0–360 hue for the fallback tint. Stable hashing happens at call site. */
  hue?: number
  className?: string
}

// Only render avatar URLs that are https:// or data:image/. Protects against
// downgrade/MITM and javascript:/file: scheme injection if a profile row's
// avatar_url ever contains untrusted data.
function safeAvatarSrc(src?: string | null): string | null {
  if (!src) return null
  if (src.startsWith('https://') || src.startsWith('data:image/')) return src
  return null
}

function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const sizeClass: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-12 text-sm',
  xl: 'size-16 text-base',
}

const statusDotClass: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3.5',
  xl: 'size-4',
}

export default function Avatar({
  src,
  fallback,
  size = 'md',
  status,
  showStatus = false,
  hue,
  className,
}: AvatarProps) {
  const statusColor = STATUS_COLORS[(status as Status) || 'offline']
  const safeSrc = safeAvatarSrc(src)

  const tintStyle =
    hue != null
      ? {
          background: `oklch(0.55 0.12 ${hue})`,
          color: 'oklch(0.97 0.003 240)',
        }
      : undefined

  // Wrap in a non-overflow-hidden box so the status dot can sit outside the
  // clipped circle. UIAvatar itself clips its image content to a round mask.
  return (
    <div className={cn('relative inline-flex shrink-0', sizeClass[size], className)}>
      <UIAvatar className="size-full">
        {safeSrc && <AvatarImage src={safeSrc} alt={fallback} />}
        <AvatarFallback
          className="bg-surface-2 text-fg-muted font-medium"
          style={tintStyle}
        >
          {initials(fallback)}
        </AvatarFallback>
      </UIAvatar>
      {showStatus && (
        <span
          className={cn(
            'absolute right-0 bottom-0 rounded-full ring-2 ring-[var(--surface)]',
            statusDotClass[size],
          )}
          style={{ backgroundColor: statusColor }}
          aria-hidden
        />
      )}
    </div>
  )
}
