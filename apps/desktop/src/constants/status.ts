export type Status = 'online' | 'idle' | 'dnd' | 'offline'

export const STATUS_COLORS: Record<Status, string> = {
  online: '#22c55e',
  idle: '#eab308',
  dnd: '#ef4444',
  offline: '#6b7280',
}

export const STATUS_LABELS: Record<Status, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  offline: 'Offline',
}

export const STATUS_OPTIONS: { value: Status; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: STATUS_COLORS.online },
  { value: 'idle', label: 'Idle', color: STATUS_COLORS.idle },
  { value: 'dnd', label: 'Do Not Disturb', color: STATUS_COLORS.dnd },
  { value: 'offline', label: 'Invisible', color: STATUS_COLORS.offline },
]
