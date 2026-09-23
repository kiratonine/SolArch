import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageUpIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { TileCover } from '@/components/archive/tile'
import { Button } from '@/components/ui/button'
import {
  queryKeys,
  toUserMessage,
  uploadArchiveCover,
  type CreatorArchive,
} from '@/lib/api'
import { useI18n } from '@/lib/i18n'

const MAX_COVER_BYTES = 5 * 1024 * 1024
const COVER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function CoverUpload({ archive }: { archive: CreatorArchive }) {
  const { t } = useI18n()
  const copy = t.dashboard.detail.cover
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const readerRef = useRef<FileReader | null>(null)
  const [selected, setSelected] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => () => readerRef.current?.abort(), [])

  const upload = useMutation({
    mutationFn: (file: File) => uploadArchiveCover(archive.archive_id, file),
    onSuccess: (result) => {
      queryClient.setQueryData<CreatorArchive>(
        queryKeys.archives.detail(archive.archive_id),
        (current) => (current ? { ...current, cover_url: result.cover_url } : current),
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.archives.list() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.all })
      setSelected(null)
      setPreview(null)
      readerRef.current = null
      setSaved(true)
      if (inputRef.current) inputRef.current.value = ''
    },
  })

  function choose(file: File | undefined) {
    readerRef.current?.abort()
    readerRef.current = null
    upload.reset()
    setSaved(false)
    setValidationError(null)
    setSelected(null)
    setPreview(null)

    if (!file) return
    if (!COVER_TYPES.has(file.type)) {
      setValidationError(copy.invalidType)
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      setValidationError(copy.tooLarge)
      return
    }
    setSelected(file)
    const reader = new FileReader()
    readerRef.current = reader
    reader.onload = () => {
      if (readerRef.current !== reader) return
      setPreview(typeof reader.result === 'string' ? reader.result : null)
    }
    reader.onerror = () => {
      if (readerRef.current === reader) setPreview(null)
    }
    reader.readAsDataURL(file)
  }

  const failure = validationError ?? (upload.error ? toUserMessage(upload.error) : null)

  return (
    <div className="bg-card border-border mt-4 grid gap-5 rounded-lg border p-5 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-start">
      <div className="overflow-hidden rounded-md" data-testid="cover-preview">
        <TileCover url={preview ?? archive.cover_url} />
      </div>

      <div className="min-w-0">
        <h3 className="text-base font-semibold">{copy.title}</h3>
        <p className="text-muted-foreground mt-2 max-w-[62ch] text-sm">{copy.body}</p>
        <p className="text-muted-foreground mt-1 text-xs">{copy.formats}</p>

        {selected && <p className="mt-3 truncate text-sm">{copy.selected(selected.name)}</p>}
        {failure && <p className="text-state-error mt-3 text-sm" role="alert">{failure}</p>}
        {saved && <p className="text-state-success mt-3 text-sm" role="status">{copy.success}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <label className="border-border bg-background hover:bg-muted focus-within:ring-ring/50 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium focus-within:ring-3">
            <ImageUpIcon aria-hidden="true" className="size-4" />
            {archive.cover_url ? copy.replace : copy.choose}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(event) => choose(event.currentTarget.files?.[0])}
            />
          </label>
          <Button
            type="button"
            disabled={!selected || upload.isPending}
            onClick={() => selected && upload.mutate(selected)}
          >
            {upload.isPending ? copy.uploading : copy.upload}
          </Button>
        </div>
      </div>
    </div>
  )
}
