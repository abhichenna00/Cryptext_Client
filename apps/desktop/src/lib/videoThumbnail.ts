/**
 * Extract the first frame of a video file as JPEG bytes, to be used as a
 * thumbnail for the message preview (and as the source for the blurhash
 * the recipient renders while the thumbnail is in-flight).
 *
 * If the WebView can't decode the codec, or the file is corrupt, this
 * resolves to null rather than throwing — send_media on the Rust side
 * treats a null thumbnail as "no preview, render black placeholder."
 */
export async function extractVideoFirstFrame(file: File): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.src = url

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }

    const fail = () => {
      cleanup()
      resolve(null)
    }

    // Guard against videos that never fire loadedmetadata/seeked.
    const timeout = window.setTimeout(fail, 10_000)

    video.onerror = fail

    video.onloadedmetadata = () => {
      // Seek a hair past 0 — some codecs serve a blank first frame at exactly 0.
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2)
    }

    video.onseeked = () => {
      window.clearTimeout(timeout)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx || !canvas.width || !canvas.height) {
          fail()
          return
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              fail()
              return
            }
            const buf = await blob.arrayBuffer()
            cleanup()
            resolve(new Uint8Array(buf))
          },
          'image/jpeg',
          0.85,
        )
      } catch {
        fail()
      }
    }
  })
}
