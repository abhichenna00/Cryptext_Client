export type CallStatus =
  | 'idle'
  | 'outgoing-ringing'
  | 'incoming-ringing'
  | 'connecting'
  | 'in-call'
  | 'ended'
  | 'error'

export type CallMode = 'audio' | 'video'

export type CallSnapshot = Readonly<{
  status: CallStatus
  mode: CallMode
  conversationId: string | null
  peerUserId: string | null
  error: string | null
  micEnabled: boolean
  cameraEnabled: boolean
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
