// src/lib/calls/CallSignalingChannel.ts
//
// Transport-agnostic signaling contract for calls. CallManager depends only on
// this interface (send invite/answer/decline/end/ICE, and subscribe to the
// matching inbound events), so the actual transport — currently
// WebSocketCallSignaling — can be swapped without touching call logic. The
// payload types below are the normalized shapes handlers receive.

export type Unsubscribe = () => void

export type InvitePayload = Readonly<{
  conversationId: string
  fromUserId: string
  fromDeviceId: string
  sdp: RTCSessionDescriptionInit
}>

export type AnswerPayload = Readonly<{
  conversationId: string
  fromUserId: string
  fromDeviceId: string
  sdp: RTCSessionDescriptionInit
}>

export type DeclinePayload = Readonly<{
  conversationId: string
  fromUserId: string
  fromDeviceId: string
  reason?: string
}>

export type EndPayload = Readonly<{
  conversationId: string
  fromUserId: string
  fromDeviceId: string
}>

export type IcePayload = Readonly<{
  conversationId: string
  fromUserId: string
  fromDeviceId: string
  candidate: RTCIceCandidateInit
}>

export type CallAcceptedElsewherePayload = Readonly<{
  conversationId: string
}>

export interface CallSignalingChannel {
  sendInvite(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void>
  sendAnswer(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void>
  sendDecline(conversationId: string, reason?: string): Promise<void>
  sendEnd(conversationId: string): Promise<void>
  sendIceCandidate(conversationId: string, candidate: RTCIceCandidateInit): Promise<void>

  onInvite(handler: (payload: InvitePayload) => void): Unsubscribe
  onAnswer(handler: (payload: AnswerPayload) => void): Unsubscribe
  onDecline(handler: (payload: DeclinePayload) => void): Unsubscribe
  onEnd(handler: (payload: EndPayload) => void): Unsubscribe
  onIceCandidate(handler: (payload: IcePayload) => void): Unsubscribe
  onCallAcceptedElsewhere(handler: (payload: CallAcceptedElsewherePayload) => void): Unsubscribe
}
