import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Input,
  Modal,
  Textarea,
  Toggle,
} from '../ui'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import type { Category, CategoryInput } from '../../types'

export interface CategoryEditorProps {
  open: boolean
  onClose: () => void
  category: Category | null
  submitting: boolean
  error: string | null
  onSubmit: (payload: CategoryInput) => void
}

interface CategoryFormState {
  name: string
  description: string
  sortOrder: number
  isActive: boolean
}

export function CategoryEditor({
  open,
  onClose,
  category,
  submitting,
  error,
  onSubmit,
}: CategoryEditorProps) {
  const [form, setForm] = useState<CategoryFormState>(
    () => ({
      name: category?.name ?? '',
      description: category?.description ?? '',
      sortOrder: category?.sortOrder ?? 0,
      isActive: category?.isActive ?? true,
    }),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const submitGuard = useSubmitGuard(submitting)

  useEffect(() => {
    setForm({
      name: category?.name ?? '',
      description: category?.description ?? '',
      sortOrder: category?.sortOrder ?? 0,
      isActive: category?.isActive ?? true,
    })
    setFieldErrors({})
  }, [category?.id])

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = 'Enter a category name'
    if (form.sortOrder < 0) errors.sortOrder = 'Sort order must be zero or greater'
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
      description: form.description.trim() || undefined,
      sortOrder: form.sortOrder,
      isActive: form.isActive,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? `Edit ${category.name}` : 'Add category'}
      description={category ? 'Update category details.' : 'Create a new category for the question bank.'}
      size="sm"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="category-form"
            loading={submitting}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : category ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" title="Failed to save category">{error}</Alert>}

      <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Nursing"
          required
          error={fieldErrors.name}
          aria-invalid={!!fieldErrors.name}
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Short description of this category…"
          rows={2}
        />
        <Input
          label="Sort order"
          type="number"
          min={0}
          value={form.sortOrder}
          onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
          error={fieldErrors.sortOrder}
          aria-invalid={!!fieldErrors.sortOrder}
        />
        <Toggle
          checked={form.isActive}
          onChange={(next) => setForm((f) => ({ ...f, isActive: next }))}
          label="Active"
          description="Inactive categories are hidden from the question bank."
          disabled={submitting}
        />
      </form>
    </Modal>
  )
}