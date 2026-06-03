import { loadMediaPreferences } from './mediaPreferences'
import type { CallMode } from './types'

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

  /**
   * Acquire whatever of audio/video is actually available, requesting each
   * kind separately so a missing camera can't sink the mic (a single
   * getUserMedia call rejects wholesale if either device is absent). Returns a
   * stream with zero, one, or both track kinds — the caller adds recvonly
   * transceivers for whatever's missing so the peer's media still flows.
   */
  async acquireGraceful(want: { audio: boolean; video: boolean }): Promise<MediaStream> {
    const preferred = this.getPreferredConstraints('video')
    const stream = new MediaStream()

    if (want.audio) {
      try {
        const a = await navigator.mediaDevices.getUserMedia({ audio: preferred.audio, video: false })
        for (const t of a.getAudioTracks()) stream.addTrack(t)
      } catch {
        // No mic, or permission not granted — join without audio.
      }
    }
    if (want.video) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ audio: false, video: preferred.video })
        for (const t of v.getVideoTracks()) stream.addTrack(t)
      } catch {
        // No camera, or permission not granted — join without video.
      }
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
