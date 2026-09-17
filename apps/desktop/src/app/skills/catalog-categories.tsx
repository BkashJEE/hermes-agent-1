import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'

import { prettyName } from '../settings/helpers'

interface CatalogCategoriesProps {
  categories: [string, string][]
  counts: ReadonlyMap<string, number>
  total: number
  value: string
  onChange: (value: string) => void
}

export function CatalogCategories({ categories, counts, total, value, onChange }: CatalogCategoriesProps) {
  const { t } = useI18n()
  const rail = useRef<HTMLDivElement>(null)
  const options = [['all', t.catalog.allCategories], ...categories]
  const index = Math.max(0, options.findIndex(([id]) => id === value))

  useEffect(() => {
    const element = rail.current
    const selected = element?.querySelector<HTMLElement>('[aria-pressed="true"]')

    if (!element || !selected) {
      return
    }

    // Move only this horizontal rail; scrollIntoView can also move the page/header.
    const center = () => {
      element.scrollLeft += selected.getBoundingClientRect().left - element.getBoundingClientRect().left -
        (element.clientWidth - selected.offsetWidth) / 2
    }

    center()
    const observer = new ResizeObserver(center)
    observer.observe(element)
    observer.observe(selected)

    return () => observer.disconnect()
  }, [value])

  return (
    <section aria-label={t.catalog.category} className="shrink-0 space-y-1 px-3 pb-2">
      <div className="flex min-w-0 items-center gap-1">
        <Tip label={t.catalog.previousCategory}>
          <Button aria-label={t.catalog.previousCategory} disabled={index === 0} onClick={() => onChange(options[index - 1][0])} size="icon-xs" variant="ghost">
            <Codicon name="chevron-left" />
          </Button>
        </Tip>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none]" ref={rail}>
          {options.map(([id, label]) => (
            <Button aria-pressed={id === value} className="shrink-0" key={id} onClick={() => onChange(id)} size="xs" variant={id === value ? 'secondary' : 'ghost'}>
              {id === 'all' ? label : prettyName(label)}
              <span className="text-(--ui-text-tertiary) tabular-nums">{id === 'all' ? total : (counts.get(id) ?? 0)}</span>
            </Button>
          ))}
        </div>
        <Tip label={t.catalog.nextCategory}>
          <Button aria-label={t.catalog.nextCategory} disabled={index === options.length - 1} onClick={() => onChange(options[index + 1][0])} size="icon-xs" variant="ghost">
            <Codicon name="chevron-right" />
          </Button>
        </Tip>
      </div>
      <input
        aria-label={t.catalog.chooseCategory}
        aria-valuetext={index === 0 ? t.catalog.allCategories : prettyName(options[index][1])}
        className="block h-4 w-full cursor-pointer accent-(--ui-accent)"
        disabled={options.length === 1}
        max={Math.max(1, options.length - 1)}
        min={0}
        onChange={event => onChange(options[Number(event.target.value)][0])}
        step={1}
        type="range"
        value={index}
      />
    </section>
  )
}
