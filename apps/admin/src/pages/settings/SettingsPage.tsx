import { Check, Database, RotateCcw, Save, Server, ShieldCheck } from 'lucide-react'
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
import type { SystemSettings } from '../../types'

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

  // Reload the form when new data arrives, unless the administrator is editing.
  useEffect(() => {
    if (!dirty) setForm(settings)
  }, [settings, dirty])

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
            <Input
              label="Logo URL"
              value={form.logoUrl ?? ''}
              onChange={(e) => update('logoUrl', e.target.value || null)}
              placeholder="Served by the CBT server"
              hint="Leave blank to use the default mark."
            />
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
            {[
              { icon: Database, label: 'Create database backup', detail: 'Phase 15' },
              { icon: RotateCcw, label: 'Restore from backup', detail: 'Phase 15' },
              { icon: Server, label: 'Restart the CBT service', detail: 'Phase 12' },
              { icon: ShieldCheck, label: 'View installation ID', detail: 'Phase 13' },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5"
              >
                <row.icon aria-hidden className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="flex-1 text-xs font-medium text-slate-700">{row.label}</span>
                <Badge tone="neutral" dot={false}>
                  {row.detail}
                </Badge>
              </div>
            ))}
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
