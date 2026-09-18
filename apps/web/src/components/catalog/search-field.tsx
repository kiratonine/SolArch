import { useNavigate } from '@tanstack/react-router'
import { SearchIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { catalogLinkSearch } from '@/lib/catalog-search'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Пауза перед записью в адрес: набор слова не должен давать пять запросов подряд. */
const DEBOUNCE_MS = 300

/**
 * Поиск по каталогу.
 *
 * Источник истины — адресная строка, поле лишь отражает её. Поэтому «назад» в браузере
 * возвращает и результаты, и текст в поле, а ссылку с запросом можно переслать.
 *
 * Запись идёт через `replace`, иначе каждая буква оставила бы отдельный шаг истории
 * и одна кнопка «назад» не вернула бы человека туда, откуда он пришёл.
 */
export function SearchField({ value, className }: { value: string; className?: string }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(value)
  const [known, setKnown] = useState(value)

  // Адрес поменялся не нами (переход по ссылке, «назад», очистка) — поле догоняет.
  // Правка состояния прямо в рендере, а не в эффекте: React отбрасывает начатый
  // рендер и сразу перерисовывает с новым значением, без промежуточного кадра
  // со старым текстом в поле.
  if (value !== known) {
    setKnown(value)
    setDraft(value)
  }

  const commit = useCallback(
    (query: string) => {
      void navigate({
        to: '/',
        search: (prev) => catalogLinkSearch({ ...prev, q: query, page: 1 }),
        replace: true,
        // Ввод не должен утаскивать страницу наверх: человек уже стоит там,
        // где читает результаты, и прыжок к шапке читается как перезагрузка.
        resetScroll: false,
      })
    },
    [navigate],
  )

  useEffect(() => {
    if (draft.trim() === value) return

    const timer = setTimeout(() => commit(draft), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, value, commit])

  return (
    <form
      role="search"
      className={cn('relative', className)}
      onSubmit={(event) => {
        // Enter не ждёт паузу: человек уже сказал, что запрос дописан.
        event.preventDefault()
        commit(draft)
      }}
    >
      <label htmlFor="catalog-search" className="sr-only">
        {t.catalog.search.label}
      </label>

      <SearchIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
      />

      <input
        id="catalog-search"
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t.catalog.search.placeholder}
        autoComplete="off"
        className="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 h-9 w-full rounded-sm border pr-9 pl-9 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />

      {draft !== '' && (
        <button
          type="button"
          aria-label={t.catalog.search.clear}
          onClick={() => setDraft('')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </form>
  )
}
