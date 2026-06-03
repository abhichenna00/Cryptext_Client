export type CallStatus =
  | 'idle'
  | 'outgoing-ringing'
  | 'incoming-ringing'
  | 'connecting'
  | 'in-call'
  | 'ended'
  | 'error'

export type CallMode = 'audio' | 'video'

export type CallParticipantState = Readonly<{
  userId: string
  isSelf: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  joinedAt: number | null
}>

export type CallSnapshot = Readonly<{
  status: CallStatus
  mode: CallMode
  conversationId: string | null
  conversationType: 'dm' | 'group'
  error: string | null
  participants: ReadonlyArray<CallParticipantState>
  callStartedAt: number | null
  /** True when the local user has a usable mic track (can mute/unmute). */
  localAudioAvailable: boolean
  /** True when the local user has a usable camera track (can enable video). */
  localVideoAvailable: boolean
}>

export type CallConfig = Readonly<{
  iceServers: RTCIceServer[]
  ringTimeoutMs: number
}>

export const CALL_TRANSITIONS: Record<CallStatus, ReadonlyArray<CallStatus>> = {
  idle: ['outgoing-ringing', 'incoming-ringing'],
  'outgoing-ringing': ['connecting', 'ended', 'error'],
  'incoming-ringing': ['connecting', 'ended', 'error'],
  connecting: ['in-call', 'ended', 'error'],
  'in-call': ['ended', 'error'],
  ended: ['idle'],
  error: ['idle'],
}
