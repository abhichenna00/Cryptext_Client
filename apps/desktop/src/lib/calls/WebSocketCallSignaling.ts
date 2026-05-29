import type {
  AnswerPayload,
  CallAcceptedElsewherePayload,
  CallSignalingChannel,
  DeclinePayload,
  EndPayload,
  IcePayload,
  InvitePayload,
  Unsubscribe,
} from './CallSignalingChannel'

type WsFrame = { action: string; [key: string]: unknown }

interface WsHost {
  sendMessage: (data: WsFrame) => void
  subscribe: (callback: (data: WsFrame) => void) => () => void
}

type ParsedEvent =
  | { kind: 'invite'; payload: InvitePayload }
  | { kind: 'answer'; payload: AnswerPayload }
  | { kind: 'decline'; payload: DeclinePayload }
  | { kind: 'end'; payload: EndPayload }
  | { kind: 'ice'; payload: IcePayload }
  | { kind: 'accepted_elsewhere'; payload: CallAcceptedElsewherePayload }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asOptionalString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parseSdpString(raw: string): RTCSessionDescriptionInit | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const type = parsed.type
    const sdp = parsed.sdp
    if (type !== 'offer' && type !== 'answer' && type !== 'pranswer' && type !== 'rollback') {
      return null
    }
    if (typeof sdp !== 'string' && typeof sdp !== 'undefined') return null
    return { type, sdp: typeof sdp === 'string' ? sdp : undefined }
  } catch {
    return null
  }
}

function parseCandidateString(raw: string): RTCIceCandidateInit | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const candidate = parsed.candidate
    if (typeof candidate !== 'string') return null
    const out: RTCIceCandidateInit = { candidate }
    if (typeof parsed.sdpMid === 'string' || parsed.sdpMid === null) {
      out.sdpMid = parsed.sdpMid as string | null
    }
    if (typeof parsed.sdpMLineIndex === 'number' || parsed.sdpMLineIndex === null) {
      out.sdpMLineIndex = parsed.sdpMLineIndex as number | null
    }
    if (typeof parsed.usernameFragment === 'string') {
      out.usernameFragment = parsed.usernameFragment
    }
    return out
  } catch {
    return null
  }
}

export class WebSocketCallSignaling implements CallSignalingChannel {
  #ws: WsHost
  #unsubscribers: Array<() => void> = []
  #inviteHandlers = new Set<(p: InvitePayload) => void>()
  #answerHandlers = new Set<(p: AnswerPayload) => void>()
  #declineHandlers = new Set<(p: DeclinePayload) => void>()
  #endHandlers = new Set<(p: EndPayload) => void>()
  #iceHandlers = new Set<(p: IcePayload) => void>()
  #acceptedElsewhereHandlers = new Set<(p: CallAcceptedElsewherePayload) => void>()

  constructor(ws: WsHost) {
    this.#ws = ws
    const off = this.#ws.subscribe((data) => this.#dispatch(data))
    this.#unsubscribers.push(off)
  }

  dispose(): void {
    for (const off of this.#unsubscribers) off()
    this.#unsubscribers = []
    this.#inviteHandlers.clear()
    this.#answerHandlers.clear()
    this.#declineHandlers.clear()
    this.#endHandlers.clear()
    this.#iceHandlers.clear()
    this.#acceptedElsewhereHandlers.clear()
  }

  async sendInvite(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.#ws.sendMessage({
      action: 'call_invite',
      conversation_id: conversationId,
      sdp: JSON.stringify(sdp),
    })
  }

  async sendAnswer(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.#ws.sendMessage({
      action: 'call_answer',
      conversation_id: conversationId,
      sdp: JSON.stringify(sdp),
    })
  }

  async sendDecline(conversationId: string, reason?: string): Promise<void> {
    const frame: WsFrame = {
      action: 'call_decline',
      conversation_id: conversationId,
    }
    if (typeof reason === 'string') frame.reason = reason
    this.#ws.sendMessage(frame)
  }

  async sendEnd(conversationId: string): Promise<void> {
    this.#ws.sendMessage({
      action: 'call_end',
      conversation_id: conversationId,
    })
  }

  async sendIceCandidate(conversationId: string, candidate: RTCIceCandidateInit): Promise<void> {
    this.#ws.sendMessage({
      action: 'ice_candidate',
      conversation_id: conversationId,
      candidate: JSON.stringify(candidate),
    })
  }

  onInvite(handler: (payload: InvitePayload) => void): Unsubscribe {
    this.#inviteHandlers.add(handler)
    return () => this.#inviteHandlers.delete(handler)
  }

  onAnswer(handler: (payload: AnswerPayload) => void): Unsubscribe {
    this.#answerHandlers.add(handler)
    return () => this.#answerHandlers.delete(handler)
  }

  onDecline(handler: (payload: DeclinePayload) => void): Unsubscribe {
    this.#declineHandlers.add(handler)
    return () => this.#declineHandlers.delete(handler)
  }

  onEnd(handler: (payload: EndPayload) => void): Unsubscribe {
    this.#endHandlers.add(handler)
    return () => this.#endHandlers.delete(handler)
  }

  onIceCandidate(handler: (payload: IcePayload) => void): Unsubscribe {
    this.#iceHandlers.add(handler)
    return () => this.#iceHandlers.delete(handler)
  }

  onCallAcceptedElsewhere(
    handler: (payload: CallAcceptedElsewherePayload) => void,
  ): Unsubscribe {
    this.#acceptedElsewhereHandlers.add(handler)
    return () => this.#acceptedElsewhereHandlers.delete(handler)
  }

  #dispatch(raw: unknown): void {
    const event = this.#parseInbound(raw)
    if (!event) return
    switch (event.kind) {
      case 'invite':
        for (const h of this.#inviteHandlers) h(event.payload)
        return
      case 'answer':
        for (const h of this.#answerHandlers) h(event.payload)
        return
      case 'decline':
        for (const h of this.#declineHandlers) h(event.payload)
        return
      case 'end':
        for (const h of this.#endHandlers) h(event.payload)
        return
      case 'ice':
        for (const h of this.#iceHandlers) h(event.payload)
        return
      case 'accepted_elsewhere':
        for (const h of this.#acceptedElsewhereHandlers) h(event.payload)
        return
    }
  }

  #parseInbound(raw: unknown): ParsedEvent | null {
    if (!isRecord(raw)) return null
    const action = asString(raw.action)
    if (!action) return null

    switch (action) {
      case 'call_invite': {
        const conversationId = asString(raw.conversation_id)
        const sdpRaw = asString(raw.sdp)
        if (!conversationId || sdpRaw === null) return null
        const sdp = parseSdpString(sdpRaw)
        if (!sdp) return null
        return {
          kind: 'invite',
          payload: {
            conversationId,
            fromUserId: asOptionalString(raw.from_user_id),
            fromDeviceId: asOptionalString(raw.from_device_id),
            sdp,
          },
        }
      }
      case 'call_answer': {
        const conversationId = asString(raw.conversation_id)
        const sdpRaw = asString(raw.sdp)
        if (!conversationId || sdpRaw === null) return null
        const sdp = parseSdpString(sdpRaw)
        if (!sdp) return null
        return {
          kind: 'answer',
          payload: {
            conversationId,
            fromUserId: asOptionalString(raw.from_user_id),
            fromDeviceId: asOptionalString(raw.from_device_id),
            sdp,
          },
        }
      }
      case 'call_decline': {
        const conversationId = asString(raw.conversation_id)
        if (!conversationId) return null
        const payload: DeclinePayload = {
          conversationId,
          fromUserId: asOptionalString(raw.from_user_id),
          fromDeviceId: asOptionalString(raw.from_device_id),
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        }
        return { kind: 'decline', payload }
      }
      case 'call_end': {
        const conversationId = asString(raw.conversation_id)
        if (!conversationId) return null
        return {
          kind: 'end',
          payload: {
            conversationId,
            fromUserId: asOptionalString(raw.from_user_id),
            fromDeviceId: asOptionalString(raw.from_device_id),
          },
        }
      }
      case 'ice_candidate': {
        const conversationId = asString(raw.conversation_id)
        const candidateRaw = asString(raw.candidate)
        if (!conversationId || candidateRaw === null) return null
        const candidate = parseCandidateString(candidateRaw)
        if (!candidate) return null
        return {
          kind: 'ice',
          payload: {
            conversationId,
            fromUserId: asOptionalString(raw.from_user_id),
            fromDeviceId: asOptionalString(raw.from_device_id),
            candidate,
          },
        }
      }
      case 'call_accepted_elsewhere': {
        const conversationId = asString(raw.conversation_id)
        if (!conversationId) return null
        return { kind: 'accepted_elsewhere', payload: { conversationId } }
      }
      default:
        return null
    }
  }
}
