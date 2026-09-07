import { HttpResponse, http } from 'msw'

import type { PublicFileEntry, UploadInitRequest } from '@/lib/api/types'
import { db, findById, nextId } from '../db'
import { apiError, requireSession, route } from './shared'

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}

/** Форматы, которые Viewer умеет показывать в MVP (`docs/INTEGRATION.md` §8). */
const SUPPORTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'xlsx']

function extensionOf(filename: string): string {
  return filename.split('.').at(-1)?.toLowerCase() ?? ''
}

export const uploadHandlers = [
  http.post(route('/uploads/init'), async ({ request }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const body = (await request.json()) as UploadInitRequest
    const archive = findById(body.archive_id)

    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const extension = extensionOf(body.filename)
    if (extension !== 'zip' && !SUPPORTED_EXTENSIONS.includes(extension)) {
      return apiError(
        415,
        'UNSUPPORTED_FILE_TYPE',
        `Формат .${extension} не поддерживается в MVP`,
      )
    }

    const uploadId = nextId('upl')
    db.uploads.push({
      upload_id: uploadId,
      archive_id: body.archive_id,
      filename: body.filename,
      size_bytes: body.size_bytes,
    })

    archive.technical_status = 'uploading'

    // Мок отдаёт транспорт без signed URL: байты идут через сам API (см. Q2).
    return HttpResponse.json({ upload_id: uploadId })
  }),

  // Приём байтов. Реальный backend может заменить это на signed URL хранилища.
  http.post(route('/uploads/:uploadId/data'), () => new HttpResponse(null, { status: 204 })),

  http.post(route('/uploads/:uploadId/complete'), ({ params }) => {
    const unauthorized = requireSession()
    if (unauthorized) return unauthorized

    const upload = db.uploads.find((item) => item.upload_id === String(params.uploadId))
    if (!upload) return apiError(404, 'UPLOAD_NOT_FOUND', 'Upload not found')

    const archive = findById(upload.archive_id)
    if (!archive) return apiError(404, 'ARCHIVE_NOT_FOUND', 'Archive not found')

    const extension = extensionOf(upload.filename)

    if (extension === 'zip') {
      // ZIP распаковывает backend; для мока достаточно пары файлов внутри.
      const entries: PublicFileEntry[] = [
        {
          display_path: 'content/document-01.pdf',
          display_name: 'document-01.pdf',
          extension: 'pdf',
          mime_type: 'application/pdf',
          size_bytes: Math.round(upload.size_bytes * 0.6),
        },
        {
          display_path: 'content/document-02.pdf',
          display_name: 'document-02.pdf',
          extension: 'pdf',
          mime_type: 'application/pdf',
          size_bytes: Math.round(upload.size_bytes * 0.4),
        },
      ]
      archive.files.push(...entries)
    } else {
      archive.files.push({
        display_path: upload.filename,
        display_name: upload.filename,
        extension,
        mime_type: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
        size_bytes: upload.size_bytes,
      })
    }

    archive.file_count = archive.files.length
    archive.size_bytes = archive.files.reduce((sum, file) => sum + file.size_bytes, 0)

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

  http.post(route('/uploads/:uploadId/cancel'), ({ params }) => {
    const uploadId = String(params.uploadId)
    const upload = db.uploads.find((item) => item.upload_id === uploadId)

    db.uploads = db.uploads.filter((item) => item.upload_id !== uploadId)

    const archive = upload ? findById(upload.archive_id) : undefined
    if (archive?.technical_status === 'uploading') {
      archive.technical_status = archive.files.length > 0 ? 'ready' : 'draft'
    }

    return new HttpResponse(null, { status: 204 })
  }),
]
