import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FileFilterCallback } from 'multer'
import multer from 'multer'
import { env } from '../config/env.js'
import { ApiError } from '../utils/api-error.js'

/** Absolute directory uploaded files are written to. */
const UPLOAD_DIR = resolve(env.UPLOAD_DIR)
const MAX_FILE_SIZE = env.MAX_UPLOAD_SIZE_MB * 1024 * 1024

const ALLOWED_MIMETYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

/** Ensure the upload directory exists before the first write. */
export function ensureUploadDir(): void {
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir()
    cb(null, UPLOAD_DIR)
  },
  filename: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^./]+$/) ?? [''])[0].toLowerCase()
    cb(null, `${randomUUID()}${ext}`)
  },
})

/**
 * Multer middleware for a single logo image field named `logo`.
 *
 * Only image types are accepted, and files above `MAX_UPLOAD_SIZE_MB` are
 * rejected. Rejections surface as `ApiError` so the central error handler
 * turns them into consistent 4xx responses.
 */
export const uploadLogo = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const ext = (file.originalname.match(/\.[^./]+$/) ?? [''])[0].toLowerCase()
    const ok = ALLOWED_MIMETYPES.has(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)
    if (!ok) {
      return cb(
        new ApiError(
          415,
          'Unsupported file type. Upload a PNG, JPEG, WebP or GIF image.',
          'UNSUPPORTED_MEDIA_TYPE',
        ),
      )
    }
    cb(null, true)
  },
}).single('logo')

/** Public URL under which an uploaded file is served, relative to the API origin. */
export function uploadUrl(filename: string): string {
  return `/api/v1/uploads/${encodeURIComponent(filename)}`
}

/** Parse the filename stored at the end of a public upload URL, if any. */
export function filenameOf(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null
  try {
    const pathname = new URL(logoUrl, 'http://localhost').pathname
    const match = pathname.match(/\/uploads\/(.+)$/)
    const captured = match ? match[1] : null
    return captured ? decodeURIComponent(captured) : null
  } catch {
    return null
  }
}

/**
 * Delete the file referenced by a public upload URL, when it lives under the
 * upload directory. Best-effort: a missing file is not an error.
 *
 * The prefix guard prevents path traversal: only files inside UPLOAD_DIR can
 * ever be removed here.
 */
export function deleteUploadedFile(logoUrl: string | null | undefined): void {
  const filename = filenameOf(logoUrl)
  if (!filename) return

  const target = resolve(UPLOAD_DIR, filename)
  const prefix = UPLOAD_DIR.endsWith(sep) ? UPLOAD_DIR : `${UPLOAD_DIR}${sep}`
  if (!target.startsWith(prefix)) return

  try {
    if (existsSync(target)) unlinkSync(target)
  } catch {
    // Best-effort cleanup; a failed deletion must never fail a settings save.
  }
}
