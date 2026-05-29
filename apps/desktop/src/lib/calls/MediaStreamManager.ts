export class MediaStreamManager {
  #activeStreams: Set<MediaStream> = new Set()

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
