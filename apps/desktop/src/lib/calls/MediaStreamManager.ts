import { loadMediaPreferences } from './mediaPreferences'
import type { CallMode } from './types'

/**
 * Wraps getUserMedia and device enumeration for calls. Applies saved device /
 * audio-processing preferences, tracks every acquired stream so they can all be
 * stopped on dispose (no leaked camera/mic), and offers `acquireGraceful` which
 * returns whatever audio/video is actually present instead of throwing on a
 * device-less or partially-equipped machine.
 */
export class MediaStreamManager {
  #activeStreams: Set<MediaStream> = new Set()

  getPreferredConstraints(mode: CallMode): MediaStreamConstraints {
    const prefs = loadMediaPreferences()
    const audio: MediaTrackConstraints = {
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
    }
    if (prefs.micDeviceId) audio.deviceId = { exact: prefs.micDeviceId }

    if (mode === 'audio') return { audio, video: false }

    const video: MediaTrackConstraints = {}
    if (prefs.cameraDeviceId) video.deviceId = { exact: prefs.cameraDeviceId }
    return { audio, video }
  }

  async acquireLocalStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.#activeStreams.add(stream)
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        this.#activeStreams.delete(stream)
      })
    }
    return stream
  }

  /** enumerateDevices, swallowing failures so "can't tell" degrades to "no
   *  devices" (a receive-only join) rather than throwing. */
  async #safeEnumerate(): Promise<MediaDeviceInfo[]> {
    try {
      return await navigator.mediaDevices.enumerateDevices()
    } catch {
      return []
    }
  }

  /** getUserMedia that resolves to null instead of rejecting. */
  async #tryGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream | null> {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      return null
    }
  }

  /**
   * Acquire whatever of audio/video is actually available. Each kind is only
   * attempted when a device of that kind exists, so a device-less machine (a
   * headless VM, say) never trips NotFoundError/OverconstrainedError. The saved
   * preferred device is tried first, falling back to the default device — a
   * preference pointing at an absent device otherwise overconstrains and throws
   * "Invalid constraint". Returns a stream with zero, one, or both track kinds;
   * the caller adds recvonly transceivers for whatever's missing so the peer's
   * media still flows.
   */
  async acquireGraceful(want: { audio: boolean; video: boolean }): Promise<MediaStream> {
    const preferred = this.getPreferredConstraints('video')
    const devices = await this.#safeEnumerate()
    const hasMic = devices.some((d) => d.kind === 'audioinput')
    const hasCam = devices.some((d) => d.kind === 'videoinput')
    const stream = new MediaStream()

    if (want.audio && hasMic) {
      const audio =
        (await this.#tryGetUserMedia({ audio: preferred.audio, video: false })) ??
        (await this.#tryGetUserMedia({ audio: true, video: false }))
      if (audio) for (const t of audio.getAudioTracks()) stream.addTrack(t)
    }
    if (want.video && hasCam) {
      const video =
        (await this.#tryGetUserMedia({ audio: false, video: preferred.video })) ??
        (await this.#tryGetUserMedia({ audio: false, video: true }))
      if (video) for (const t of video.getVideoTracks()) stream.addTrack(t)
    }

    this.#activeStreams.add(stream)
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        this.#activeStreams.delete(stream)
      })
    }
    return stream
  }

  stop(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      track.stop()
    }
    this.#activeStreams.delete(stream)
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices()
  }

  dispose(): void {
    for (const stream of this.#activeStreams) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    this.#activeStreams.clear()
  }
}
