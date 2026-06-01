// CHANGELOG.md is inlined at build time via Vite's ?raw import.
// Path is relative to this file: src/lib → apps/web → apps → repo root.
import raw from '../../../../CHANGELOG.md?raw'

export interface ChangelogSection {
  kind: string
  items: string[]
}

export interface ChangelogRelease {
  version: string
  date: string
  tag: 'major' | 'minor' | 'patch'
  summary: string
  sections: ChangelogSection[]
}

function bumpKind(curr: string, prev: string | null): 'major' | 'minor' | 'patch' {
  if (!prev) return 'minor'
  const [cMaj, cMin, cPatch] = curr.split('.').map((n) => parseInt(n, 10) || 0)
  const [pMaj, pMin, pPatch] = prev.split('.').map((n) => parseInt(n, 10) || 0)
  if (cMaj !== pMaj) return 'major'
  if (cMin !== pMin) return 'minor'
  if (cPatch !== pPatch) return 'patch'
  return 'patch'
}

function summarize(sections: ChangelogSection[]): string {
  const first = sections[0]?.items[0]
  if (!first) return ''
  const clean = first.replace(/`/g, '')
  if (clean.length <= 140) return clean
  const cut = clean.slice(0, 140)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + '…'
}

export function loadChangelog(): ChangelogRelease[] {
  const lines = raw.split(/\r?\n/)

  const releases: Omit<ChangelogRelease, 'tag' | 'summary'>[] = []
  let current: { version: string; date: string; sections: ChangelogSection[] } | null = null
  let currentSection: ChangelogSection | null = null

  const releaseRe = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/
  const sectionRe = /^###\s+(.+?)\s*$/
  const itemRe = /^[-*]\s+(.*)$/

  for (const line of lines) {
    const rel = releaseRe.exec(line)
    if (rel) {
      if (current) releases.push(current)
      currentSection = null
      const version = rel[1]
      const date = rel[2] ?? ''
      if (!/^\d/.test(version)) {
        current = null
        continue
      }
      current = { version, date, sections: [] }
      continue
    }
    if (!current) continue

    const sec = sectionRe.exec(line)
    if (sec) {
      currentSection = { kind: sec[1], items: [] }
      current.sections.push(currentSection)
      continue
    }

    const item = itemRe.exec(line)
    if (item && currentSection) {
      currentSection.items.push(item[1].trim())
      continue
    }

    if (currentSection && currentSection.items.length > 0 && line.trim() && /^\s+/.test(line)) {
      const last = currentSection.items.length - 1
      currentSection.items[last] += ' ' + line.trim()
    }
  }
  if (current) releases.push(current)

  return releases.map((r, i) => {
    const prev = releases[i + 1]?.version ?? null
    return {
      version: r.version,
      date: r.date,
      tag: bumpKind(r.version, prev),
      summary: summarize(r.sections),
      sections: r.sections,
    }
  })
}
