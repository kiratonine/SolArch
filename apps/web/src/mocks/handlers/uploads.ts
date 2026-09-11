import { HttpResponse, http } from 'msw'

import { API_PREFIX } from '@/lib/api/config'
import type { PublicFileEntry, UploadInitRequest } from '@/lib/api/types'
import { db, findById, nextId } from '../db'
import { readZipEntries } from '../zip-entries'
import { apiError, findOwned, requireSession, route } from './shared'

/** Форматы, которые Viewer умеет показывать в MVP (`docs/INTEGRATION.md` §8). */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Разбор ZIP — та же проверка, что делает backend на `complete`: читается ли архив
 * вообще, нет ли в нём чужих форматов, есть ли в нём хоть что-нибудь.
 *
 * Возвращает опись или причину отказа. Формулировки — как у backend, по-английски:
 * страница показывает их как есть.
 */
function unpack(bytes: ArrayBuffer | null): PublicFileEntry[] | string {
  const entries = bytes ? readZipEntries(bytes) : null
  if (!entries) return 'Failed to read ZIP archive'

  const files: PublicFileEntry[] = []

  for (const { path, size } of entries) {
    if (path.endsWith('/') || path.startsWith('__MACOSX/') || path.endsWith('.DS_Store')) continue

    const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
    const mime = MIME_BY_EXTENSION[extension]
    if (!mime) {
      return `Unsupported file format in archive: ${path}. Supported formats in MVP are: PDF, PNG, JPG, JPEG, WebP, DOCX, XLSX`
    }

    files.push({
      display_path: path,
      display_name: path.split('/').at(-1) ?? path,
      extension,
      mime_type: mime,
      size_bytes: size,
    })
  }

  return files.length > 0 ? files : 'Uploaded archive contains no valid supported files'
}

export const uploadHandlers = [
  http.post(route('/uploads/init'), async ({ request }) => {
    const unauthorized = requireSession(request)
    if (unauthorized) return unauthorized

    const body = (await request.json()) as UploadInitRequest
    const archive = findOwned(body.archive_id)
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const uploadId = nextId('upl')
    db.uploads.push({
      upload_id: uploadId,
      archive_id: body.archive_id,
      filename: body.filename,
      size_bytes: body.size_bytes,
      bytes: null,
    })

    archive.technical_status = 'uploading'

    // Как у backend: адрес относительный, от корня API. Клиент его не берёт (см. `uploads.ts`).
    return HttpResponse.json(
      { upload_id: uploadId, status: 'pending', upload_url: `${API_PREFIX}/uploads/${uploadId}/data` },
      { status: 201 },
    )
  }),

  http.post(route('/uploads/:uploadId/data'), async ({ params, request }) => {
    const unauthorized = requireSession(request)
    if (unauthorized) return unauthorized

    const upload = db.uploads.find((item) => item.upload_id === String(params.uploadId))
    if (!upload) return apiError(404, 'UPLOAD_NOT_FOUND', 'Upload not found')

    upload.bytes = await request.arrayBuffer()
    return HttpResponse.json({ upload_id: upload.upload_id, status: 'uploaded' }, { status: 201 })
  }),

  http.post(route('/uploads/:uploadId/complete'), ({ params, request }) => {
    const unauthorized = requireSession(request)
    if (unauthorized) return unauthorized

    const upload = db.uploads.find((item) => item.upload_id === String(params.uploadId))
    if (!upload) return apiError(404, 'UPLOAD_NOT_FOUND', 'Upload not found')

    const archive = findOwned(upload.archive_id)
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const unpacked = unpack(upload.bytes)
    if (typeof unpacked === 'string') {
      archive.technical_status = 'failed'
      return apiError(400, 'BAD_REQUEST', unpacked)
    }

    // Загрузка заменяет содержимое целиком, как у backend: прежнюю опись он стирает.
    archive.files = unpacked
    archive.file_count = unpacked.length
    archive.size_bytes = unpacked.reduce((sum, file) => sum + file.size_bytes, 0)
    delete archive.failure_reason

    // Сборка .slr занимает время: сначала processing, затем ready.
    archive.technical_status = 'processing'
    const archiveId = archive.archive_id
    setTimeout(() => {
      const target = findById(archiveId)
      if (target?.technical_status === 'processing') target.technical_status = 'ready'
    }, 1_500)

    return HttpResponse.json({
      upload_id: upload.upload_id,
      archive_id: archive.archive_id,
      technical_status: archive.technical_status,
    })
  }),

  http.post(route('/uploads/:uploadId/cancel'), ({ params, request }) => {
    const unauthorized = requireSession(request)
    if (unauthorized) return unauthorized

    const uploadId = String(params.uploadId)
    const upload = db.uploads.find((item) => item.upload_id === uploadId)

    db.uploads = db.uploads.filter((item) => item.upload_id !== uploadId)

    // Мок, в отличие от backend, откатывает статус: иначе архив висел бы в `uploading`
    // вечно, и опрос кабинета не прекращался бы никогда.
    const archive = upload ? findById(upload.archive_id) : undefined
    if (archive?.technical_status === 'uploading') {
      archive.technical_status = archive.files.length > 0 ? 'ready' : 'draft'
    }

    return HttpResponse.json({ status: 'cancelled' }, { status: 201 })
  }),
]
