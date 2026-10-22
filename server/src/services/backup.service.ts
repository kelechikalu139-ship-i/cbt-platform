import { readdir, stat, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '../config/database.js'
import { logger } from '../config/logger.js'
import { env } from '../config/env.js'

/** One logical backup: a timestamped folder holding backup.json + manifest.json. */
export interface BackupInfo {
  /** Folder name (timestamp) inside the backup directory. */
  name: string
  /** Full path to the backup folder. */
  path: string
  /** When the backup was created, ISO-8601. */
  createdAt: string
  /** CBT server version that produced the backup. */
  appVersion: string
  /** Total bytes of all files in the backup folder. */
  sizeBytes: number
  /** Table name -> row count captured in the backup. */
  rowCounts: Record<string, number>
}

interface TableDump {
  name: string
  rows: Array<Record<string, unknown>>
}

/** How many rows to insert per INSERT statement when restoring. */
const INSERT_BATCH = 500

/** How long to keep backups when no retention is configured, in days. */
const DEFAULT_RETENTION_DAYS = 30

function nowIso(): string {
  return new Date().toISOString()
}

function timestampDirName(): string {
  return nowIso().replace(/[:\-.]/g, '')
}

/** Escape a single SQL value for interpolation into a restored INSERT. */
function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (value instanceof Date) return `'${value.toISOString()}'`
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

/** List every table in the connected database. */
async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, string>>>('SHOW TABLES')
  if (!rows || rows.length === 0) return []
  const key = Object.keys(rows[0]!)[0]!
  return rows.map((row) => row[key]!).filter(Boolean)
}

/** Dump every row of a table. */
async function dumpTable(name: string): Promise<TableDump> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM \`${name}\``,
  )
  return { name, rows }
}

/** Ensure a directory exists, creating parents as needed. */
async function ensureDir(dir: string): Promise<void> {
  try {
    await stat(dir)
  } catch {
    await mkdir(dir, { recursive: true })
  }
}

/** Read a JSON file, or throw a clear error if it is missing or malformed. */
async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

/**
 * Create a logical backup of every table into `backupDir/<timestamp>/`.
 *
 * Each table is exported as JSON, so the backup needs nothing but this server
 * (no mysqldump on the machine). The folder also carries a manifest so a later
 * restore knows exactly what was captured and when.
 */
export async function createBackup(backupDir: string): Promise<BackupInfo> {
  await ensureDir(backupDir)

  const name = timestampDirName()
  const backupPath = join(backupDir, name)
  await mkdir(backupPath, { recursive: true })

  const tableNames = await listTables()
  const dumps: TableDump[] = []
  const rowCounts: Record<string, number> = {}

  for (const table of tableNames) {
    const dump = await dumpTable(table)
    dumps.push(dump)
    rowCounts[table] = dump.rows.length
  }

  const createdAt = nowIso()
  const payload = {
    createdAt,
    appVersion: env.APP_VERSION,
    tables: Object.fromEntries(dumps.map((d) => [d.name, d.rows])),
  }

  await writeFile(join(backupPath, 'backup.json'), JSON.stringify(payload, null, 2))

  const manifest: Omit<BackupInfo, 'path'> = {
    name,
    createdAt,
    appVersion: payload.appVersion,
    sizeBytes: 0,
    rowCounts,
  }
  await writeFile(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const statResult = await stat(backupPath)
  const sizeBytes = statResult.size
  manifest.sizeBytes = sizeBytes
  await writeFile(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2))

  logger.info(
    { backup: name, tables: tableNames.length, rows: Object.values(rowCounts).reduce((a, b) => a + b, 0) },
    'database backup created',
  )

  return { ...manifest, path: backupPath }
}

/** List every backup folder in `backupDir`, newest first. */
export async function listBackups(backupDir: string): Promise<BackupInfo[]> {
  try {
    await stat(backupDir)
  } catch {
    return []
  }

  const entries = await readdir(backupDir, { withFileTypes: true })
  const backups: BackupInfo[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(backupDir, entry.name, 'manifest.json')
    let manifest
    try {
      manifest = await readJsonFile<Omit<BackupInfo, 'path'>>(manifestPath)
    } catch {
      // Folder without a manifest is not a backup we produced; skip it.
      continue
    }
    const statResult = await stat(join(backupDir, entry.name))
    backups.push({ ...manifest, sizeBytes: statResult.size, path: join(backupDir, entry.name) })
  }

  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return backups
}

/**
 * Restore a backup folder back into the database.
 *
 * Foreign-key checks are suspended for the duration so table order does not
 * matter, then every table is truncated and reloaded from the backup.
 * Restoring replaces all current data — there is no merge.
 */
export async function restoreBackup(backupDir: string, name: string): Promise<void> {
  const backupPath = join(backupDir, name)
  const manifest = await readJsonFile<{ createdAt: string; rowCounts: Record<string, number> }>(
    join(backupPath, 'manifest.json'),
  )
  const payload = await readJsonFile<{ tables: Record<string, Array<Record<string, unknown>>> }>(
    join(backupPath, 'backup.json'),
  )

  // Suspend referential integrity while we wipe and reload every table.
  await prisma.$queryRawUnsafe('SET FOREIGN_KEY_CHECKS=0')

  try {
    const tableNames = Object.keys(payload.tables)
    for (const table of tableNames) {
      await prisma.$queryRawUnsafe(`TRUNCATE \`${table}\``)
    }

    for (const table of tableNames) {
      const rows = payload.tables[table] ?? []
      if (!rows.length) continue

      for (let offset = 0; offset < rows.length; offset += INSERT_BATCH) {
        const batch = rows.slice(offset, offset + INSERT_BATCH)
        const columns = Object.keys(batch[0]!)
        const quotedColumns = columns.map((c) => `\`${c}\``).join(', ')
        const valuesSql = batch
          .map((row) => `(${columns.map((c) => sqlLiteral(row[c])).join(', ')})`)
          .join(', ')
        await prisma.$queryRawUnsafe(
          `INSERT INTO \`${table}\` (${quotedColumns}) VALUES ${valuesSql}`,
        )
      }
    }
  } finally {
    await prisma.$queryRawUnsafe('SET FOREIGN_KEY_CHECKS=1')
  }

  logger.info(
    { backup: name, tables: Object.keys(payload.tables).length, rows: manifest.rowCounts },
    'database backup restored',
  )
}

/**
 * Remove backup folders older than `retentionDays`. Returns how many were deleted.
 */
export async function pruneOldBackups(backupDir: string, retentionDays = DEFAULT_RETENTION_DAYS): Promise<number> {
  const backups = await listBackups(backupDir)
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let deleted = 0

  for (const backup of backups) {
    if (new Date(backup.createdAt).getTime() < cutoff) {
      try {
        await rm(join(backupDir, backup.name), { recursive: true, force: true })
        deleted++
        logger.info({ backup: backup.name }, 'expired backup removed')
      } catch (error) {
        logger.error({ err: error, backup: backup.name }, 'failed to remove expired backup')
      }
    }
  }

  return deleted
}

let backupTimer: NodeJS.Timeout | null = null

/**
 * Start the scheduled backup loop.
 *
 * Runs an immediate backup on start, then repeats every `intervalMs`. Safe to
 * call multiple times; a second call is a no-op while a timer is running.
 */
export function startBackupScheduler(backupDir: string, intervalMs: number): NodeJS.Timeout {
  if (backupTimer !== null) return backupTimer

  void (async () => {
    try { await createBackup(backupDir) } catch (error) {
      logger.error({ err: error }, 'scheduled backup failed')
    }
  })()

  backupTimer = setInterval(async () => {
    try { await createBackup(backupDir) } catch (error) {
      logger.error({ err: error }, 'scheduled backup failed')
    }
  }, intervalMs)

  backupTimer.unref()
  logger.info({ intervalMs, backupDir }, 'backup scheduler started')
  return backupTimer
}

/** Stop the scheduled backup loop. Used during graceful shutdown. */
export function stopBackupScheduler(): void {
  if (backupTimer === null) return
  clearInterval(backupTimer)
  backupTimer = null
  logger.info('backup scheduler stopped')
}
