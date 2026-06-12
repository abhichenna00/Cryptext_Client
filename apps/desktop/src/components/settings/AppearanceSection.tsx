import { Check } from 'lucide-react'

import { useTheme } from '@/hooks'
import { useAppearance, ACCENTS, type Accent, type ChromeTone } from '@/hooks/useAppearance'
import { cn } from '@/lib/utils'

type Mode = 'light' | 'dark'

interface Preset {
  id: string
  name: string
  theme: Mode
  chrome: ChromeTone
  accent: Exclude<Accent, 'custom'>
}

/** One-tap palettes from the design's Appearance pass. The prototype's
 *  aesthetic (redesign/polish) axis doesn't exist here — the app ships the
 *  flat layout only — so presets map to mode + sidebar tone + accent. */
const PRESETS: Preset[] = [
  { id: 'graphite', name: 'Graphite', theme: 'dark', chrome: 'match', accent: 'slate' },
  { id: 'midnight', name: 'Midnight', theme: 'dark', chrome: 'match', accent: 'indigo' },
  { id: 'paper', name: 'Paper', theme: 'light', chrome: 'match', accent: 'slate' },
  { id: 'ink', name: 'Ink', theme: 'light', chrome: 'contrast', accent: 'indigo' },
  { id: 'forest', name: 'Forest', theme: 'dark', chrome: 'match', accent: 'emerald' },
  { id: 'ember', name: 'Ember', theme: 'dark', chrome: 'match', accent: 'ember' },
  { id: 'daylight', name: 'Daylight', theme: 'light', chrome: 'match', accent: 'indigo' },
  { id: 'rosewood', name: 'Rosewood', theme: 'dark', chrome: 'match', accent: 'rose' },
]

const ACCENT_SWATCH: Record<Exclude<Accent, 'custom'>, string> = {
  ember: 'oklch(0.70 0.18 47)',
  slate: 'oklch(0.65 0.04 80)',
  indigo: 'oklch(0.65 0.14 265)',
  emerald: 'oklch(0.65 0.14 150)',
  amber: 'oklch(0.72 0.14 70)',
  rose: 'oklch(0.65 0.14 18)',
}

/** Miniature app mock — rail + two text lines + accent bubble — rendered
 *  inside its own `.light`/`.dark` scope so both modes preview correctly
 *  whatever the active theme is. */
function ThemePreview({ theme, chrome, accent }: Omit<Preset, 'id' | 'name'>) {
  return (
    <div
      className={cn(
        'flex h-full w-full',
        theme,
        `accent-${accent}`,
        chrome === 'contrast' && 'chrome-contrast',
      )}
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="flex w-[22%] flex-col items-center gap-1 py-1.5"
        style={{ background: 'var(--chrome)' }}
      >
        <i className="block size-1.5 rounded-full" style={{ background: 'var(--brand)' }} />
        <i className="block size-1.5 rounded-full opacity-40" style={{ background: 'var(--chrome-fg)' }} />
        <i className="block size-1.5 rounded-full opacity-40" style={{ background: 'var(--chrome-fg)' }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <i className="block h-1 w-3/4 rounded-full" style={{ background: 'var(--fg-dim)' }} />
        <i className="block h-1 w-1/2 rounded-full opacity-60" style={{ background: 'var(--fg-dim)' }} />
        <i
          className="mt-auto block h-2.5 w-2/3 self-end rounded-[4px]"
          style={{ background: 'var(--brand)' }}
        />
      </div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-[12px] transition-colors',
            o.value === value
              ? 'bg-surface text-fg shadow-[0_1px_2px_oklch(0_0_0/0.1)]'
              : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ControlRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <div className="text-[13px] text-fg">{label}</div>
        {hint && <div className="text-[11.5px] text-fg-dim">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export default function AppearanceSection() {
  const { theme, toggle: toggleTheme } = useTheme()
  const { appearance, update } = useAppearance()

  const setMode = (mode: Mode) => {
    if (mode !== theme) toggleTheme()
  }

  const applyPreset = (p: Preset) => {
    setMode(p.theme)
    update({ accent: p.accent, chrome: p.chrome })
  }

  const presetMatches = (p: Preset) =>
    p.theme === theme && p.chrome === appearance.chrome && p.accent === appearance.accent

  return (
    <div className="flex flex-col gap-5">
      {/* Presets */}
      <div>
        <div className="mb-2 font-mono text-[11px] tracking-[0.08em] text-fg-muted uppercase">
          Presets
        </div>
        <div className="grid grid-cols-4 gap-2">
          {PRESETS.map((p) => {
            const active = presetMatches(p)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className="group/preset flex flex-col gap-1.5 text-left"
              >
                <div
                  className={cn(
                    'h-[54px] overflow-hidden rounded-md border transition-all',
                    active
                      ? 'border-[var(--brand)] ring-2 ring-[var(--brand-soft)]'
                      : 'border-border group-hover/preset:-translate-y-px group-hover/preset:border-border-strong',
                  )}
                >
                  <ThemePreview theme={p.theme} chrome={p.chrome} accent={p.accent} />
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[11.5px]',
                    active ? 'text-fg' : 'text-fg-muted',
                  )}
                >
                  {active && <Check size={10} strokeWidth={2.5} className="text-[var(--brand)]" />}
                  {p.name}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Customize */}
      <div>
        <div className="mb-1 font-mono text-[11px] tracking-[0.08em] text-fg-muted uppercase">
          Customize
        </div>
        <div className="divide-y divide-border rounded-lg border border-border bg-surface px-3">
          <ControlRow label="Mode">
            <Segmented
              value={theme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={setMode}
            />
          </ControlRow>

          <ControlRow label="Sidebar tone" hint="Match canvas, or dark contrast">
            <Segmented
              value={appearance.chrome}
              options={[
                { value: 'match', label: 'Match' },
                { value: 'contrast', label: 'Contrast' },
              ]}
              onChange={(chrome) => update({ chrome })}
            />
          </ControlRow>

          <ControlRow label="Accent">
            <div className="flex items-center gap-1.5">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  title={a}
                  onClick={() => update({ accent: a })}
                  className={cn(
                    'grid size-6 place-items-center rounded-full border transition-all',
                    appearance.accent === a
                      ? 'border-[var(--brand)] ring-2 ring-[var(--brand-soft)]'
                      : 'border-transparent hover:scale-110',
                  )}
                >
                  <i className="block size-4 rounded-full" style={{ background: ACCENT_SWATCH[a] }} />
                </button>
              ))}
              <button
                type="button"
                title="Custom color"
                onClick={() => update({ accent: 'custom' })}
                className={cn(
                  'grid size-6 place-items-center rounded-full border transition-all',
                  appearance.accent === 'custom'
                    ? 'border-[var(--brand)] ring-2 ring-[var(--brand-soft)]'
                    : 'border-transparent hover:scale-110',
                )}
              >
                <i
                  className="block size-4 rounded-full"
                  style={{
                    background:
                      appearance.accent === 'custom'
                        ? appearance.customAccent
                        : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
                  }}
                />
              </button>
            </div>
          </ControlRow>

          {appearance.accent === 'custom' && (
            <ControlRow label="Custom accent" hint={appearance.customAccent}>
              <label
                className="relative block size-8 cursor-pointer overflow-hidden rounded-md border border-border"
                style={{ background: appearance.customAccent }}
              >
                <input
                  type="color"
                  value={appearance.customAccent}
                  onChange={(e) => update({ accent: 'custom', customAccent: e.target.value })}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
              </label>
            </ControlRow>
          )}

          <ControlRow label="Floating glass" hint="Translucency on the call window and overlays">
            <Segmented
              value={appearance.glass ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'on', label: 'On' },
              ]}
              onChange={(v) => update({ glass: v === 'on' })}
            />
          </ControlRow>
        </div>
        <p className="mt-2 text-[11.5px] text-fg-dim">Changes apply instantly.</p>
      </div>
    </div>
  )
}
