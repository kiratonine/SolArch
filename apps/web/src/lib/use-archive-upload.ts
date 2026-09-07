import { useCallback, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { queryKeys, toUserMessage, uploadArchiveFile } from '@/lib/api'
import { splitUploadFiles, type RejectedFile } from '@/lib/upload-files'

/**
 * Очередь загрузки файлов в архив.
 *
 * Файлы уходят по одному, а не разом. Причин две. Технический статус у архива один
 * на всех, и backend двигает его на каждом `complete` (`uploading → processing`):
 * параллельные загрузки гонялись бы за общий статус, и экран показывал бы то одно,
 * то другое. Вторая — прогресс: две полосы, ползущие по одному каналу, врут обе.
 *
 * Криптографии здесь нет и быть не может: браузер передаёт байты как есть, контейнер
 * `.slr` собирает backend (`docs/roles/02_MARKETPLACE_FRONTEND.md` §9).
 */

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'canceled'

export interface UploadItem {
  id: string
  name: string
  sizeBytes: number
  status: UploadItemStatus
  /** Доля от 0 до 1. Осмысленна, пока статус `uploading`. */
  ratio: number
  /** Формулировка backend, когда файл не дошёл. */
  error?: string
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface ArchiveUpload {
  items: UploadItem[]
  /** Что не прошло проверку до сети. Держится до следующего выбора файлов. */
  rejected: RejectedFile[]
  /** Есть ли ещё что передавать: на это время экран не предлагает выбрать новое. */
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
  const filesRef = useRef(new Map<string, File>())
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
   * После каждого файла экран обязан перечитать архив: `complete` меняет его
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

        const file = filesRef.current.get(next.id)
        if (!file) {
          // Файл забрали отменой ровно между выбором и очередью.
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
          await uploadArchiveFile(archiveId, file, {
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
            // Файл остаётся в памяти: упавшую загрузку можно повторить, не выбирая
            // всё заново — из десяти файлов не дошёл один.
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
       * Опись — свидетельство сильнее: она пришла с backend. Строка «передан» нужна,
       * пока файл идёт, и не нужна, когда он уже лежит внутри.
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

      const queued = accepted.map((file) => {
        counterRef.current += 1
        const id = `upl-${counterRef.current}`
        filesRef.current.set(id, file)
        return { id, name: file.name, sizeBytes: file.size, status: 'queued' as const, ratio: 0 }
      })

      commit([...itemsRef.current, ...queued])
      void pump()
    },
    [commit, pump],
  )

  const cancel = useCallback(
    (id: string) => {
      const controller = abortsRef.current.get(id)
      if (controller) {
        // Идущую передачу обрывает `uploadArchiveFile`: он же скажет backend
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
