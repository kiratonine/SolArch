import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { TONE_SPINE, marketplaceSpineTone } from '@/components/archive/tone'
import { PublicLink } from '@/components/publish/public-link'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  publishArchive,
  queryKeys,
  toUserMessage,
  unpublishArchive,
  type CreatorArchive,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Что мешает выставить архив в каталог.
 *
 * Требования публикации задаёт backend (`docs/API.md` §3): владение, собранный
 * контейнер, валидный payout wallet и готовый USDC-аккаунт автора. Владение здесь
 * уже проверено — чужой архив отдаётся как 404. Остальное фронт читает из полей
 * архива, чтобы назвать препятствие до нажатия, а не после отказа. Решает всё
 * равно backend: кнопка не «разрешает» публикацию, она её просит.
 */
type Blocker = 'notReady' | 'payout' | null

function blockerOf(archive: CreatorArchive): Blocker {
  if (archive.technical_status !== 'ready') return 'notReady'
  if (!archive.payout_account_ready) return 'payout'
  return null
}

/**
 * Витрина архива: единственное место, где автор решает, видит ли его кто-нибудь.
 *
 * Блок устроен как блок сборки этажом выше и намеренно отличается от него одним:
 * корешок читает маркетплейсный статус, а не технический. Выше речь о файле, здесь
 * — о каталоге, и опубликованный архив получает чернильный корешок, как карточка
 * в каталоге: он стоит там же, где его видит покупатель.
 *
 * Публикация подтверждения не требует: это то, ради чего человек сюда шёл, и
 * промах отменяется соседней кнопкой. Снятие с витрины — требует: страница
 * перестаёт открываться у всех, кому автор дал ссылку.
 */
export function PublishPanel({
  archive,
  className,
}: {
  archive: CreatorArchive
  className?: string
}) {
  const { t } = useI18n()
  const listing = t.dashboard.detail.listing
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  /**
   * Ответ на publish/unpublish — это сам архив в новом состоянии. Кладём его
   * в кеш вместо повторного запроса, а список кабинета и весь каталог помечаем
   * устаревшими: архив только что появился на витрине или ушёл с неё.
   */
  function apply(updated: CreatorArchive) {
    queryClient.setQueryData(queryKeys.archives.detail(archive.archive_id), updated)
    void queryClient.invalidateQueries({ queryKey: queryKeys.archives.list() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all })
  }

  const publish = useMutation({
    mutationFn: () => publishArchive(archive.archive_id),
    onSuccess: apply,
  })

  const unpublish = useMutation({
    mutationFn: () => unpublishArchive(archive.archive_id),
    onSuccess: (updated) => {
      setConfirming(false)
      apply(updated)
    },
  })

  const status = archive.marketplace_status
  const published = status === 'published'
  const blocker = blockerOf(archive)
  const failure = publish.error ?? unpublish.error
  const busy = publish.isPending || unpublish.isPending

  return (
    <div
      className={cn(
        'bg-card border-border relative overflow-hidden rounded-lg border py-5 pr-5 pl-6 sm:pl-7',
        className,
      )}
      // Публикация меняет весь блок разом: и заголовок, и кнопку, и ссылку.
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', TONE_SPINE[marketplaceSpineTone(status)])}
      />

      <h3 className="font-sans text-base font-semibold tracking-[-0.01em]">
        {listing[status].title}
      </h3>
      <p className="text-muted-foreground mt-2 max-w-[62ch] text-sm">{listing[status].body}</p>

      {published && archive.slug && <PublicLink slug={archive.slug} className="mt-5" />}

      {/* Отказ формулирует backend: требования проверяет он, и его фраза точнее
          нашей догадки о том, какое именно из них не выполнено. */}
      {failure && (
        <p className="text-state-error mt-4 max-w-[62ch] text-[0.875rem]">
          {toUserMessage(failure)}
        </p>
      )}

      {status !== 'blocked' && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {published ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)}>
              {unpublish.isPending ? listing.unpublishing : listing.unpublish}
            </Button>
          ) : (
            <Button
              disabled={blocker !== null || busy}
              onClick={() => publish.mutate()}
            >
              {publish.isPending ? listing.publishing : listing.publish}
            </Button>
          )}

          {/* Причина стоит рядом с погашенной кнопкой, а не вместо неё: иначе
              вопрос «почему нельзя опубликовать» остался бы без ответа. */}
          {blocker && !published && (
            <p className="text-muted-foreground max-w-[52ch] text-[0.8125rem]">
              {listing.requires[blocker]}
            </p>
          )}
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogTitle>{listing.confirm.title}</DialogTitle>
          <DialogDescription>{listing.confirm.body}</DialogDescription>

          <DialogFooter>
            {/* Безопасный ответ стоит первым: его ищет тот, кто нажал случайно. */}
            <DialogClose render={<Button variant="outline" size="sm" />} disabled={busy}>
              {listing.confirm.cancel}
            </DialogClose>

            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => unpublish.mutate()}
            >
              {listing.unpublish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
