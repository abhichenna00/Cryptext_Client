import { useEffect, useState } from 'react'
import { parseChangelog, type ChangelogRelease } from './changelog'

const CHANGELOG_URL =
  'https://raw.githubusercontent.com/abhichenna00/Cryptext_Client/main/CHANGELOG.md'

/**
 * Seeds release state with the SSR-inlined build-time data, then refetches
 * `CHANGELOG.md` from `main` on mount. Both consumers (`LandingApp`,
 * `ChangelogApp`) call this so the Nav version pill and the changelog page
 * stay in sync without a redeploy.
 */
export function useLiveChangelog(initial: ChangelogRelease[]): ChangelogRelease[] {
  const [releases, setReleases] = useState<ChangelogRelease[]>(initial)

  useEffect(() => {
    let cancelled = false
    fetch(CHANGELOG_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        const next = parseChangelog(text)
        if (next.length === 0) return
        setReleases((prev) =>
          JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
        )
      })
      .catch((err) => {
        // Keep the SSR'd inline content visible; just log.
        console.error('Changelog refetch failed:', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return releases
}
