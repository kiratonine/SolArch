import { useState } from 'react'

import { SealMark } from '@/components/brand/seal-mark'

/**
 * Общее для плиток архива: каталог и кабинет автора раскладывают их одинаково,
 * и расходиться им незачем.
 */

/**
 * Сетка плиток. Колонки добавляются по ширине экрана, а не по числу архивов.
 * Страница каталога — 20 архивов: при пяти колонках это четыре полных ряда,
 * при четырёх — пять.
 */
export const TILE_GRID = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'

/**
 * Каркас плитки. Тянется на высоту ряда (`h-full`), чтобы низ соседних плиток
 * стоял на одной линии.
 */
export const TILE_FRAME =
  'bg-card border-border relative flex h-full flex-col overflow-hidden rounded-lg border'

/**
 * Отклик плитки на наведение — единственная тень в интерфейсе: плитка чуть
 * приподнимается, и тень ложится под неё снизу, а не вокруг. Цвет тени задан
 * тёплым тёмным, а не токеном: `--foreground` в тёмной теме светлый.
 */
export const TILE_HOVER =
  'transition-[box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_20px_-14px_oklch(0.2_0.02_60/0.45)]'

/**
 * Кадр обложки на плитке.
 *
 * Кадр есть всегда, даже без обложки: иначе плитки одного ряда были бы разной
 * высоты. Пустой кадр — не «нет картинки», а сам образ продукта: поверхность,
 * расчерченная волосяными линиями, и знак запечатанного листа — контур виден,
 * содержимое нет. Битая ссылка сводится к той же заглушке.
 */
export function TileCover({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false)

  return (
    <div className="border-border bg-secondary relative aspect-[1200/630] overflow-hidden border-b">
      {url && !broken ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div aria-hidden="true" className="text-foreground/85 grid size-full place-items-center">
          <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-size-[25%_33.34%]" />
          <SealMark className="relative size-10" />
        </div>
      )}
    </div>
  )
}
