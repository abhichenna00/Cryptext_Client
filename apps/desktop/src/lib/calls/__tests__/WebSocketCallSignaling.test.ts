import { describe, expect, it } from 'vitest'
import { WebSocketCallSignaling } from '../WebSocketCallSignaling'
import type {
  AnswerPayload,
  CallAcceptedElsewherePayload,
  DeclinePayload,
  EndPayload,
  IcePayload,
  InvitePayload,
} from '../CallSignalingChannel'

type WsFrame = { action: string; [key: string]: unknown }
type Subscriber = (data: WsFrame) => void

class FakeWsHost {
  sent: WsFrame[] = []
  #subs = new Set<Subscriber>()

  sendMessage = (data: WsFrame): void => {
    this.sent.push(data)
  }

  subscribe = (callback: Subscriber): (() => void) => {
    this.#subs.add(callback)
    return () => {
      this.#subs.delete(callback)
    }
  }

  pushInbound(frame: Record<string, unknown>): void {
    for (const sub of this.#subs) sub(frame as WsFrame)
  }

  subscriberCount(): number {
    return this.#subs.size
  }
}

const OFFER_SDP: RTCSessionDescriptionInit = {
  type: 'offer',
  sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
}

const ANSWER_SDP: RTCSessionDescriptionInit = {
  type: 'answer',
  sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
}

const ICE_CANDIDATE: RTCIceCandidateInit = {
  candidate: 'candidate:1 1 UDP 2122252543 192.0.2.1 56789 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
}

describe('WebSocketCallSignaling — outbound', () => {
  it('sendInvite emits a call_invite frame with snake_case fields and JSON-stringified sdp', async () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    await channel.sendInvite('conv-1', OFFER_SDP)

    expect(ws.sent).toHaveLength(1)
    const frame = ws.sent[0]
    expect(frame.action).toBe('call_invite')
    expect(frame.conversation_id).toBe('conv-1')
    expect(typeof frame.sdp).toBe('string')
    expect(JSON.parse(frame.sdp as string)).toEqual(OFFER_SDP)
  })

  it('sendAnswer emits a call_answer frame', async () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    await channel.sendAnswer('conv-2', ANSWER_SDP)
    expect(ws.sent[0].action).toBe('call_answer')
    expect(ws.sent[0].conversation_id).toBe('conv-2')
    expect(JSON.parse(ws.sent[0].sdp as string)).toEqual(ANSWER_SDP)
  })

  it('sendDecline includes reason when provided and omits it otherwise', async () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    await channel.sendDecline('conv-3', 'busy')
    await channel.sendDecline('conv-3')
    expect(ws.sent[0]).toMatchObject({
      action: 'call_decline',
      conversation_id: 'conv-3',
      reason: 'busy',
    })
    expect(ws.sent[1]).toEqual({
      action: 'call_decline',
      conversation_id: 'conv-3',
    })
    expect('reason' in ws.sent[1]).toBe(false)
  })

  it('sendEnd emits a call_end frame', async () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    await channel.sendEnd('conv-4')
    expect(ws.sent[0]).toEqual({ action: 'call_end', conversation_id: 'conv-4' })
  })

  it('sendIceCandidate emits an ice_candidate frame with JSON-stringified candidate', async () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    await channel.sendIceCandidate('conv-5', ICE_CANDIDATE)
    expect(ws.sent[0].action).toBe('ice_candidate')
    expect(ws.sent[0].conversation_id).toBe('conv-5')
    expect(JSON.parse(ws.sent[0].candidate as string)).toEqual(ICE_CANDIDATE)
  })
})

describe('WebSocketCallSignaling — inbound', () => {
  it('inbound call_invite dispatches onInvite with parsed sdp', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: InvitePayload[] = []
    channel.onInvite((p) => received.push(p))

    ws.pushInbound({
      action: 'call_invite',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
      sdp: JSON.stringify(OFFER_SDP),
    })

    expect(received).toHaveLength(1)
    expect(received[0].conversationId).toBe('conv-1')
    expect(received[0].fromUserId).toBe('peer-1')
    expect(received[0].fromDeviceId).toBe('dev-1')
    expect(received[0].sdp).toEqual(OFFER_SDP)
  })

  it('inbound call_answer dispatches onAnswer', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: AnswerPayload[] = []
    channel.onAnswer((p) => received.push(p))

    ws.pushInbound({
      action: 'call_answer',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
      sdp: JSON.stringify(ANSWER_SDP),
    })

    expect(received[0].sdp).toEqual(ANSWER_SDP)
  })

  it('inbound call_decline dispatches onDecline with optional reason', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: DeclinePayload[] = []
    channel.onDecline((p) => received.push(p))

    ws.pushInbound({
      action: 'call_decline',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
      reason: 'busy',
    })
    ws.pushInbound({
      action: 'call_decline',
      conversation_id: 'conv-2',
      from_user_id: 'peer-2',
      from_device_id: 'dev-2',
    })

    expect(received[0].reason).toBe('busy')
    expect(received[1].reason).toBeUndefined()
  })

  it('inbound call_end dispatches onEnd', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: EndPayload[] = []
    channel.onEnd((p) => received.push(p))

    ws.pushInbound({
      action: 'call_end',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
    })

    expect(received[0].conversationId).toBe('conv-1')
  })

  it('inbound ice_candidate dispatches onIceCandidate with parsed candidate', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: IcePayload[] = []
    channel.onIceCandidate((p) => received.push(p))

    ws.pushInbound({
      action: 'ice_candidate',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
      candidate: JSON.stringify(ICE_CANDIDATE),
    })

    expect(received[0].candidate).toEqual(ICE_CANDIDATE)
  })

  it('inbound call_accepted_elsewhere dispatches onCallAcceptedElsewhere', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: CallAcceptedElsewherePayload[] = []
    channel.onCallAcceptedElsewhere((p) => received.push(p))

    ws.pushInbound({ action: 'call_accepted_elsewhere', conversation_id: 'conv-1' })

    expect(received[0].conversationId).toBe('conv-1')
  })

  it('coerces null from_device_id to empty string without dropping the frame', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    const received: InvitePayload[] = []
    channel.onInvite((p) => received.push(p))

    ws.pushInbound({
      action: 'call_invite',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: null,
      sdp: JSON.stringify(OFFER_SDP),
    })

    expect(received).toHaveLength(1)
    expect(received[0].fromDeviceId).toBe('')
  })
})

describe('WebSocketCallSignaling — malformed inbound', () => {
  it('drops frame missing conversation_id', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let count = 0
    channel.onInvite(() => count++)

    expect(() => {
      ws.pushInbound({
        action: 'call_invite',
        from_user_id: 'peer-1',
        sdp: JSON.stringify(OFFER_SDP),
      })
    }).not.toThrow()
    expect(count).toBe(0)
  })

  it('drops frame with wrong type for sdp (number)', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let count = 0
    channel.onInvite(() => count++)

    expect(() => {
      ws.pushInbound({
        action: 'call_invite',
        conversation_id: 'conv-1',
        from_user_id: 'peer-1',
        sdp: 42,
      })
    }).not.toThrow()
    expect(count).toBe(0)
  })

  it('drops frame with sdp string that is not valid JSON', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let count = 0
    channel.onInvite(() => count++)

    expect(() => {
      ws.pushInbound({
        action: 'call_invite',
        conversation_id: 'conv-1',
        from_user_id: 'peer-1',
        sdp: 'not json {{',
      })
    }).not.toThrow()
    expect(count).toBe(0)
  })

  it('drops frame with wrong type for candidate', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let count = 0
    channel.onIceCandidate(() => count++)

    ws.pushInbound({
      action: 'ice_candidate',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      candidate: { not: 'a string' },
    })
    expect(count).toBe(0)
  })

  it('drops frame with unknown action', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let invites = 0
    let ends = 0
    channel.onInvite(() => invites++)
    channel.onEnd(() => ends++)

    ws.pushInbound({ action: 'something_else', conversation_id: 'conv-1' })

    expect(invites).toBe(0)
    expect(ends).toBe(0)
  })

  it('drops frame whose action is not a string', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let count = 0
    channel.onInvite(() => count++)

    ws.pushInbound({ action: 123 as unknown as string, conversation_id: 'conv-1' })
    expect(count).toBe(0)
  })
})

describe('WebSocketCallSignaling — dispose', () => {
  it('dispose unsubscribes from the underlying ws host', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    expect(ws.subscriberCount()).toBe(1)
    channel.dispose()
    expect(ws.subscriberCount()).toBe(0)
  })

  it('handlers do not fire after dispose, even when inbound frames arrive', () => {
    const ws = new FakeWsHost()
    const channel = new WebSocketCallSignaling(ws)
    let invites = 0
    let ends = 0
    channel.onInvite(() => invites++)
    channel.onEnd(() => ends++)

    channel.dispose()

    ws.pushInbound({
      action: 'call_invite',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
      sdp: JSON.stringify(OFFER_SDP),
    })
    ws.pushInbound({
      action: 'call_end',
      conversation_id: 'conv-1',
      from_user_id: 'peer-1',
      from_device_id: 'dev-1',
    })

    expect(invites).toBe(0)
    expect(ends).toBe(0)
  })
})
