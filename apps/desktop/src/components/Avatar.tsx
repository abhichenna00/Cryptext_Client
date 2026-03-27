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

export default function Avatar({ src, fallback, size = 'md', status, showStatus = false, className = '' }: AvatarProps) {
  const statusColor = STATUS_COLORS[(status as Status) || 'offline']

  return (
    <div className={`avatar ${sizeClasses[size]} ${className}`}>
      {src ? (
        <img src={src} alt={fallback} className="avatar-image" />
      ) : (
        <span className="avatar-fallback">{fallback.charAt(0).toUpperCase()}</span>
      )}
      {showStatus && (
        <div className="status-indicator" style={{ backgroundColor: statusColor }} />
      )}
    </div>
  )
}
