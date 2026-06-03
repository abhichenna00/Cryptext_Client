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
  // Remote ICE candidates can arrive before the remote description is set (a
  // burst lands during the async setRemoteDescription, or while an incoming
  // call is still ringing). Adding them then fails with OperationError and the
  // candidate is lost, starving ICE. Buffer until the remote description is in
  // place, then flush.
  #remoteDescriptionSet = false
  #pendingIceCandidates: RTCIceCandidateInit[] = []

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
    this.#resetIceBuffer()
    this.#mode = mode
    this.#conversationId = conversationId
    this.#conversationType = conversationType
    this.#participants = [
      this.#makeSelfParticipant(),
      this.#makePeerParticipant(peerUserId),
    ]
    this.#emit()

    try {
      const wantAudio = await this.#micPermissionGranted()
      this.#localStream = await this.#media.acquireGraceful({ audio: wantAudio, video: mode === 'video' })
      // Camera off by default: keep any acquired video track but disabled, so
      // enabling it in-call is a track flip rather than a renegotiation (which
      // the signaling channel doesn't support).
      for (const track of this.#localStream.getVideoTracks()) track.enabled = false
      this.#applyLocalTrackStateToSelf()
      const pc = this.#createPeerConnection()
      this.#addLocalMedia(pc, mode)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await this.#signaling.sendInvite(conversationId, offer)
      this.#emit()
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
    // Capture before the awaits below — `this.#` field narrowing doesn't survive
    // an await, and these are cleared/used asynchronously.
    const pendingOffer = this.#pendingRemoteOffer
    const convId = this.#conversationId

    this.#transitionTo('connecting')
    this.#emit()

    try {
      const wantAudio = await this.#micPermissionGranted()
      this.#localStream = await this.#media.acquireGraceful({ audio: wantAudio, video: this.#mode === 'video' })
      for (const track of this.#localStream.getVideoTracks()) track.enabled = false
      this.#applyLocalTrackStateToSelf()
      const pc = this.#createPeerConnection()
      await pc.setRemoteDescription(pendingOffer)
      this.#pendingRemoteOffer = null
      await this.#markRemoteDescriptionSet()
      // Attach whatever we have. Kinds the offer included but we can't send stay
      // recvonly in our answer, so we still receive the caller's media.
      for (const track of this.#localStream.getTracks()) {
        pc.addTrack(track, this.#localStream)
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await this.#signaling.sendAnswer(convId, answer)
      this.#emit()
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
    const audioTracks = this.#localStream?.getAudioTracks() ?? []
    if (audioTracks.length === 0) return // joined without a mic — nothing to toggle
    const self = this.#participants.find((p) => p.isSelf)
    if (!self) return
    self.micEnabled = !self.micEnabled
    for (const track of audioTracks) {
      track.enabled = self.micEnabled
    }
    this.#emit()
  }

  toggleCamera(): void {
    const videoTracks = this.#localStream?.getVideoTracks() ?? []
    if (videoTracks.length === 0) return // joined without a camera — nothing to toggle
    const self = this.#participants.find((p) => p.isSelf)
    if (!self) return
    self.cameraEnabled = !self.cameraEnabled
    for (const track of videoTracks) {
      track.enabled = self.cameraEnabled
    }
    this.#emit()
  }

  /**
   * Honour the "join with mic live only if permission is already granted" rule:
   * query — without prompting — whether mic permission is held. If the
   * Permissions API can't answer (older WebKit, unsupported descriptor), default
   * to not requesting audio, i.e. join muted rather than firing a prompt.
   */
  async #micPermissionGranted(): Promise<boolean> {
    try {
      const permissions = navigator.permissions
      if (!permissions?.query) return false
      const status = await permissions.query({
        name: 'microphone',
      } as unknown as PermissionDescriptor)
      return status.state === 'granted'
    } catch {
      return false
    }
  }

  /**
   * Attach available local tracks to the peer connection; for any kind we lack a
   * track for, add a recvonly transceiver so the remote's media still reaches
   * us. Audio is always negotiated; video only on a video call. Without this,
   * a caller with no devices would send an offer carrying no media lines and
   * nothing would flow in either direction.
   */
  #addLocalMedia(pc: RTCPeerConnection, mode: CallMode): void {
    const stream = this.#localStream
    const audioTracks = stream?.getAudioTracks() ?? []
    const videoTracks = stream?.getVideoTracks() ?? []

    if (stream && audioTracks.length > 0) {
      for (const t of audioTracks) pc.addTrack(t, stream)
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' })
    }

    if (mode === 'video') {
      if (stream && videoTracks.length > 0) {
        for (const t of videoTracks) pc.addTrack(t, stream)
      } else {
        pc.addTransceiver('video', { direction: 'recvonly' })
      }
    }
  }

  /** Reflect the actually-acquired tracks onto the self participant: mic on iff
   *  an audio track was acquired; camera always starts off (camera-off default). */
  #applyLocalTrackStateToSelf(): void {
    const self = this.#participants.find((p) => p.isSelf)
    if (!self) return
    self.micEnabled = (this.#localStream?.getAudioTracks().length ?? 0) > 0
    self.cameraEnabled = false
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
    this.#resetIceBuffer()
    this.#mode = this.#inferModeFromSdp(payload.sdp)
    this.#conversationId = payload.conversationId
    this.#conversationType = 'dm'
    this.#pendingRemoteOffer = payload.sdp
    this.#participants = [
      this.#makeSelfParticipant(),
      this.#makePeerParticipant(payload.fromUserId),
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
      await this.#markRemoteDescriptionSet()
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
    // Already terminal — including after a local failure left us in `error`,
    // which `#failWith` does not clear `#conversationId` on. `error -> ended`
    // is an illegal transition that would throw inside the WS subscriber and
    // wedge the manager, so an inbound end is a no-op here.
    if (this.#status === 'idle' || this.#status === 'ended' || this.#status === 'error') return
    this.#transitionTo('ended')
    this.#cleanup()
    this.#emit()
    this.#resetToIdle()
  }

  async #handleRemoteIce(payload: IcePayload): Promise<void> {
    if (payload.conversationId !== this.#conversationId) return
    // Hold candidates until the peer connection exists and its remote
    // description is set; otherwise addIceCandidate throws OperationError and the
    // candidate is lost. They're flushed in order by #markRemoteDescriptionSet.
    if (!this.#peerConnection || !this.#remoteDescriptionSet) {
      this.#pendingIceCandidates.push(payload.candidate)
      return
    }
    try {
      await this.#peerConnection.addIceCandidate(payload.candidate)
    } catch (err) {
      console.warn('[call] addIceCandidate failed:', err instanceof Error ? err.name : 'unknown')
    }
  }

  #resetIceBuffer(): void {
    this.#remoteDescriptionSet = false
    this.#pendingIceCandidates = []
  }

  /// Called once the remote description is in place. Flips the gate and drains
  /// any candidates buffered while it was being set, in arrival order.
  async #markRemoteDescriptionSet(): Promise<void> {
    this.#remoteDescriptionSet = true
    const pc = this.#peerConnection
    if (!pc) return
    const buffered = this.#pendingIceCandidates
    this.#pendingIceCandidates = []
    for (const candidate of buffered) {
      try {
        await pc.addIceCandidate(candidate)
      } catch (err) {
        console.warn('[call] addIceCandidate (flush) failed:', err instanceof Error ? err.name : 'unknown')
      }
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
    this.#resetIceBuffer()
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

  #makeSelfParticipant(): MutableParticipant {
    return {
      userId: SELF_ID,
      isSelf: true,
      micEnabled: true,
      cameraEnabled: false,
      joinedAt: null,
    }
  }

  #makePeerParticipant(userId: string): MutableParticipant {
    return {
      userId,
      isSelf: false,
      micEnabled: true,
      cameraEnabled: false,
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
      localAudioAvailable: (this.#localStream?.getAudioTracks().length ?? 0) > 0,
      localVideoAvailable: (this.#localStream?.getVideoTracks().length ?? 0) > 0,
    })
  }

  #emit(): void {
    const snap = this.#snapshot()
    for (const handler of this.#subscribers) {
      handler(snap)
    }
  }
}
