import type {
  CallSignalingChannel,
  Unsubscribe,
  InvitePayload,
  AnswerPayload,
  DeclinePayload,
  EndPayload,
  IcePayload,
  CallAcceptedElsewherePayload,
} from './CallSignalingChannel'
import type {
  CallConfig,
  CallMode,
  CallParticipantState,
  CallSnapshot,
  CallStatus,
} from './types'
import { CALL_TRANSITIONS } from './types'
import type { MediaStreamManager } from './MediaStreamManager'

type SnapshotHandler = (snapshot: CallSnapshot) => void

const SELF_ID = 'self'

type MutableParticipant = {
  userId: string
  isSelf: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  joinedAt: number | null
}

export class CallManager {
  #signaling: CallSignalingChannel
  #media: MediaStreamManager
  #config: CallConfig

  #status: CallStatus = 'idle'
  #mode: CallMode = 'audio'
  #conversationId: string | null = null
  #conversationType: 'dm' | 'group' = 'dm'
  #errorMessage: string | null = null
  #participants: MutableParticipant[] = []
  #callStartedAt: number | null = null

  #peerConnection: RTCPeerConnection | null = null
  #localStream: MediaStream | null = null
  #remoteStream: MediaStream | null = null
  #pendingRemoteOffer: RTCSessionDescriptionInit | null = null

  #subscribers: Set<SnapshotHandler> = new Set()
  #signalingUnsubscribers: Unsubscribe[] = []

  constructor(signaling: CallSignalingChannel, media: MediaStreamManager, config: CallConfig) {
    this.#signaling = signaling
    this.#media = media
    this.#config = config

    this.#signalingUnsubscribers.push(
      this.#signaling.onInvite((payload) => this.#handleRemoteInvite(payload)),
      this.#signaling.onAnswer((payload) => this.#handleRemoteAnswer(payload)),
      this.#signaling.onDecline((payload) => this.#handleRemoteDecline(payload)),
      this.#signaling.onEnd((payload) => this.#handleRemoteEnd(payload)),
      this.#signaling.onIceCandidate((payload) => this.#handleRemoteIce(payload)),
      this.#signaling.onCallAcceptedElsewhere((payload) => this.#handleAcceptedElsewhere(payload)),
    )
  }

  get state(): Readonly<CallSnapshot> {
    return this.#snapshot()
  }

  subscribe(handler: SnapshotHandler): Unsubscribe {
    this.#subscribers.add(handler)
    return () => {
      this.#subscribers.delete(handler)
    }
  }

  getLocalStream(): MediaStream | null {
    return this.#localStream
  }

  getRemoteStream(): MediaStream | null {
    return this.#remoteStream
  }

  async startCall(
    conversationId: string,
    peerUserId: string,
    mode: CallMode,
    conversationType: 'dm' | 'group' = 'dm',
  ): Promise<void> {
    this.#transitionTo('outgoing-ringing')
    this.#mode = mode
    this.#conversationId = conversationId
    this.#conversationType = conversationType
    this.#participants = [
      this.#makeSelfParticipant(mode),
      this.#makePeerParticipant(peerUserId, mode),
    ]
    this.#emit()

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: mode === 'video',
      }
      this.#localStream = await this.#media.acquireLocalStream(constraints)
      const pc = this.#createPeerConnection()
      for (const track of this.#localStream.getTracks()) {
        pc.addTrack(track, this.#localStream)
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.#signaling.sendInvite(conversationId, offer)
    } catch (err) {
      this.#failWith(err)
      throw err
    }
  }

  async acceptCall(): Promise<void> {
    if (this.#status !== 'incoming-ringing') {
      throw new Error(`acceptCall illegal in status ${this.#status}`)
    }
    if (!this.#pendingRemoteOffer || !this.#conversationId) {
      throw new Error('acceptCall: no pending invite')
    }

    this.#transitionTo('connecting')
    this.#emit()

    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: this.#mode === 'video',
      }
      this.#localStream = await this.#media.acquireLocalStream(constraints)
      const pc = this.#createPeerConnection()
      await pc.setRemoteDescription(this.#pendingRemoteOffer)
      this.#pendingRemoteOffer = null
      for (const track of this.#localStream.getTracks()) {
        pc.addTrack(track, this.#localStream)
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await this.#signaling.sendAnswer(this.#conversationId, answer)
    } catch (err) {
      this.#failWith(err)
      throw err
    }
  }

  async declineCall(): Promise<void> {
    if (this.#status !== 'incoming-ringing' && this.#status !== 'outgoing-ringing') {
      throw new Error(`declineCall illegal in status ${this.#status}`)
    }
    const convId = this.#conversationId
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    if (convId) {
      await this.#signaling.sendDecline(convId)
    }
    this.#resetToIdle()
  }

  async endCall(): Promise<void> {
    if (this.#status === 'idle' || this.#status === 'ended') {
      return
    }
    if (this.#status === 'error') {
      this.#resetToIdle()
      return
    }
    const convId = this.#conversationId
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    if (convId) {
      await this.#signaling.sendEnd(convId)
    }
    this.#resetToIdle()
  }

  toggleMic(): void {
    if (!this.#localStream) return
    const self = this.#participants.find((p) => p.isSelf)
    if (!self) return
    self.micEnabled = !self.micEnabled
    for (const track of this.#localStream.getAudioTracks()) {
      track.enabled = self.micEnabled
    }
    this.#emit()
  }

  toggleCamera(): void {
    if (!this.#localStream) return
    const self = this.#participants.find((p) => p.isSelf)
    if (!self) return
    self.cameraEnabled = !self.cameraEnabled
    for (const track of this.#localStream.getVideoTracks()) {
      track.enabled = self.cameraEnabled
    }
    this.#emit()
  }

  #createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [...this.#config.iceServers] })
    this.#peerConnection = pc
    this.#remoteStream = new MediaStream()

    pc.addEventListener('track', (event) => {
      if (!this.#remoteStream) return
      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        this.#remoteStream.addTrack(track)
      }
      this.#emit()
    })

    pc.addEventListener('icecandidate', (event) => {
      if (!event.candidate || !this.#conversationId) return
      this.#signaling.sendIceCandidate(this.#conversationId, event.candidate.toJSON()).catch((err) => {
        console.warn('[call] ice send failed:', err instanceof Error ? err.name : 'unknown')
      })
    })

    pc.addEventListener('connectionstatechange', () => {
      const cs = pc.connectionState
      console.info('[call] pc connectionState=', cs)
      if (cs === 'connected' && this.#status === 'connecting') {
        this.#transitionTo('in-call')
        const now = Date.now()
        this.#callStartedAt = now
        for (const p of this.#participants) {
          if (p.joinedAt === null) p.joinedAt = now
        }
        this.#emit()
      } else if (cs === 'failed' || cs === 'disconnected' || cs === 'closed') {
        if (this.#status === 'in-call' || this.#status === 'connecting') {
          this.#failWith(new Error(`peer connection ${cs}`))
        }
      }
    })

    return pc
  }

  #handleRemoteInvite(payload: InvitePayload): void {
    if (this.#status !== 'idle') {
      this.#signaling.sendDecline(payload.conversationId, 'busy').catch(() => {})
      return
    }
    this.#transitionTo('incoming-ringing')
    this.#mode = this.#inferModeFromSdp(payload.sdp)
    this.#conversationId = payload.conversationId
    this.#conversationType = 'dm'
    this.#pendingRemoteOffer = payload.sdp
    this.#participants = [
      this.#makeSelfParticipant(this.#mode),
      this.#makePeerParticipant(payload.fromUserId, this.#mode),
    ]
    console.info('[call] inbound invite received')
    this.#emit()
  }

  async #handleRemoteAnswer(payload: AnswerPayload): Promise<void> {
    if (this.#status !== 'outgoing-ringing' || !this.#peerConnection) {
      return
    }
    if (payload.conversationId !== this.#conversationId) return
    try {
      this.#transitionTo('connecting')
      this.#emit()
      await this.#peerConnection.setRemoteDescription(payload.sdp)
    } catch (err) {
      this.#failWith(err)
    }
  }

  #handleRemoteDecline(payload: DeclinePayload): void {
    if (payload.conversationId !== this.#conversationId) return
    if (this.#status !== 'outgoing-ringing') return
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    this.#resetToIdle()
  }

  #handleRemoteEnd(payload: EndPayload): void {
    if (payload.conversationId !== this.#conversationId) return
    if (this.#status === 'idle' || this.#status === 'ended') return
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    this.#resetToIdle()
  }

  async #handleRemoteIce(payload: IcePayload): Promise<void> {
    if (payload.conversationId !== this.#conversationId) return
    if (!this.#peerConnection) return
    try {
      await this.#peerConnection.addIceCandidate(payload.candidate)
    } catch (err) {
      console.warn('[call] addIceCandidate failed:', err instanceof Error ? err.name : 'unknown')
    }
  }

  #handleAcceptedElsewhere(payload: CallAcceptedElsewherePayload): void {
    if (payload.conversationId !== this.#conversationId) return
    if (this.#status !== 'outgoing-ringing' && this.#status !== 'incoming-ringing') return
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    this.#resetToIdle()
  }

  #transitionTo(newStatus: CallStatus): void {
    const allowed = CALL_TRANSITIONS[this.#status]
    if (!allowed.includes(newStatus)) {
      throw new Error(`illegal call transition: ${this.#status} -> ${newStatus}`)
    }
    console.info(`[call] transition ${this.#status} -> ${newStatus}`)
    this.#status = newStatus
  }

  #cleanup(): void {
    if (this.#localStream) {
      this.#media.stop(this.#localStream)
      this.#localStream = null
    }
    if (this.#peerConnection) {
      try {
        this.#peerConnection.close()
      } catch {
        // close() on an already-closed peer connection is a no-op we want to swallow
      }
      this.#peerConnection = null
    }
    this.#remoteStream = null
    this.#pendingRemoteOffer = null
  }

  #failWith(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[call] error:', err instanceof Error ? err.name : 'unknown')
    this.#errorMessage = message
    if (this.#status !== 'error' && CALL_TRANSITIONS[this.#status].includes('error')) {
      this.#transitionTo('error')
    }
    this.#callStartedAt = null
    this.#cleanup()
    this.#emit()
  }

  #resetToIdle(): void {
    this.#transitionTo('idle')
    this.#conversationId = null
    this.#conversationType = 'dm'
    this.#errorMessage = null
    this.#participants = []
    this.#callStartedAt = null
    this.#mode = 'audio'
    this.#emit()
  }

  #makeSelfParticipant(mode: CallMode): MutableParticipant {
    return {
      userId: SELF_ID,
      isSelf: true,
      micEnabled: true,
      cameraEnabled: mode === 'video',
      joinedAt: null,
    }
  }

  #makePeerParticipant(userId: string, mode: CallMode): MutableParticipant {
    return {
      userId,
      isSelf: false,
      micEnabled: true,
      cameraEnabled: mode === 'video',
      joinedAt: null,
    }
  }

  #inferModeFromSdp(sdp: RTCSessionDescriptionInit): CallMode {
    return sdp.sdp && /m=video/.test(sdp.sdp) ? 'video' : 'audio'
  }

  #snapshot(): Readonly<CallSnapshot> {
    const participants: ReadonlyArray<CallParticipantState> = this.#participants.map((p) =>
      Object.freeze({
        userId: p.userId,
        isSelf: p.isSelf,
        micEnabled: p.micEnabled,
        cameraEnabled: p.cameraEnabled,
        joinedAt: p.joinedAt,
      }),
    )
    return Object.freeze({
      status: this.#status,
      mode: this.#mode,
      conversationId: this.#conversationId,
      conversationType: this.#conversationType,
      error: this.#errorMessage,
      participants: Object.freeze(participants),
      callStartedAt: this.#callStartedAt,
    })
  }

  #emit(): void {
    const snap = this.#snapshot()
    for (const handler of this.#subscribers) {
      handler(snap)
    }
  }
}
