import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  Button,
  Input,
  Modal,
  Select,
  Textarea,
} from '../ui'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import { toDecimalNumber } from '../../utils'
import type {
  Category,
  Difficulty,
  Question,
  QuestionInput,
  QuestionStatus,
  QuestionType,
  Subject,
} from '../../types'

const TYPE_OPTIONS = [
  { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { value: 'TRUE_FALSE', label: 'True / False' },
  { value: 'SHORT_ANSWER', label: 'Short Answer' },
]

const DIFFICULTY_OPTIONS = [
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
]

const STATUS_OPTIONS: Array<{ value: QuestionStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DRAFT', label: 'Draft' },
]

const TRUE_FALSE_OPTIONS = [
  { value: 'TRUE', label: 'True' },
  { value: 'FALSE', label: 'False' },
]

/** A single editable option row before labels are assigned. */
interface OptionDraft {
  text: string
}

interface QuestionFormState {
  categoryId: string
  subjectId: string
  type: QuestionType
  stem: string
  explanation: string
  difficulty: Difficulty
  points: number
  status: QuestionStatus
  tags: string
  /** Free-text option rows for MULTIPLE_CHOICE. Labels are assigned at submit time. */
  options: OptionDraft[]
  /** Index of the correct option for MULTIPLE_CHOICE, or -1 when none is selected. */
  correctOptionIndex: number
  /** TRUE / FALSE for TRUE_FALSE. */
  correctBool: '' | 'TRUE' | 'FALSE'
  /** Accepted answer text for SHORT_ANSWER. */
  correctText: string
}

interface QuestionEditorProps {
  open: boolean
  onClose: () => void
  question: Question | null
  categories: Category[]
  subjects: Subject[]
  submitting: boolean
  error: string | null
  onSubmit: (payload: QuestionInput) => void
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

function defaultForm(): QuestionFormState {
  return {
    categoryId: '',
    subjectId: '',
    type: 'MULTIPLE_CHOICE',
    stem: '',
    explanation: '',
    difficulty: 'MEDIUM',
    points: 1,
    status: 'ACTIVE',
    tags: '',
    options: [{ text: '' }, { text: '' }],
    correctOptionIndex: -1,
    correctBool: '',
    correctText: '',
  }
}

function fromQuestion(question: Question): QuestionFormState {
  const sortedOptions = question.options.slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const correctIndex = question.type === 'MULTIPLE_CHOICE'
    ? sortedOptions.findIndex((o) => o.label === question.correctAnswer)
    : -1

  return {
    categoryId: question.categoryId,
    subjectId: question.subjectId,
    type: question.type,
    stem: question.stem,
    explanation: question.explanation ?? '',
    difficulty: question.difficulty,
    points: toDecimalNumber(question.points) ?? 1,
    status: question.status,
    tags: question.tags ?? '',
    options: sortedOptions.map((o) => ({ text: o.text })),
    correctOptionIndex: correctIndex >= 0 ? correctIndex : -1,
    correctBool: question.type === 'TRUE_FALSE'
      ? (question.correctAnswer === 'TRUE' || question.correctAnswer === 'FALSE'
          ? question.correctAnswer
          : '')
      : '',
    correctText: question.type === 'SHORT_ANSWER' ? question.correctAnswer : '',
  }
}

function validate(state: QuestionFormState): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!state.categoryId) errors.category = 'Select a category'
  if (!state.subjectId) errors.subject = 'Select a subject'
  if (!state.stem.trim()) errors.stem = 'Enter the question text'
  if (state.points <= 0) errors.points = 'Must be greater than zero'

  if (state.type === 'MULTIPLE_CHOICE') {
    const filled = state.options.filter((o) => o.text.trim())
    if (filled.length < 2) errors.options = 'At least two options are required'
    else if (state.correctOptionIndex < 0) {
      errors.correctAnswer = 'Mark the correct option'
    }
  }
  if (state.type === 'TRUE_FALSE') {
    if (!state.correctBool) errors.correctAnswer = 'Select true or false'
  }
  if (state.type === 'SHORT_ANSWER') {
    if (!state.correctText.trim()) errors.correctAnswer = 'Enter the accepted answer'
  }
  return errors
}

function buildPayload(state: QuestionFormState): QuestionInput {
  const base = {
    categoryId: state.categoryId,
    subjectId: state.subjectId,
    stem: state.stem.trim(),
    explanation: state.explanation.trim() || undefined,
    difficulty: state.difficulty,
    points: state.points,
    status: state.status,
    tags: state.tags.trim() || undefined,
  }

  if (state.type === 'MULTIPLE_CHOICE') {
    const idx = state.correctOptionIndex >= 0 ? state.correctOptionIndex : 0
    return {
      ...base,
      type: 'MULTIPLE_CHOICE',
      options: state.options.map((opt, i) => ({
        label: optionLabel(i),
        text: opt.text.trim(),
      })),
      correctAnswer: optionLabel(idx),
    }
  }

  if (state.type === 'TRUE_FALSE') {
    return {
      ...base,
      type: 'TRUE_FALSE',
      correctAnswer: state.correctBool || 'TRUE',
    }
  }

  return {
    ...base,
    type: 'SHORT_ANSWER',
    correctAnswer: state.correctText.trim(),
  }
}

const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--cb-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--cb-primary)] disabled:cursor-not-allowed disabled:bg-slate-50'

export function QuestionEditor({
  open,
  onClose,
  question,
  categories,
  subjects,
  submitting,
  error,
  onSubmit,
}: QuestionEditorProps) {
  const [form, setForm] = useState<QuestionFormState>(() =>
    question ? fromQuestion(question) : defaultForm(),
  )
  const [seededKey, setSeededKey] = useState<string | null>(question?.id ?? null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const submitGuard = useSubmitGuard(submitting)

  const formKey = question?.id ?? 'new'
  useEffect(() => {
    if (formKey !== seededKey) {
      setSeededKey(formKey)
      setForm(question ? fromQuestion(question) : defaultForm())
      setFieldErrors({})
    }
  }, [formKey, seededKey, question])

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories],
  )

  const availableSubjects = useMemo(() => {
    if (!form.categoryId) return subjects
    return subjects.filter((s) => s.categoryId === form.categoryId)
  }, [form.categoryId, subjects])

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'Select a category' },
      ...activeCategories.map((c) => ({ value: c.id, label: c.name })),
    ],
    [activeCategories],
  )

  const subjectOptions = useMemo(
    () => [
      { value: '', label: form.categoryId ? 'Select a subject' : '—' },
      ...availableSubjects.map((s) => ({ value: s.id, label: s.name })),
    ],
    [availableSubjects, form.categoryId],
  )

  const updateOption = (index: number) => (value: string) =>
    setForm((f) => {
      const options = [...f.options]
      options[index] = { ...options[index], text: value }
      return { ...f, options }
    })

  const addOption = () => {
    setForm((f) => ({ ...f, options: [...f.options, { text: '' }] }))
  }

  const removeOption = (index: number) => {
    setForm((f) => ({
      ...f,
      options: f.options.filter((_, i) => i !== index),
      correctOptionIndex:
        f.correctOptionIndex === index
          ? -1
          : f.correctOptionIndex > index
            ? f.correctOptionIndex - 1
            : f.correctOptionIndex,
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return
    const errors = validate(form)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    onSubmit(buildPayload(form))
  }

  const handleCategoryChange = (value: string) => {
    setForm((f) => {
      const subjectStillValid =
        f.subjectId && subjects.some((s) => s.id === f.subjectId && s.categoryId === value)
      return {
        ...f,
        categoryId: value,
        subjectId: subjectStillValid ? f.subjectId : '',
      }
    })
  }

  const handleTypeChange = (value: string) => {
    setForm((f) => ({
      ...f,
      type: value as QuestionType,
      correctOptionIndex: -1,
      correctBool: '',
      correctText: '',
    }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={question ? `Edit ${question.stem.slice(0, 40)}` : 'Add question'}
      description={question ? 'Update question details and answer key.' : 'Create a new question for the bank.'}
      size="xl"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="question-form"
            loading={submitting}
            disabled={submitting}
            icon={<Plus className="h-4 w-4" />}
          >
            {submitting ? 'Saving…' : question ? 'Save changes' : 'Add question'}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" title="Failed to save question">{error}</Alert>}

      <form id="question-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Category → Subject (cascades like the Categories tab) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => handleCategoryChange(e.target.value)}
            options={categoryOptions}
            required
            error={fieldErrors.category}
            aria-invalid={!!fieldErrors.category}
          />
          <Select
            label="Subject"
            value={form.subjectId}
            onChange={(e) => setForm((f) => ({ ...f, subjectId: e.target.value }))}
            options={subjectOptions}
            required
            disabled={!form.categoryId}
            error={fieldErrors.subject}
            aria-invalid={!!fieldErrors.subject}
          />
        </div>

        {/* Type, Difficulty, Points, Status */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => handleTypeChange(e.target.value)}
            options={TYPE_OPTIONS}
            required
          />
          <Select
            label="Difficulty"
            value={form.difficulty}
            onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value as Difficulty }))}
            options={DIFFICULTY_OPTIONS}
            required
          />
          <Input
            label="Marks"
            type="number"
            min={0}
            step={0.5}
            value={form.points === 0 ? '' : String(form.points)}
            onChange={(e) => setForm((f) => ({ ...f, points: Number(e.target.value) || 0 }))}
            placeholder="1"
            error={fieldErrors.points}
            aria-invalid={!!fieldErrors.points}
            required
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as QuestionStatus }))}
            options={STATUS_OPTIONS}
            required
          />
        </div>

        {/* Stem */}
        <Textarea
          label="Question"
          value={form.stem}
          onChange={(e) => setForm((f) => ({ ...f, stem: e.target.value }))}
          placeholder="Enter the question text…"
          rows={3}
          required
          error={fieldErrors.stem}
          aria-invalid={!!fieldErrors.stem}
        />

        {/* Explanation */}
        <Textarea
          label="Explanation"
          value={form.explanation}
          onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
          placeholder="Why this answer is correct…"
          rows={2}
        />

        {/* Tags */}
        <Input
          label="Tags"
          value={form.tags}
          onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          placeholder="anatomy, exam (comma-separated)"
        />

        {/* Type-specific answer fields */}
        {form.type === 'MULTIPLE_CHOICE' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              Options <span className="text-red-600">*</span>
            </label>
            <div className="space-y-2">
              {form.options.map((opt, i) => {
                const label = optionLabel(i)
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-2xs font-semibold text-slate-600"
                    >
                      {label}
                    </span>
                    <input
                      type="text"
                      className={inputClass}
                      value={opt.text}
                      onChange={(e) => updateOption(i)(e.target.value)}
                      placeholder={`Option ${label}`}
                    />
                    <label className="mt-0.5 flex items-center gap-1">
                      <input
                        type="radio"
                        name="correctOption"
                        checked={form.correctOptionIndex === i}
                        onChange={() =>
                          setForm((f) => ({ ...f, correctOptionIndex: i }))
                        }
                        className="h-4 w-4 cursor-pointer text-[var(--cb-primary-deep)] focus:ring-[var(--cb-primary)]"
                      />
                      <span className="text-xs text-slate-600">Correct</span>
                    </label>
                    {form.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(i)}
                        aria-label={`Remove option ${label}`}
                        className="mt-0.5 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={addOption}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add option
            </button>

            {fieldErrors.options && (
              <p className="mt-1.5 text-2xs text-red-600">{fieldErrors.options}</p>
            )}
            {fieldErrors.correctAnswer && (
              <p className="mt-1.5 text-2xs text-red-600">{fieldErrors.correctAnswer}</p>
            )}
          </div>
        )}

        {form.type === 'TRUE_FALSE' && (
          <Select
            label="Correct answer"
            value={form.correctBool}
            onChange={(e) => setForm((f) => ({ ...f, correctBool: e.target.value as '' | 'TRUE' | 'FALSE' }))}
            options={TRUE_FALSE_OPTIONS}
            placeholder="Select…"
            required
            error={fieldErrors.correctAnswer}
            aria-invalid={!!fieldErrors.correctAnswer}
          />
        )}

        {form.type === 'SHORT_ANSWER' && (
          <Input
            label="Accepted answer"
            value={form.correctText}
            onChange={(e) => setForm((f) => ({ ...f, correctText: e.target.value }))}
            placeholder="The exact text students must enter…"
            required
            error={fieldErrors.correctAnswer}
            aria-invalid={!!fieldErrors.correctAnswer}
          />
        )}
      </form>
    </Modal>
  )
}
