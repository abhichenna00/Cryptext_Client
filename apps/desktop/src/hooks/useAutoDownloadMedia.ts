/**
 * Whether thumbnails and (eventually) full media files should be fetched
 * automatically when a message scrolls into the viewport.
 *
 * Stubbed to `true` for development so sharp thumbnails load and can be
 * tested end-to-end. Once the Settings UI ships a toggle, this hook will
 * read from persistent device-local settings and default to `false` — the
 * blurhash placeholder will be the only thing shown until the user taps.
 */
export function useAutoDownloadMedia(): boolean {
  return true
}
