import { useState, useEffect, useRef, useMemo } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { decode as decodeBlurhash } from 'blurhash'
import { Loader2, Play } from 'lucide-react'
import { useAutoDownloadMedia } from '@/hooks'

interface MediaMetadata {
  type: string
  media_type: string
  file_name: string
  file_size: number
  media_key: string
  media_nonce: string
  s3_key: string
  thumb_nonce?: string
  thumb_s3_key?: string
  width?: number
  height?: number
  thumb_width?: number
  thumb_height?: number
  blur_hash?: string
}

interface MediaMessageProps {
  messageId: string
  content: string
  conversationId: string
}

const MAX_W = 400
const MAX_H = 300

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Decode a blurhash string into a small data URL the browser can stretch
// across the preview area. The ~64×N render is plenty — the browser's
// built-in upscaling interpolation gives the smooth blurred look for free.
function blurhashToDataUrl(hash: string, aspectW: number, aspectH: number): string | null {
  try {
    const renderW = 64
    const renderH = Math.max(1, Math.round((aspectH / aspectW) * renderW))
    const pixels = decodeBlurhash(hash, renderW, renderH)
    const canvas = document.createElement('canvas')
    canvas.width = renderW
    canvas.height = renderH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const imageData = ctx.createImageData(renderW, renderH)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.6)
  } catch {
    return null
  }
}

function constrainDims(w: number | undefined, h: number | undefined): { width: number; height: number } {
  let width = w || MAX_W
  let height = h || MAX_H
  if (width > MAX_W) {
    height = Math.round(height * (MAX_W / width))
    width = MAX_W
  }
  if (height > MAX_H) {
    width = Math.round(width * (MAX_H / height))
    height = MAX_H
  }
  return { width, height }
}

export default function MediaMessage({ messageId, content, conversationId }: MediaMessageProps) {
  const autoDownload = useAutoDownloadMedia()
  const containerRef = useRef<HTMLDivElement>(null)
  const thumbnailRequestedRef = useRef(false)

  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [inViewport, setInViewport] = useState(false)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const [fullSrc, setFullSrc] = useState<string | null>(null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      setMetadata(JSON.parse(content) as MediaMetadata)
    } catch {
      setError('Invalid media metadata')
    }
  }, [content])

  // Decode the blurhash once — this is the zero-network placeholder the
  // recipient always sees. Baked into the MLS-encrypted message body, so
  // no fetch is needed to render it.
  const blurhashSrc = useMemo(() => {
    if (!metadata?.blur_hash) return null
    const w = metadata.thumb_width ?? metadata.width ?? 32
    const h = metadata.thumb_height ?? metadata.height ?? 24
    return blurhashToDataUrl(metadata.blur_hash, w, h)
  }, [metadata?.blur_hash, metadata?.thumb_width, metadata?.thumb_height, metadata?.width, metadata?.height])

  // Viewport gate — stops the old "mount = fetch all media in chat" storm
  // that was burning through the server rate limit. Fire once, with a
  // 200px pre-roll so we start fetching slightly before the user sees it.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Auto-fetch the sharp thumbnail when visible + setting on. Ref guard
  // prevents StrictMode double-invoke from firing two requests.
  useEffect(() => {
    if (!inViewport || !autoDownload || !metadata) return
    if (thumbnailRequestedRef.current || thumbnailSrc) return
    if (!metadata.thumb_s3_key || !metadata.thumb_nonce) return

    thumbnailRequestedRef.current = true
    ;(async () => {
      try {
        const path = await invoke<string>('download_media', {
          s3Key: metadata.thumb_s3_key,
          mediaKey: metadata.media_key,
          nonce: metadata.thumb_nonce,
          mediaType: metadata.media_type,
          conversationId,
          messageId,
          isThumbnail: true,
        })
        setThumbnailSrc(convertFileSrc(path))
      } catch (err) {
        console.error('Failed to load thumbnail:', err)
        // Non-fatal — blurhash placeholder stays visible.
      }
    })()
  }, [inViewport, autoDownload, metadata, thumbnailSrc, conversationId, messageId])

  const loadFullMedia = async () => {
    if (!metadata || loadingFull) return
    setLoadingFull(true)
    try {
      const path = await invoke<string>('download_media', {
        s3Key: metadata.s3_key,
        mediaKey: metadata.media_key,
        nonce: metadata.media_nonce,
        mediaType: metadata.media_type,
        conversationId,
        messageId,
        isThumbnail: false,
      })
      setFullSrc(convertFileSrc(path))
      setExpanded(true)
    } catch (err) {
      console.error('Failed to load full media:', err)
      setError('Failed to download media')
    } finally {
      setLoadingFull(false)
    }
  }

  // Keep the ref on a stable outer element regardless of inner state —
  // otherwise the IntersectionObserver attaches to a soon-to-unmount node.
  return (
    <div ref={containerRef}>
      {renderBody()}
    </div>
  )

  function renderBody() {
    if (error) return <div className="media-error">{error}</div>
    if (!metadata) return <div className="media-loading"><Loader2 className="h-4 w-4 animate-spin" /></div>

    const isImage = metadata.media_type.startsWith('image/')
    const isVideo = metadata.media_type.startsWith('video/')
    const { width, height } = constrainDims(metadata.width, metadata.height)

    if (isVideo) {
      if (fullSrc) {
        return (
          <div className="media-video-card">
            <video
              src={fullSrc}
              controls
              className="media-video-player"
              style={{ maxWidth: `${MAX_W}px`, maxHeight: `${MAX_H}px` }}
            />
          </div>
        )
      }
      const previewSrc = thumbnailSrc ?? blurhashSrc
      return (
        <div
          className="media-video-card"
          onClick={loadFullMedia}
          style={{ width: `${width}px`, height: `${height}px`, position: 'relative', cursor: 'pointer', overflow: 'hidden' }}
        >
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={metadata.file_name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: '#000' }} />
          )}
          <div className="media-video-overlay">
            {loadingFull ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <>
                <Play className="h-8 w-8" />
                <span className="media-file-name">{metadata.file_name}</span>
                <span className="media-file-size">{formatFileSize(metadata.file_size)}</span>
              </>
            )}
          </div>
        </div>
      )
    }

    if (isImage) {
      const previewSrc = expanded && fullSrc ? fullSrc : thumbnailSrc ?? blurhashSrc
      return (
        <div
          className="media-image-container"
          style={{ width: `${width}px`, height: `${height}px`, position: 'relative', cursor: expanded ? 'default' : 'pointer' }}
          onClick={() => !expanded && loadFullMedia()}
        >
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={metadata.file_name}
              className="media-image"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', background: '#222' }} />
          )}
          {loadingFull && (
            <div className="media-image-loading-overlay">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      )
    }

    return null
  }
}
