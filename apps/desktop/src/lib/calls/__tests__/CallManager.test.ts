import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CallManager } from '../CallManager'
import { MediaStreamManager } from '../MediaStreamManager'
import type {
  CallSignalingChannel,
  Unsubscribe,
  InvitePayload,
  AnswerPayload,
  DeclinePayload,
  EndPayload,
  IcePayload,
  CallAcceptedElsewherePayload,
} from '../CallSignalingChannel'

type SentMessage =
  | { kind: 'invite'; conversationId: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; conversationId: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'decline'; conversationId: string; reason?: string }
  | { kind: 'end'; conversationId: string }
  | { kind: 'ice'; conversationId: string; candidate: RTCIceCandidateInit }

class FakeCallSignaling implements CallSignalingChannel {
  sent: SentMessage[] = []
  #inviteHandlers: Set<(p: InvitePayload) => void> = new Set()
  #answerHandlers: Set<(p: AnswerPayload) => void> = new Set()
  #declineHandlers: Set<(p: DeclinePayload) => void> = new Set()
  #endHandlers: Set<(p: EndPayload) => void> = new Set()
  #iceHandlers: Set<(p: IcePayload) => void> = new Set()
  #acceptedElsewhereHandlers: Set<(p: CallAcceptedElsewherePayload) => void> = new Set()

  async sendInvite(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.sent.push({ kind: 'invite', conversationId, sdp })
  }
  async sendAnswer(conversationId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.sent.push({ kind: 'answer', conversationId, sdp })
  }
  async sendDecline(conversationId: string, reason?: string): Promise<void> {
    this.sent.push({ kind: 'decline', conversationId, reason })
  }
  async sendEnd(conversationId: string): Promise<void> {
    this.sent.push({ kind: 'end', conversationId })
  }
  async sendIceCandidate(conversationId: string, candidate: RTCIceCandidateInit): Promise<void> {
    this.sent.push({ kind: 'ice', conversationId, candidate })
  }

  onInvite(h: (p: InvitePayload) => void): Unsubscribe {
    this.#inviteHandlers.add(h)
    return () => this.#inviteHandlers.delete(h)
  }
  onAnswer(h: (p: AnswerPayload) => void): Unsubscribe {
    this.#answerHandlers.add(h)
    return () => this.#answerHandlers.delete(h)
  }
  onDecline(h: (p: DeclinePayload) => void): Unsubscribe {
    this.#declineHandlers.add(h)
    return () => this.#declineHandlers.delete(h)
  }
  onEnd(h: (p: EndPayload) => void): Unsubscribe {
    this.#endHandlers.add(h)
    return () => this.#endHandlers.delete(h)
  }
  onIceCandidate(h: (p: IcePayload) => void): Unsubscribe {
    this.#iceHandlers.add(h)
    return () => this.#iceHandlers.delete(h)
  }
  onCallAcceptedElsewhere(h: (p: CallAcceptedElsewherePayload) => void): Unsubscribe {
    this.#acceptedElsewhereHandlers.add(h)
    return () => this.#acceptedElsewhereHandlers.delete(h)
  }

  triggerInvite(p: InvitePayload): void {
    for (const h of this.#inviteHandlers) h(p)
  }
  triggerAnswer(p: AnswerPayload): void {
    for (const h of this.#answerHandlers) h(p)
  }
  triggerDecline(p: DeclinePayload): void {
    for (const h of this.#declineHandlers) h(p)
  }
  triggerEnd(p: EndPayload): void {
    for (const h of this.#endHandlers) h(p)
  }
  triggerIce(p: IcePayload): void {
    for (const h of this.#iceHandlers) h(p)
  }
  triggerAcceptedElsewhere(p: CallAcceptedElsewherePayload): void {
    for (const h of this.#acceptedElsewhereHandlers) h(p)
  }
}

class FakeTrack {
  kind: string
  enabled = true
  stopped = false
  #listeners: Record<string, Set<() => void>> = {}
  constructor(kind: string) {
    this.kind = kind
  }
  stop() {
    this.stopped = true
  }
  addEventListener(name: string, fn: () => void) {
    ;(this.#listeners[name] ??= new Set()).add(fn)
  }
  removeEventListener(name: string, fn: () => void) {
    this.#listeners[name]?.delete(fn)
  }
}

class FakeStream {
  #tracks: FakeTrack[]
  constructor(tracks: FakeTrack[]) {
    this.#tracks = tracks
  }
  getTracks() {
    return this.#tracks
  }
  getAudioTracks() {
    return this.#tracks.filter((t) => t.kind === 'audio')
  }
  getVideoTracks() {
    return this.#tracks.filter((t) => t.kind === 'video')
  }
  addTrack(t: FakeTrack) {
    this.#tracks.push(t)
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  closed = false
  iceCandidatesAdded: RTCIceCandidateInit[] = []
  addedTracks: FakeTrack[] = []
  transceivers: Array<{ kind: string; direction: string }> = []
  connectionState: RTCPeerConnectionState = 'new'
  #listeners: Record<string, Set<(ev: unknown) => void>> = {}

  constructor(_cfg: RTCConfiguration) {
    FakePeerConnection.instances.push(this)
  }

  addTrack(track: FakeTrack, _stream: FakeStream) {
    this.addedTracks.push(track)
  }

  addTransceiver(kind: string, init?: { direction?: string }) {
    const direction = init?.direction ?? 'sendrecv'
    this.transceivers.push({ kind, direction })
    return { direction }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }
  }

  async setLocalDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = d
  }

  async setRemoteDescription(d: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = d
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.iceCandidatesAdded.push(c)
  }

  close() {
    this.closed = true
  }

  addEventListener(name: string, fn: (ev: unknown) => void) {
    ;(this.#listeners[name] ??= new Set()).add(fn)
  }
  removeEventListener(name: string, fn: (ev: unknown) => void) {
    this.#listeners[name]?.delete(fn)
  }
  dispatch(name: string, ev?: unknown) {
    for (const fn of this.#listeners[name] ?? []) fn(ev)
  }
  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state
    this.dispatch('connectionstatechange')
  }
}

class FakeMediaStreamGlobal {
  static lastStream: FakeStream | null = null
}

beforeEach(() => {
  FakePeerConnection.instances = []
  FakeMediaStreamGlobal.lastStream = null

  // Install stubs onto globals used by CallManager / MediaStreamManager.
  ;(globalThis as unknown as { RTCPeerConnection: typeof FakePeerConnection }).RTCPeerConnection =
    FakePeerConnection
  ;(globalThis as unknown as { MediaStream: new () => FakeStream }).MediaStream = function () {
    return new FakeStream([])
  } as unknown as new () => FakeStream

  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    const tracks: FakeTrack[] = []
    if (constraints.audio) tracks.push(new FakeTrack('audio'))
    if (constraints.video) tracks.push(new FakeTrack('video'))
    const stream = new FakeStream(tracks)
    FakeMediaStreamGlobal.lastStream = stream
    return stream as unknown as MediaStream
  })

  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia,
        // Default to both input kinds present so acquisition is attempted;
        // individual tests override to model a device-less machine.
        enumerateDevices: vi.fn(
          async () => [{ kind: 'audioinput' }, { kind: 'videoinput' }] as unknown as MediaDeviceInfo[],
        ),
      },
      // Default to a granted mic permission so the "join with mic if already
      // granted" rule acquires audio; individual tests override as needed.
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
    },
    configurable: true,
  })
})

// Narrow handle for tests that need to override the stubbed navigator surface
// without reaching for `any`.
type NavOverride = {
  permissions: { query: (descriptor: unknown) => Promise<{ state: string }> }
  mediaDevices: {
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<unknown>
    enumerateDevices: () => Promise<unknown[]>
  }
}
function navOverride(): NavOverride {
  return navigator as unknown as NavOverride
}

function build() {
  const signaling = new FakeCallSignaling()
  const media = new MediaStreamManager()
  const manager = new CallManager(signaling, media, {
    iceServers: [{ urls: 'stun:stun.example:19302' }],
    ringTimeoutMs: 30_000,
  })
  return { signaling, media, manager }
}

describe('CallManager state machine', () => {
  it('startCall transitions idle -> outgoing-ringing and emits an invite', async () => {
    const { signaling, manager } = build()
    expect(manager.state.status).toBe('idle')
    await manager.startCall('conv-1', 'peer-1', 'audio')
    expect(manager.state.status).toBe('outgoing-ringing')
    expect(manager.state.conversationId).toBe('conv-1')
    expect(signaling.sent.some((m) => m.kind === 'invite')).toBe(true)
  })

  it('startCall fails cleanly with no RTCPeerConnection (WebRTC-less webview)', async () => {
    delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection
    const { signaling, manager } = build()
    await expect(manager.startCall('conv-1', 'peer-1', 'audio')).rejects.toThrow(/not supported/i)
    // Never left idle, and nothing went out over the wire.
    expect(manager.state.status).toBe('idle')
    expect(signaling.sent).toHaveLength(0)
  })

  it('illegal acceptCall from idle throws', async () => {
    const { manager } = build()
    await expect(manager.acceptCall()).rejects.toThrow()
  })

  it('inbound invite -> acceptCall flow drives idle -> incoming-ringing -> connecting and sends answer', async () => {
    const { signaling, manager } = build()
    signaling.triggerInvite({
      conversationId: 'conv-1',
      fromUserId: 'peer-1',
      fromDeviceId: 'dev-1',
      sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
    })
    expect(manager.state.status).toBe('incoming-ringing')
    await manager.acceptCall()
    expect(manager.state.status).toBe('connecting')
    expect(signaling.sent.some((m) => m.kind === 'answer')).toBe(true)
  })

  it('endCall from in-call stops local tracks and closes the peer connection', async () => {
    const { signaling, manager } = build()
    signaling.triggerInvite({
      conversationId: 'conv-1',
      fromUserId: 'peer-1',
      fromDeviceId: 'dev-1',
      sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
    })
    await manager.acceptCall()
    const pc = FakePeerConnection.instances[0]
    pc.setConnectionState('connected')
    expect(manager.state.status).toBe('in-call')

    const stream = FakeMediaStreamGlobal.lastStream!
    await manager.endCall()
    expect(stream.getTracks().every((t) => t.stopped)).toBe(true)
    expect(pc.closed).toBe(true)
    expect(manager.state.status).toBe('idle')
  })

  it('toggleMic flips audio track enabled', async () => {
    const { signaling, manager } = build()
    signaling.triggerInvite({
      conversationId: 'conv-1',
      fromUserId: 'peer-1',
      fromDeviceId: 'dev-1',
      sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
    })
    await manager.acceptCall()
    const stream = FakeMediaStreamGlobal.lastStream!
    const audio = stream.getAudioTracks()[0]
    expect(audio.enabled).toBe(true)
    manager.toggleMic()
    expect(audio.enabled).toBe(false)
    expect(manager.state.participants.find((p) => p.isSelf)?.micEnabled).toBe(false)
  })

  it('video call starts camera-off and toggleCamera enables it', async () => {
    const { manager } = build()
    await manager.startCall('conv-1', 'peer-1', 'video')
    const stream = FakeMediaStreamGlobal.lastStream!
    const video = stream.getVideoTracks()[0]
    // Camera off by default: the track is acquired but starts disabled.
    expect(video.enabled).toBe(false)
    expect(manager.state.participants.find((p) => p.isSelf)?.cameraEnabled).toBe(false)
    manager.toggleCamera()
    expect(video.enabled).toBe(true)
    expect(manager.state.participants.find((p) => p.isSelf)?.cameraEnabled).toBe(true)
  })

  it('joins receive-only with recvonly transceivers when no mic or camera exists', async () => {
    // No input devices on this machine — capture should not even be attempted.
    navOverride().mediaDevices.enumerateDevices = vi.fn(async () => [])
    navOverride().mediaDevices.getUserMedia = vi.fn(async () => {
      throw new Error('getUserMedia should not be called when no devices exist')
    })
    const { signaling, manager } = build()
    await manager.startCall('conv-1', 'peer-1', 'video')

    expect(manager.state.status).toBe('outgoing-ringing')
    expect(manager.state.localAudioAvailable).toBe(false)
    expect(manager.state.localVideoAvailable).toBe(false)
    expect(signaling.sent.some((m) => m.kind === 'invite')).toBe(true)

    const pc = FakePeerConnection.instances[0]
    expect(pc.addedTracks).toHaveLength(0)
    expect(pc.transceivers.map((t) => t.kind).sort()).toEqual(['audio', 'video'])
    expect(pc.transceivers.every((t) => t.direction === 'recvonly')).toBe(true)

    // Toggles are no-ops without any local track.
    manager.toggleMic()
    manager.toggleCamera()
    expect(manager.state.participants.find((p) => p.isSelf)?.micEnabled).toBe(false)
    expect(manager.state.participants.find((p) => p.isSelf)?.cameraEnabled).toBe(false)
  })

  it('joins muted when mic permission is not already granted', async () => {
    navOverride().permissions.query = vi.fn(async () => ({ state: 'prompt' }))
    const { manager } = build()
    await manager.startCall('conv-1', 'peer-1', 'audio')

    expect(manager.state.localAudioAvailable).toBe(false)
    expect(manager.state.participants.find((p) => p.isSelf)?.micEnabled).toBe(false)
    const pc = FakePeerConnection.instances[0]
    expect(pc.transceivers).toEqual([{ kind: 'audio', direction: 'recvonly' }])
  })

  it('endCall from error state resets to idle without throwing or sending an End', async () => {
    const { signaling, manager } = build()
    signaling.triggerInvite({
      conversationId: 'conv-1',
      fromUserId: 'peer-1',
      fromDeviceId: 'dev-1',
      sdp: { type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' },
    })
    await manager.acceptCall()
    expect(manager.state.status).toBe('connecting')
    const pc = FakePeerConnection.instances[0]
    pc.setConnectionState('failed')
    expect(manager.state.status).toBe('error')
    await expect(manager.endCall()).resolves.toBeUndefined()
    expect(manager.state.status).toBe('idle')
    expect(signaling.sent.some((m) => m.kind === 'end')).toBe(false)
  })

  it('onCallAcceptedElsewhere while outgoing-ringing transitions to idle and stops local tracks', async () => {
    const { signaling, manager } = build()
    await manager.startCall('conv-1', 'peer-1', 'audio')
    const stream = FakeMediaStreamGlobal.lastStream!
    expect(manager.state.status).toBe('outgoing-ringing')
    signaling.triggerAcceptedElsewhere({ conversationId: 'conv-1' })
    expect(manager.state.status).toBe('idle')
    expect(stream.getTracks().every((t) => t.stopped)).toBe(true)
  })
})
