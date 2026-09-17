import type { MouseEvent, ReactNode } from 'react'

import { AvatarChip } from '@/components/ui/avatar-chip'
import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { useI18n } from '@/i18n'
import { brandFor } from '@/lib/mcp-brands'

import { prettyName } from '../settings/helpers'

import type { CatalogEntry } from './catalog-data'

const ICONS: [RegExp, string, string][] = [
  [/password|secret|security|auth/, 'key', 'var(--ui-orange)'],
  [/video|movie|animation/, 'device-camera-video', 'var(--ui-purple)'],
  [/photo|image|design|media|art/, 'file-media', 'var(--ui-purple)'],
  [/spreadsheet|excel|finance|business/, 'table', 'var(--ui-green)'],
  [/browser|search|research/, 'browser', 'var(--ui-cyan)'],
  [/mail|chat|messaging|integration/, 'mail', 'var(--ui-blue)'],
  [/calendar|task|productivity/, 'checklist', 'var(--ui-yellow)'],
  [/audio|voice|speech/, 'mic', 'var(--ui-purple)'],
  [/database|data|analytics/, 'database', 'var(--ui-green)'],
  [/code|development|terminal|cli/, 'code', 'var(--ui-blue)']
]

/** Keep source wording intact: conjunctions and version numbers are not sentence boundaries. */
export function catalogSummary(entry: Pick<CatalogEntry, 'description' | 'overview'>): string[] {
  const text = (entry.description.trim() || entry.overview.trim()).replace(/\s+/g, ' ')

  return text.split(/(?<=[.!?])\s+|(?<=[。！？])/u).map(point => point.trim()).filter(Boolean).slice(0, 2)
}

interface CatalogCardProps {
  entry: CatalogEntry
  action: ReactNode
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void
}

export function CatalogCard({ entry, action, onOpen }: CatalogCardProps) {
  const { t } = useI18n()
  const brand = brandFor(entry.name)

  const [, glyph, color] = ICONS.find(([pattern]) => pattern.test(`${entry.name} ${entry.category}`.toLowerCase())) ??
    [null, 'extensions', 'var(--ui-accent)']

  const identity = brand
    ? { ...brand, color: brand.monochrome ? color : brand.color, monochrome: false }
    : { color }

  const summary = catalogSummary(entry)

  return (
    <article className="row-hover flex h-45 min-w-0 flex-col overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-chat-bubble-background)" data-catalog-card>
      <RowButton
        aria-haspopup="dialog"
        aria-label={entry.name}
        className="flex min-h-0 min-w-0 flex-1 cursor-pointer flex-col gap-2 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
        onClick={onOpen}
      >
        <span className="flex w-full min-w-0 items-start gap-2">
          <AvatarChip aria-hidden brand={identity} className="size-7" name={entry.name} variant="raised">
            {!brand ? <Codicon name={glyph} size="1rem" /> : undefined}
          </AvatarChip>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold leading-tight">{entry.name}</span>
            <span className="mt-0.5 block truncate text-[0.65rem] text-(--ui-text-tertiary)">{prettyName(entry.source)}</span>
          </span>
        </span>
        <span className="block w-full min-w-0">
          <span className="mb-1 block text-[0.65rem] font-medium text-(--ui-text-secondary)">{t.catalog.whatItDoes}</span>
          <span aria-label={t.catalog.whatItDoes} className="grid gap-1" role="list">
            {(summary.length ? summary : [t.catalog.noDescription]).map((point, index) => (
              <span className="flex min-w-0 items-start gap-1.5 text-xs leading-snug" key={index} role="listitem">
                <span aria-hidden className="shrink-0 text-(--ui-text-tertiary)">•</span>
                <span className="line-clamp-2 min-w-0 break-words">{point}</span>
              </span>
            ))}
          </span>
        </span>
      </RowButton>
      <div className="flex shrink-0 items-center justify-between gap-2 px-2.5 pb-2">
        <span className="min-w-0 truncate text-[0.65rem] text-(--ui-text-tertiary)">{prettyName(entry.categoryLabel)}</span>
        {action}
      </div>
    </article>
  )
}
