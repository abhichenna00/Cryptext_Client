import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Download, Film, Loader2, ImageIcon } from 'lucide-react'

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
}

interface MediaMessageProps {
  messageId: string
  content: string
  conversationId: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function MediaMessage({ messageId, content, conversationId }: MediaMessageProps) {
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null)
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null)
  const [fullSrc, setFullSrc] = useState<string | null>(null)
  const [loadingThumb, setLoadingThumb] = useState(false)
  const [loadingFull, setLoadingFull] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const parsed = JSON.parse(content) as MediaMetadata
      setMetadata(parsed)
    } catch {
      setError('Invalid media metadata')
    }
  }, [content])

  useEffect(() => {
    if (!metadata) return

    const isImage = metadata.media_type.startsWith('image/')

    if (isImage && metadata.thumb_s3_key && metadata.thumb_nonce) {
      loadThumbnail()
    } else if (isImage) {
      // No thumbnail, load full image directly
      loadFullMedia()
    }
  }, [metadata])

  const loadThumbnail = async () => {
    if (!metadata?.thumb_s3_key || !metadata?.thumb_nonce) return
    setLoadingThumb(true)

    try {
      const path = await invoke<string>('download_media', {
        s3Key: metadata.thumb_s3_key,
        mediaKey: metadata.media_key,
        nonce: metadata.thumb_nonce,
        conversationId,
        messageId,
        isThumbnail: true,
      })
      setThumbnailSrc(convertFileSrc(path))
    } catch (err) {
      console.error('Failed to load thumbnail:', err)
      setError('Failed to load preview')
    } finally {
      setLoadingThumb(false)
    }
  }

  const loadFullMedia = async () => {
    if (!metadata) return
    setLoadingFull(true)

    try {
      const path = await invoke<string>('download_media', {
        s3Key: metadata.s3_key,
        mediaKey: metadata.media_key,
        nonce: metadata.media_nonce,
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

  if (error) {
    return <div className="media-error">{error}</div>
  }

  if (!metadata) {
    return <div className="media-loading"><Loader2 className="h-4 w-4 animate-spin" /></div>
  }

  const isImage = metadata.media_type.startsWith('image/')
  const isVideo = metadata.media_type.startsWith('video/')

  // Constrain dimensions for display
  const maxWidth = 400
  const maxHeight = 300
  let displayWidth = metadata.width || maxWidth
  let displayHeight = metadata.height || maxHeight

  if (displayWidth > maxWidth) {
    const ratio = maxWidth / displayWidth
    displayWidth = maxWidth
    displayHeight = Math.round(displayHeight * ratio)
  }
  if (displayHeight > maxHeight) {
    const ratio = maxHeight / displayHeight
    displayHeight = maxHeight
    displayWidth = Math.round(displayWidth * ratio)
  }

  // Video: show icon + file info
  if (isVideo) {
    return (
      <div className="media-video-card" onClick={loadFullMedia}>
        {fullSrc ? (
          <video
            src={fullSrc}
            controls
            className="media-video-player"
            style={{ maxWidth: `${maxWidth}px`, maxHeight: `${maxHeight}px` }}
          />
        ) : (
          <div className="media-video-placeholder">
            {loadingFull ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <>
                <Film className="h-8 w-8" />
                <span className="media-file-name">{metadata.file_name}</span>
                <span className="media-file-size">{formatFileSize(metadata.file_size)}</span>
                <Download className="h-4 w-4 media-download-icon" />
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // Image: show thumbnail → click to expand
  if (isImage) {
    const src = expanded && fullSrc ? fullSrc : thumbnailSrc

    return (
      <div
        className="media-image-container"
        style={{ width: `${displayWidth}px` }}
        onClick={() => !expanded && loadFullMedia()}
      >
        {loadingThumb && !src ? (
          <div
            className="media-image-placeholder"
            style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
          >
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : src ? (
          <img
            src={src}
            alt={metadata.file_name}
            className="media-image"
            style={{ maxWidth: `${maxWidth}px`, maxHeight: `${maxHeight}px` }}
          />
        ) : (
          <div
            className="media-image-placeholder"
            style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
          >
            <ImageIcon className="h-6 w-6" />
          </div>
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
