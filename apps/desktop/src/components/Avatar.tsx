import { Status, STATUS_COLORS } from '@/constants/status'

interface AvatarProps {
  src?: string | null
  fallback: string
  size?: 'sm' | 'md' | 'lg'
  status?: string | null
  showStatus?: boolean
  className?: string
}

const sizeClasses = { sm: 'avatar-sm', md: 'avatar-md', lg: 'avatar-lg' }

// Only render avatar URLs that are https:// (or data: URIs for local previews).
// Protects against downgrade/MITM and javascript:/file: scheme injection if a
// profile row's avatar_url ever contains untrusted data.
function safeAvatarSrc(src?: string | null): string | null {
  if (!src) return null
  if (src.startsWith('https://') || src.startsWith('data:image/')) return src
  return null
}

export default function Avatar({ src, fallback, size = 'md', status, showStatus = false, className = '' }: AvatarProps) {
  const statusColor = STATUS_COLORS[(status as Status) || 'offline']
  const safeSrc = safeAvatarSrc(src)

  return (
    <div className={`avatar ${sizeClasses[size]} ${className}`}>
      {safeSrc ? (
        <img src={safeSrc} alt={fallback} className="avatar-image" />
      ) : (
        <span className="avatar-fallback">{fallback.charAt(0).toUpperCase()}</span>
      )}
      {showStatus && (
        <div className="status-indicator" style={{ backgroundColor: statusColor }} />
      )}
    </div>
  )
}
