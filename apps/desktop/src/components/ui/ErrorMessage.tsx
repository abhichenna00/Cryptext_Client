import { Text } from '@radix-ui/themes'

interface ErrorMessageProps {
  error: string | null
  variant?: 'banner' | 'inline'
  className?: string
}

export function ErrorMessage({ error, variant = 'banner', className }: ErrorMessageProps) {
  if (!error) return null

  if (variant === 'inline') {
    return (
      <Text color="red" size="2" align="center">
        {error}
      </Text>
    )
  }

  return (
    <div className={className ?? 'error-banner'} style={!className ? {
      background: 'var(--red-3)',
      color: 'var(--red-11)',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '13px',
      marginBottom: '8px',
    } : undefined}>
      {error}
    </div>
  )
}
