import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Modal,
  Select,
} from '../ui'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import type { Category, Subject, SubjectInput } from '../../types'

export interface SubjectEditorProps {
  open: boolean
  onClose: () => void
  subject: Subject | null
  categories: Category[]
  submitting: boolean
  error: string | null
  onSubmit: (payload: SubjectInput) => void
}

interface SubjectFormState {
  name: string
  categoryId: string
  code: string
  status: 'ACTIVE' | 'INACTIVE'
}

export function SubjectEditor({
  open,
  onClose,
  subject,
  categories,
  submitting,
  error,
  onSubmit,
}: SubjectEditorProps) {
  const [form, setForm] = useState<SubjectFormState>(
    () => ({
      name: subject?.name ?? '',
      categoryId: subject?.categoryId ?? categories[0]?.id ?? '',
      code: subject?.code ?? '',
      status: subject?.status ?? 'ACTIVE',
    }),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const submitGuard = useSubmitGuard(submitting)

  useEffect(() => {
    setForm({
      name: subject?.name ?? '',
      categoryId: subject?.categoryId ?? categories[0]?.id ?? '',
      code: subject?.code ?? '',
      status: subject?.status ?? 'ACTIVE',
    })
    setFieldErrors({})
  }, [subject?.id, categories])

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = 'Enter a subject name'
    if (!form.categoryId) errors.category = 'Select a category'
    return errors
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return
    const errors = validate()
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    onSubmit({
      name: form.name.trim(),
      categoryId: form.categoryId,
      code: form.code.trim() || undefined,
      status: form.status,
    })
  }

  const categoryOptions = [
    { value: '', label: 'Select a category' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject ? `Edit ${subject.name}` : 'Add subject'}
      description={subject ? 'Update subject details.' : 'Create a new subject under a category.'}
      size="sm"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="subject-form"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : subject ? 'Save changes' : 'Add subject'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" title="Failed to save subject">{error}</Alert>}

      <form id="subject-form" onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Category"
          value={form.categoryId}
          onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
          options={categoryOptions}
          required
          error={fieldErrors.category}
          aria-invalid={!!fieldErrors.category}
        />
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Human Anatomy & Physiology"
          required
          error={fieldErrors.name}
          aria-invalid={!!fieldErrors.name}
        />
        <Input
          label="Code"
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="e.g. NUR101"
        />
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'ACTIVE' | 'INACTIVE' }))}
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
          required
        />
      </form>
    </Modal>
  )
}