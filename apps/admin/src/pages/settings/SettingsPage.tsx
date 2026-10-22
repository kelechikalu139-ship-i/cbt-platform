import { Check, Database, RotateCcw, Save, Server, ShieldCheck, Upload, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  Alert,
  Badge,
  Button,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Toggle,
} from '../../components/ui'
import { systemApi } from '../../services'
import { applyBrandColor } from '../../utils/theme'
import { cn } from '../../utils'
import { useApiErrorMessage } from '../../hooks/useApiErrorMessage'
import type { BackupInfo, SystemSettings } from '../../types'

interface SettingsPageProps {
  settings: SystemSettings
  loading?: boolean
  saving?: boolean
  error?: string | null
  onRetry?: () => void
  onSave: (patch: Partial<SystemSettings>) => void
  onRestoreDefaults?: () => void
}

/**
 * System settings.
 *
 * Every field here is validated and stored on the server. Nothing that affects
 * examination integrity — session timeout, server port, backup path — is
 * resolved in the browser.
 */
export function SettingsPage({
  settings,
  loading = false,
  saving = false,
  error = null,
  onRetry,
  onSave,
  onRestoreDefaults,
}: SettingsPageProps) {
  const [form, setForm] = useState<SystemSettings>(settings)
  const [dirty, setDirty] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoErrorRaw, setLogoErrorRaw] = useState<unknown>(null)
  const logoError = useApiErrorMessage(logoErrorRaw)
  const [installationId, setInstallationId] = useState<string | null>(null)
  const [installationLoading, setInstallationLoading] = useState(false)
  const [copying, setCopying] = useState(false)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [backupCreating, setBackupCreating] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoreName, setRestoreName] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  // Reload the form when new data arrives, unless the administrator is editing.
  useEffect(() => {
    if (!dirty) setForm(settings)
  }, [settings, dirty])

  // Fetch the machine installation ID for the support / licensing row.
  useEffect(() => {
    setInstallationLoading(true)
    void systemApi
      .status()
      .then((status) => setInstallationId(status.installationId ?? null))
      .catch(() => setInstallationId(null))
      .finally(() => setInstallationLoading(false))
  }, [])

  // List available backups so the restore panel can offer them.
  useEffect(() => {
    setBackupsLoading(true)
    void systemApi
      .backups()
      .then((list) => setBackups(list))
      .catch(() => setBackups([]))
      .finally(() => setBackupsLoading(false))
  }, [])

  const update = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Settings" description="School identity, server and backup configuration." />
        <Panel>
          <ErrorState message={error} onRetry={onRetry} />
        </Panel>
      </div>
    )
  }

  if (loading && !settings) {
    return (
      <div className="space-y-5">
        <PageHeader title="Settings" description="School identity, server and backup configuration." />
        <Panel>
          <LoadingState label="Loading settings…" rows={6} />
        </Panel>
      </div>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave(form)
    setDirty(false)
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <PageHeader
        title="Settings"
        description="School identity, server behaviour and database backup configuration."
        meta={dirty ? <Badge tone="warning">Unsaved changes</Badge> : <Badge tone="neutral">All changes saved</Badge>}
        actions={
          <>
            {onRestoreDefaults && (
              <Button
                type="button"
                variant="outline"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={onRestoreDefaults}
              >
                Restore defaults
              </Button>
            )}
            <Button type="submit" icon={<Save className="h-4 w-4" />} loading={saving} disabled={!dirty}>
              Save settings
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Identity */}
        <Panel>
          <PanelHeader title="Institution" description="Shown on the student application and printed reports" />
          <PanelBody className="space-y-4">
            <Input
              label="Institution name"
              value={form.schoolName}
              onChange={(e) => update('schoolName', e.target.value)}
              required
            />
            <Input
              label="Short name"
              value={form.schoolShortName}
              onChange={(e) => update('schoolShortName', e.target.value)}
              hint="Used in headers and the browser tab title. Four to eight characters."
            />
            <div className="flex items-center gap-2">
              <Input
                label="Primary color"
                type="color"
                value={form.primaryColor ?? '#3463a6'}
                onChange={(e) => {
                  update('primaryColor', e.target.value)
                  applyBrandColor(e.target.value)
                }}
                hint="School brand color. Applied across the admin interface."
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  update('primaryColor', null)
                  applyBrandColor(null)
                }}
              >
                Default
              </Button>
            </div>
            <div className="space-y-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Logo</label>
              {form.logoUrl && (
                <div className="flex items-center gap-3">
                  <img
                    src={form.logoUrl}
                    alt="School logo"
                    className="h-10 w-auto rounded border border-slate-200 bg-slate-50"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => {
                      update('logoUrl', null)
                      setDirty(true)
                    }}
                  >
                    Remove
                  </Button>
                </div>
              )}
              <input
                accept="image/*"
                type="file"
                disabled={logoUploading}
                className="block w-full text-sm text-slate-700 file:mr-3 file:py-1.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[var(--cb-primary-bg)] file:text-[var(--cb-primary-deep)] hover:file:bg-[var(--cb-primary-a15)] disabled:file:bg-slate-200 disabled:file:text-slate-400 disabled:cursor-not-allowed"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setLogoUploading(true)
                  setLogoErrorRaw(null)
                  void systemApi
                    .uploadLogo(file)
                    .then(({ logoUrl }) => {
                      update('logoUrl', logoUrl)
                      setDirty(true)
                      e.target.value = ''
                      setLogoUploading(false)
                    })
                    .catch((received) => {
                      setLogoErrorRaw(received)
                      setLogoUploading(false)
                      e.target.value = ''
                    })
                }}
              />
              {logoError && <p className="mt-1 text-xs text-red-600">{logoError}</p>}
              {logoUploading && (
                <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <Upload className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden /> Uploading…
                </p>
              )}
            </div>
            <Select
              label="Default time zone"
              value={form.defaultTimezone}
              onChange={(e) => update('defaultTimezone', e.target.value)}
              options={[
                { value: 'Africa/Lagos', label: 'West Africa (WAT, UTC+1)' },
                { value: 'Africa/Nairobi', label: 'East Africa (EAT, UTC+3)' },
                { value: 'Africa/Johannesburg', label: 'South Africa (SAST, UTC+2)' },
                { value: 'UTC', label: 'UTC' },
              ]}
            />
          </PanelBody>
        </Panel>

        {/* Server */}
        <Panel>
          <PanelHeader title="Server" description="How this machine serves the network" />
          <PanelBody className="space-y-4">
            <Input
              label="Server port"
              type="number"
              min={1024}
              max={65535}
              value={form.serverPort}
              onChange={(e) => update('serverPort', Number(e.target.value))}
              hint="Changing the port restarts the service and changes every address candidates use."
            />
            <Input
              label="Session timeout (minutes)"
              type="number"
              min={5}
              max={480}
              value={form.sessionTimeoutMinutes}
              onChange={(e) => update('sessionTimeoutMinutes', Number(e.target.value))}
              hint="Administrators are signed out after this long without activity."
            />
            <div className="rounded-md border border-slate-200 px-3 py-2.5">
              <Toggle
                checked={form.startOnWindowsBoot}
                onChange={(v) => update('startOnWindowsBoot', v)}
                label="Start when Windows starts"
                description="Registers the CBT service to launch automatically at boot."
              />
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Toggle
                checked={form.maintenanceMode}
                onChange={(v) => update('maintenanceMode', v)}
                label="Maintenance mode"
                description="Blocks candidates from starting or resuming examinations while you work."
              />
              {form.maintenanceMode && (
                <p className="mt-2 text-2xs leading-relaxed text-amber-800">
                  Live sessions continue to run. Candidates already writing are unaffected.
                </p>
              )}
            </div>
          </PanelBody>
        </Panel>

        {/* Backup */}
        <Panel>
          <PanelHeader
            title="Backup and recovery"
            description="Database backups are written to the server PC"
            actions={
              <span className="flex items-center gap-1.5 text-2xs text-slate-400">
                <Database className="h-3.5 w-3.5" />
                MariaDB
              </span>
            }
          />
          <PanelBody className="space-y-4">
            <Input
              label="Backup location"
              value={form.backupPath}
              onChange={(e) => update('backupPath', e.target.value)}
              placeholder="C:\CBT\backups"
              hint="A folder on the server PC. Use a local disk — network shares are not recommended."
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Frequency (hours)"
                type="number"
                min={1}
                max={168}
                value={form.backupFrequencyHours}
                onChange={(e) => update('backupFrequencyHours', Number(e.target.value))}
              />
              <Input
                label="Keep for (days)"
                type="number"
                min={1}
                max={3650}
                value={form.backupRetentionDays}
                onChange={(e) => update('backupRetentionDays', Number(e.target.value))}
              />
            </div>
            <div className="rounded-md border border-slate-200 px-3 py-2.5">
              <Toggle
                checked={form.backupEnabled}
                onChange={(v) => update('backupEnabled', v)}
                label="Automatic backups"
                description="Runs on a schedule while the server is on."
              />
            </div>
            <Alert tone="info">
              Backup and restore arrive with Phase 15. Configuration is stored now so the schedule
              can be honoured as soon as the backup service exists.
            </Alert>
          </PanelBody>
        </Panel>

        {/* Maintenance summary */}
        <Panel>
          <PanelHeader title="Maintenance" description="Operations available on this installation" />
          <PanelBody className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setBackupCreating(true)
                void systemApi
                  .backup()
                  .then((created) => {
                    setBackups((prev) => [created, ...prev])
                  })
                  .catch(() => {
                    // The server reports the failure; show a generic message.
                  })
                  .finally(() => setBackupCreating(false))
              }}
              disabled={backupCreating}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left',
                backupCreating
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'border-slate-200 bg-white hover:bg-amber-50 cursor-pointer',
              )}
            >
              <Database
                aria-hidden
                className={cn(
                  'h-4 w-4 shrink-0',
                  backupCreating ? 'text-slate-400 animate-pulse' : 'text-slate-400',
                )}
              />
              <span className="flex-1 text-xs font-medium">
                {backupCreating ? 'Creating backup…' : 'Create database backup'}
              </span>
              <Badge tone="neutral" dot={false}>
                Phase 15
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!backups.length) return
                setRestoreName(backups[0].name)
                setConfirmRestore(true)
              }}
              disabled={backups.length === 0 || restoring}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left',
                restoring || backups.length === 0
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'border-slate-200 bg-white hover:bg-amber-50 cursor-pointer',
              )}
            >
              <RotateCcw
                aria-hidden
                className={cn(
                  'h-4 w-4 shrink-0',
                  restoring ? 'text-slate-400 animate-pulse' : 'text-slate-400',
                )}
              />
              <span className="flex-1 text-xs font-medium">
                {restoring ? 'Restoring…' : 'Restore from backup'}
              </span>
              <Badge tone="neutral" dot={false}>
                Phase 15
              </Badge>
            </button>
            <button
              type="button"
              onClick={() => setConfirmRestart(true)}
              disabled={restarting}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left',
                restarting
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'border-slate-200 bg-white hover:bg-amber-50 cursor-pointer',
              )}
            >
              <Server
                aria-hidden
                className={cn('h-4 w-4 shrink-0', restarting ? 'text-slate-400' : 'text-slate-400')}
              />
              <span className="flex-1 text-xs font-medium">
                {restarting ? 'Restarting…' : 'Restart the CBT service'}
              </span>
              <Badge tone="neutral" dot={false}>
                Phase 12
              </Badge>
            </button>

            {confirmRestart && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-900">
                  Restarting will stop the CBT server and disconnect every
                  candidate mid-attempt. The service starts again automatically
                  once the process exits.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmRestart(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setConfirmRestart(false)
                      setRestarting(true)
                      void systemApi.restartService().catch(() => {
                        // The server is shutting down, so the request fails —
                        // that is expected. The client will lose connection.
                      })
                    }}
                  >
                    Restart now
                  </Button>
                </div>
              </div>
            )}

            {confirmRestore && restoreName && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-900">
                  Restoring will replace every table with the backup from{' '}
                  <span className="font-mono text-amber-800">{restoreName}</span>. All current
                  data is lost and candidates are disconnected.
                </p>
                {backupsLoading && (
                  <p className="mt-1 text-xs text-amber-700">Loading backups…</p>
                )}
                {!backupsLoading && backups.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">No backups available.</p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={restoring}
                    onClick={() => setConfirmRestore(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={restoring}
                    onClick={() => {
                      setConfirmRestore(false)
                      setRestoring(true)
                      void systemApi
                        .restoreBackup(restoreName!)
                        .catch(() => {
                          // Server reports the failure.
                        })
                        .finally(() => setRestoring(false))
                    }}
                  >
                    Restore now
                  </Button>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (installationId) {
                  void navigator.clipboard.writeText(installationId)
                  setCopying(true)
                  setTimeout(() => setCopying(false), 1500)
                }
              }}
              disabled={installationLoading || !installationId}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left',
                installationLoading || !installationId
                  ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'border-slate-200 bg-white hover:bg-amber-50 cursor-pointer',
              )}
            >
              <ShieldCheck
                aria-hidden
                className={cn(
                  'h-4 w-4 shrink-0',
                  installationLoading ? 'text-slate-400 animate-pulse' : 'text-slate-400',
                )}
              />
              <span className="flex-1 text-xs font-medium">
                {installationLoading ? 'Loading…' : 'View installation ID'}
              </span>
              <Badge tone="neutral" dot={false}>
                Phase 13
              </Badge>
            </button>

            {installationId && copying && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium text-emerald-900">
                  Installation ID copied to clipboard.
                </p>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      {dirty && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-pop">
          <p className="flex items-center gap-2 text-xs text-slate-600">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            You have unsaved changes.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setForm(settings)
                setDirty(false)
              }}
            >
              Discard
            </Button>
            <Button type="submit" size="sm" loading={saving}>
              <Check className="h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
