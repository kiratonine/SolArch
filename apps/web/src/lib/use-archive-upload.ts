import { useCallback, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { queryKeys, toUserMessage, uploadArchiveContent } from '@/lib/api'
import { packForUpload, splitUploadFiles, type RejectedFile } from '@/lib/upload-files'

/**
 * Загрузка содержимого архива.
 *
 * Backend принимает один ZIP за раз и каждой загрузкой заменяет всё, что лежало
 * в архиве (ответ на Q2). Поэтому один выбор — одна загрузка: отдельные файлы
 * склеиваются в ZIP здесь же, в браузере, а готовый ZIP уходит как есть.
 *
 * Пока загрузка идёт, новую не начинают (страница гасит выбор): вторая заменила бы
 * первую, и в архиве оказалось бы не то, что автор выбрал последним, а то, что
 * последним дошло.
 *
 * Криптографии здесь нет и быть не может: ZIP — упаковка, а не защита. Запечатанный
 * `.slr` собирает backend (`docs/roles/02_MARKETPLACE_FRONTEND.md` §9).
 */

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'canceled'

export interface UploadItem {
  id: string
  /** Имя файла, когда он один. Пакет из нескольких страница называет их числом. */
  name: string
  fileCount: number
  sizeBytes: number
  status: UploadItemStatus
  /** Доля от 0 до 1. Осмысленна, пока статус `uploading`. */
  ratio: number
  /** Формулировка backend, когда загрузка не дошла. */
  error?: string
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface ArchiveUpload {
  items: UploadItem[]
  /** Что не прошло проверку до сети. Держится до следующего выбора файлов. */
  rejected: RejectedFile[]
  /** Идёт ли загрузка: на это время страница не предлагает выбрать новое. */
  isBusy: boolean
  add: (files: File[]) => void
  cancel: (id: string) => void
  retry: (id: string) => void
}

export function useArchiveUpload(archiveId: string): ArchiveUpload {
  const queryClient = useQueryClient()

  const [items, setItems] = useState<UploadItem[]>([])
  const [rejected, setRejected] = useState<RejectedFile[]>([])

  /**
   * Очередь читается из ref, а не из состояния: цикл передачи живёт дольше одного
   * рендера, и замыкание на `items` показывало бы ему список, устаревший к моменту,
   * когда очередь до него дойдёт.
   */
  const itemsRef = useRef<UploadItem[]>([])
  const filesRef = useRef(new Map<string, File[]>())
  const abortsRef = useRef(new Map<string, AbortController>())
  const runningRef = useRef(false)
  const counterRef = useRef(0)

  const commit = useCallback((next: UploadItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const patch = useCallback(
    (id: string, change: Partial<UploadItem>) => {
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...change } : item)))
    },
    [commit],
  )

  /**
   * После каждой загрузки экран обязан перечитать архив: `complete` меняет его
   * технический статус, число файлов и размер, и знает об этом только backend.
   */
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.archives.detail(archiveId) })
    await queryClient.invalidateQueries({ queryKey: queryKeys.archives.files(archiveId) })
    // Список кабинета показывает те же статусы, но сейчас он не на экране.
    void queryClient.invalidateQueries({ queryKey: queryKeys.archives.list() })
  }, [archiveId, queryClient])

  const pump = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true

    try {
      for (;;) {
        const next = itemsRef.current.find((item) => item.status === 'queued')
        if (!next) break

        const files = filesRef.current.get(next.id)
        if (!files) {
          // Выбор забрали отменой ровно между выбором и очередью.
          patch(next.id, { status: 'canceled' })
          continue
        }

        const controller = new AbortController()
        abortsRef.current.set(next.id, controller)
        patch(next.id, { status: 'uploading', ratio: 0, error: undefined })

        // Прогресс приходит чаще, чем меняется показанное число: перерисовываем
        // только на смене целого процента.
        let shownPercent = -1

        try {
          const content = await packForUpload(files)

          // Отмена, нажатая, пока файлы склеивались, не должна заводить загрузку
          // на backend: `init` уже сдвинул бы статус архива.
          if (controller.signal.aborted) throw new DOMException('Upload aborted', 'AbortError')

          await uploadArchiveContent(archiveId, content, {
            signal: controller.signal,
            onProgress: ({ ratio }) => {
              const percent = Math.round(ratio * 100)
              if (percent === shownPercent) return
              shownPercent = percent
              patch(next.id, { ratio })
            },
          })

          patch(next.id, { status: 'done', ratio: 1 })
          filesRef.current.delete(next.id)
        } catch (error) {
          if (isAbortError(error)) {
            patch(next.id, { status: 'canceled' })
            filesRef.current.delete(next.id)
          } else {
            // Файлы остаются в памяти: упавшую загрузку можно повторить, не выбирая
            // всё заново.
            patch(next.id, { status: 'failed', error: toUserMessage(error) })
          }
        } finally {
          abortsRef.current.delete(next.id)
        }

        // Отменённая загрузка тоже меняет архив: backend откатывает `uploading`.
        await refresh()
      }

      /**
       * Очередь опустела — и вместе с ней исчезают дошедшие строки.
       *
       * Найдено на живом экране: после удачной загрузки страница показывала один
       * и тот же список дважды подряд — «передан» в очереди и он же в описи архива.
       * Опись — свидетельство сильнее: она пришла с backend.
       *
       * Упавшие остаются: у них есть незаконченное дело — кнопка «передать заново».
       */
      commit(itemsRef.current.filter((item) => item.status === 'failed'))
    } finally {
      runningRef.current = false
    }
  }, [archiveId, commit, patch, refresh])

  const add = useCallback(
    (files: File[]) => {
      const { accepted, rejected: refused } = splitUploadFiles(files)
      setRejected(refused)
      if (accepted.length === 0) return

      counterRef.current += 1
      const id = `upl-${counterRef.current}`
      filesRef.current.set(id, accepted)

      commit([
        ...itemsRef.current,
        {
          id,
          name: accepted[0]?.name ?? '',
          fileCount: accepted.length,
          sizeBytes: accepted.reduce((sum, file) => sum + file.size, 0),
          status: 'queued',
          ratio: 0,
        },
      ])
      void pump()
    },
    [commit, pump],
  )

  const cancel = useCallback(
    (id: string) => {
      const controller = abortsRef.current.get(id)
      if (controller) {
        // Идущую передачу обрывает `uploadArchiveContent`: он же скажет backend
        // отменить загрузку, чтобы она не висела там незакрытой.
        controller.abort()
        return
      }

      filesRef.current.delete(id)
      patch(id, { status: 'canceled' })
    },
    [patch],
  )

  const retry = useCallback(
    (id: string) => {
      if (!filesRef.current.has(id)) return
      patch(id, { status: 'queued', ratio: 0, error: undefined })
      void pump()
    },
    [patch, pump],
  )

  const isBusy = items.some((item) => item.status === 'queued' || item.status === 'uploading')

  return { items, rejected, isBusy, add, cancel, retry }
}
