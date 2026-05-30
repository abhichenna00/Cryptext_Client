import { loadMediaPreferences } from './mediaPreferences'
import type { CallMode } from './types'

export class MediaStreamManager {
  #activeStreams: Set<MediaStream> = new Set()

  /** Build a getUserMedia constraint set from the user's stored A/V preferences.
   *  CallManager (PR 3) calls this when starting a call so the right hardware
   *  is selected without the UI having to thread prefs through. */
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
