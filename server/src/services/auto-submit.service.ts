import { prisma } from '../config/database.js'
import { logger } from '../config/logger.js'
import { forceFinalizeSession } from '../modules/portal/portal.service.js'

/** How often to scan for expired sessions, in milliseconds. */
const SCAN_INTERVAL_MS = 30_000

let timer: NodeJS.Timeout | null = null

/**
 * Find every IN_PROGRESS session whose `expiresAt` is in the past and
 * submit it automatically, grading whatever the candidate answered.
 *
 * Runs server-side so a student cannot avoid time expiry by closing
 * the browser or losing network mid-attempt.
 */
export async function autoSubmitExpiredSessions(): Promise<void> {
  const now = new Date()

  const expired = await prisma.examSession.findMany({
    where: {
      status: 'IN_PROGRESS',
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      exam: { select: { id: true, title: true } },
      student: { select: { id: true, studentId: true, firstName: true, lastName: true } },
      expiresAt: true,
    },
  })

  if (expired.length === 0) return

  logger.info({ count: expired.length, now: now.toISOString() }, 'auto-submitting expired sessions')

  for (const session of expired) {
    try {
      await forceFinalizeSession(session.id, 'AUTO_SUBMITTED')
      logger.info(
        {
          sessionId: session.id,
          examId: session.exam.id,
          studentId: session.student.studentId,
          expiredAt: session.expiresAt.toISOString(),
        },
        'session auto-submitted',
      )
    } catch (error) {
      logger.error(
        { err: error, sessionId: session.id },
        'failed to auto-submit session',
      )
    }
  }
}

/**
 * Start the background scheduler. Safe to call multiple times; a second
 * call is a no-op while the timer is already running.
 */
export function startAutoSubmitScheduler(): void {
  if (timer !== null) return

  // Run an immediate pass on boot so sessions that expired while the
  // server was down are closed on restart.
  void autoSubmitExpiredSessions()

  timer = setInterval(() => {
    void autoSubmitExpiredSessions()
  }, SCAN_INTERVAL_MS)

  timer.unref()

  logger.info({ intervalMs: SCAN_INTERVAL_MS }, 'auto-submit scheduler started')
}

/** Stop the background scheduler. Used during graceful shutdown. */
export function stopAutoSubmitScheduler(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
  logger.info('auto-submit scheduler stopped')
}
