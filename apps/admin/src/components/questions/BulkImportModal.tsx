import { useMemo, useRef, useState } from 'react'
import { Download, PlusCircle, Upload } from 'lucide-react'
import Papa from 'papaparse'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FilterSelect,
  Modal,
} from '../ui'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import type { Category, Difficulty, QuestionStatus, QuestionType, Subject } from '../../types'

const UPLOAD_ZONE =
  'flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center transition-colors hover:border-[var(--cb-primary)] hover:bg-[var(--cb-primary-bg)]'

/** Column header aliases, lower-cased and de-spaced for matching. */
const ALIASES: Record<string, string> = {
  question: 'stem',
  questiontext: 'stem',
  question_text: 'stem',
  questiontype: 'type',
  question_type: 'type',
  categoryname: 'category',
  category_name: 'category',
  subjectname: 'subject',
  subject_name: 'subject',
  difficulty: 'difficulty',
  difficultylevel: 'difficulty',
  difficulty_level: 'difficulty',
  marks: 'points',
  status: 'status',
  questionstatus: 'status',
  question_status: 'status',
  answer: 'correctAnswer',
  solution: 'correctAnswer',
  rationale: 'explanation',
  explanationtext: 'explanation',
  explanation_text: 'explanation',
  taglist: 'tags',
  tag_list: 'tags',
}

function canonicalHeader(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '')
  return ALIASES[key] ?? key
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

/** Read an `options` value that is already a JSON array (JSON upload). */
function optionsFromArray(parsed: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((o, i) => ({
      label: String((o as { label?: string }).label ?? optionLabel(i)),
      text: String((o as { text?: string }).text ?? o),
    }))
    .filter((o) => o.text)
}

/**
 * Resolve options from either a JSON `options` value or `option_a/b/c` columns.
 *
 * A CSV cell always arrives as a string, so an `options` column in a CSV is
 * the JSON text `[{"label":"A","text":"..."}]` and is parsed here; a JSON
 * upload supplies the array directly. Returns `null` when an `options` value
 * is present but cannot be read, so the row reports a precise error.
 */
function getOptions(
  raw: Record<string, unknown>,
): Array<{ label: string; text: string }> | null {
  const value = raw.options
  if (Array.isArray(value)) return optionsFromArray(value)
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    try {
      return optionsFromArray(JSON.parse(String(value)))
    } catch {
      return null
    }
  }

  const optionKeys = Object.keys(raw).filter((k) => /^option[a-z]$/.test(canonicalHeader(k)))
  return optionKeys
    .map((k) => {
      const norm = canonicalHeader(k)
      const letter = norm.charAt(norm.length - 1).toUpperCase()
      return { letter, text: String(raw[k] ?? '').trim() }
    })
    .filter((o) => o.text)
    .sort((a, b) => a.letter.localeCompare(b.letter))
    .map((o) => ({ label: o.letter, text: o.text }))
}

interface ImportRow {
  stem: string
  type: string
  /** Resolved locally, or empty when the server will match/create by name. */
  categoryId: string
  subjectId: string
  difficulty: string
  points: number
  status: string
  correctAnswer: string
  explanation?: string
  tags?: string
  options?: Array<{ label: string; text: string }>
  categoryName: string
  subjectName: string
  /** True when the server is expected to create this taxonomy row. */
  willCreateCategory: boolean
  willCreateSubject: boolean
  error: string | null
}

interface BulkImportModalProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  subjects: Subject[]
  submitting: boolean
  error: string | null
  /**
   * Receives the validated rows plus the auto-create flag. Rows whose
   * category or subject was not resolved locally carry the raw name
   * instead of an id, and the server matches or creates it.
   */
  onImport: (records: Array<Record<string, unknown>>, autoCreateTaxonomy: boolean) => void
}

const VALID_TYPES: QuestionType[] = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']
const VALID_DIFFICULTIES: Difficulty[] = ['EASY', 'MEDIUM', 'HARD']
const VALID_STATUSES: QuestionStatus[] = ['ACTIVE', 'INACTIVE', 'DRAFT']

function validateRow(
  stem: string,
  type: string,
  difficulty: string,
  points: number,
  status: string,
  correctAnswer: string,
  options: Array<{ label: string; text: string }> | undefined,
): string | null {
  if (!stem) return 'Missing question text (stem)'
  if (!type) return 'Missing question type'
  if (!VALID_TYPES.includes(type as QuestionType)) return `Invalid type: ${type}`
  if (!VALID_DIFFICULTIES.includes(difficulty as Difficulty)) {
    return `Invalid difficulty: ${difficulty}`
  }
  if (points <= 0) return 'Points must be positive'
  if (!VALID_STATUSES.includes(status as QuestionStatus)) {
    return `Invalid status: ${status}`
  }
  if (!correctAnswer) return 'Missing correct answer'

  if (type === 'MULTIPLE_CHOICE') {
    if (!options || options.length < 2) return 'Multiple choice needs at least 2 options'
    if (!options.some((o) => o.label.toLowerCase() === correctAnswer.toLowerCase())) {
      return `Correct answer "${correctAnswer}" does not match any option label`
    }
  }
  if (type === 'TRUE_FALSE') {
    if (correctAnswer !== 'TRUE' && correctAnswer !== 'FALSE') {
      return 'TRUE_FALSE answer must be TRUE or FALSE'
    }
  }
  return null
}

/**
 * Normalise one parsed row.
 *
 * Category and subject are matched against the loaded hierarchy by id
 * or name. When auto-create is enabled, a name that matches nothing is
 * kept as a name and flagged `willCreate*` so the server creates the
 * course (category) and subject on import — a CSV from a new course
 * imports without manual taxonomy setup first.
 */
function normalizeRow(
  raw: Record<string, unknown>,
  categories: Category[],
  subjects: Subject[],
  autoCreate: boolean,
  defaults: { categoryId?: string; subjectId?: string },
): ImportRow {
  const row: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    row[canonicalHeader(k)] = String(v ?? '').trim()
  }

  const stem = row.stem || ''
  const type = row.type || ''
  const categoryRaw = row.category || ''
  const subjectRaw = row.subject || ''
  const difficulty = (row.difficulty || 'MEDIUM').toUpperCase()
  const points = Number(row.points || row.marks || 1)
  const status = (row.status || 'ACTIVE').toUpperCase()
  const correctAnswer = row.correctanswer || ''
  const explanation = row.explanation || undefined
  const tags = row.tags || undefined

  const category =
    categories.find((c) => c.id === categoryRaw) ??
    categories.find((c) => (c.name ?? '').toLowerCase() === categoryRaw.toLowerCase())
  const defaultCategory = defaults.categoryId
    ? categories.find((c) => c.id === defaults.categoryId)
    : undefined
  // An empty cell falls back to the default; a name that matches
  // nothing is created server-side when auto-create is on.
  const resolvedCategory = category ?? (categoryRaw ? undefined : defaultCategory)
  const willCreateCategory = autoCreate && !resolvedCategory && Boolean(categoryRaw)

  const subject =
    subjects.find((s) => s.id === subjectRaw) ??
    subjects.find((s) => (s.name ?? '').toLowerCase() === subjectRaw.toLowerCase())
  const defaultSubject = defaults.subjectId
    ? subjects.find((s) => s.id === defaults.subjectId)
    : undefined
  const resolvedSubject = subject ?? (subjectRaw ? undefined : defaultSubject)
  const willCreateSubject = autoCreate && !resolvedSubject && Boolean(subjectRaw)

  let taxonomyError: string | null = null
  if (!resolvedCategory && !willCreateCategory) {
    taxonomyError = categoryRaw ? 'Category not found' : 'Missing category'
  } else if (!resolvedSubject && !willCreateSubject) {
    taxonomyError = subjectRaw ? 'Subject not found' : 'Missing subject'
  }

  const parsedOptions = type === 'MULTIPLE_CHOICE' ? getOptions(raw) : undefined
  const options = parsedOptions ?? undefined
  const error =
    taxonomyError ??
    (parsedOptions === null
      ? 'The options column is not valid JSON — expected [{"label":"A","text":"..."}]'
      : null) ??
    validateRow(stem, type, difficulty, points, status, correctAnswer, options)

  return {
    stem,
    type,
    categoryId: resolvedCategory?.id ?? '',
    subjectId: resolvedSubject?.id ?? '',
    difficulty,
    points,
    status,
    correctAnswer,
    explanation,
    tags,
    options,
    categoryName: resolvedCategory?.name ?? (categoryRaw || '—'),
    subjectName: resolvedSubject?.name ?? (subjectRaw || '—'),
    willCreateCategory,
    willCreateSubject,
    error,
  }
}

const SAMPLE_CSV = [
  'stem,type,category,subject,difficulty,points,status,correctAnswer,explanation,tags,option_a,option_b,option_c,option_d',
  '"Which chamber pumps oxygenated blood?","MULTIPLE_CHOICE","Nursing","Human Anatomy & Physiology","MEDIUM",2,"ACTIVE","C","The left ventricle pumps to the aorta.","anatomy,exam","Right atrium","Right ventricle","Left atrium","Left ventricle"',
  '"Hand hygiene is required before every patient contact.","TRUE_FALSE","Nursing","Fundamentals of Nursing","EASY",1,"ACTIVE","TRUE","",""',
  '"The normal adult resting heart rate is:","MULTIPLE_CHOICE","Nursing","Medical Biochemistry","MEDIUM",1,"DRAFT","B","biochem","20-40 bpm","60-100 bpm","120-160 bpm","180-200 bpm"',
  '"Database primary key must be:","SHORT_ANSWER","Computing","Introduction to ICT","HARD",3,"ACTIVE","unique and non-null","",""',
].join('\n')

export function BulkImportModal({
  open,
  onClose,
  categories,
  subjects,
  submitting,
  error,
  onImport,
}: BulkImportModalProps) {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [fileName, setFileName] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [autoCreate, setAutoCreate] = useState(true)
  const [defaultCategoryId, setDefaultCategoryId] = useState('')
  const [defaultSubjectId, setDefaultSubjectId] = useState('')
  const submitGuard = useSubmitGuard(submitting)

  /** Raw parsed rows, kept so resolution settings can re-normalise them. */
  const lastParsed = useRef<Array<Record<string, unknown>> | null>(null)

  const validCount = useMemo(
    () => rows.filter((r) => !r.error).length,
    [rows]
  )
  const errorCount = rows.length - validCount
  const createdCount = useMemo(
    () => rows.filter((r) => !r.error && (r.willCreateCategory || r.willCreateSubject)).length,
    [rows]
  )

  /** Re-normalise the loaded rows whenever resolution settings change. */
  const renormalise = (
    data: Array<Record<string, unknown>>,
    nextAutoCreate: boolean,
    nextDefaults: { categoryId?: string; subjectId?: string },
  ) => {
    lastParsed.current = data
    setRows(data.map((r) => normalizeRow(r, categories, subjects, nextAutoCreate, nextDefaults)))
  }

  const handleFile = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setRows([])

    const lower = file.name.toLowerCase()
    const isCsv = lower.endsWith('.csv') || file.type === 'text/csv'
    const isJson = lower.endsWith('.json') || file.type === 'application/json'

    if (isCsv) {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.errors.length > 0) {
            setParseError(result.errors[0]?.message ?? 'CSV parse failed')
            return
          }
          const data = result.data.filter((r) => Object.keys(r).length > 0)
          if (data.length === 0) {
            setParseError('The file contains no data rows.')
            return
          }
          renormalise(data, autoCreate, {
            categoryId: defaultCategoryId || undefined,
            subjectId: defaultSubjectId || undefined,
          })
        },
        error: () => {
          setParseError('Could not read the file.')
        },
      })
    } else if (isJson) {
      file
        .text()
        .then((content) => {
          try {
            const parsed = JSON.parse(content)
            if (!Array.isArray(parsed)) {
              setParseError('JSON must be an array of question objects.')
              return
            }
            if (parsed.length === 0) {
              setParseError('The file contains no data rows.')
              return
            }
            renormalise(parsed as Array<Record<string, unknown>>, autoCreate, {
              categoryId: defaultCategoryId || undefined,
              subjectId: defaultSubjectId || undefined,
            })
          } catch {
            setParseError('Invalid JSON.')
          }
        })
        .catch(() => setParseError('Could not read the file.'))
    } else {
      setParseError('Unsupported file type. Use .csv or .json.')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    handleFile(e.dataTransfer.files?.[0])
  }

  const handleAutoCreateChange = (next: boolean) => {
    setAutoCreate(next)
    // Re-evaluate the loaded rows against the new setting so the
    // validation summary never disagrees with the submitted payload.
    if (rows.length > 0 && fileName) {
      const last = lastParsed.current
      if (last) renormalise(last, next, {
        categoryId: defaultCategoryId || undefined,
        subjectId: defaultSubjectId || undefined,
      })
    }
  }

  const handleDefaultCategoryChange = (value: string) => {
    setDefaultCategoryId(value)
    if (rows.length > 0 && fileName) {
      const last = lastParsed.current
      if (last) renormalise(last, autoCreate, {
        categoryId: value || undefined,
        subjectId: defaultSubjectId || undefined,
      })
    }
  }

  const handleDefaultSubjectChange = (value: string) => {
    setDefaultSubjectId(value)
    if (rows.length > 0 && fileName) {
      const last = lastParsed.current
      if (last) renormalise(last, autoCreate, {
        categoryId: defaultCategoryId || undefined,
        subjectId: value || undefined,
      })
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return
    const validRows = rows.filter((r) => !r.error)
    const records = validRows.map((r) => ({
      // An id wins when the row resolved locally; otherwise the raw
      // name is sent and the server matches or creates it.
      categoryId: r.categoryId || undefined,
      categoryName: r.categoryId ? undefined : r.categoryName,
      subjectId: r.subjectId || undefined,
      subjectName: r.subjectId ? undefined : r.subjectName,
      type: r.type,
      stem: r.stem,
      difficulty: r.difficulty,
      points: r.points,
      status: r.status,
      correctAnswer: r.correctAnswer,
      explanation: r.explanation,
      tags: r.tags,
      options: r.options,
    }))
    onImport(records, autoCreate)
  }

  const handleClose = () => {
    setRows([])
    setFileName('')
    setParseError(null)
    lastParsed.current = null
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk import questions"
      description="Upload a CSV or JSON file of questions. Category and subject columns are matched against the category hierarchy; unmatched names can be created automatically."
      size="xl"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="bulk-import-form"
            loading={submitting}
            disabled={submitting || validCount === 0}
            icon={<Upload className="h-4 w-4" />}
          >
            {submitting ? 'Importing…' : `Import ${validCount} question${validCount === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" title="Import failed">{error}</Alert>}

      <form id="bulk-import-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Upload file
          </label>
          <label
            htmlFor="file-input"
            className={UPLOAD_ZONE}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <Upload className="h-5 w-5 text-slate-400" />
            <div className="text-sm">
              <span className="font-medium text-[var(--cb-primary-deep)]">Upload a file</span>
              <span className="text-slate-500"> or drag and drop</span>
            </div>
            <p className="text-2xs text-slate-400">
              CSV or JSON · up to 500 rows
            </p>
          </label>
          <input
            id="file-input"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {fileName && (
            <p className="mt-1.5 text-2xs text-slate-500">
              Selected: {fileName}
            </p>
          )}
          {(parseError ?? error) && (
            <p className="mt-1.5 rounded-md bg-[var(--cb-primary-bg)] px-3 py-2 text-sm text-[var(--cb-primary-deep)]">
              {parseError ?? error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FilterSelect
            label="Default category (for rows with none)"
            value={defaultCategoryId}
            onChange={handleDefaultCategoryChange}
            options={[
              { value: '', label: 'None — use the row value' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <FilterSelect
            label="Default subject (for rows with none)"
            value={defaultSubjectId}
            onChange={handleDefaultSubjectChange}
            options={[
              { value: '', label: 'None — use the row value' },
              ...subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.categoryName})` })),
            ]}
          />
        </div>

        <Checkbox
          id="auto-create-taxonomy"
          checked={autoCreate}
          onChange={(e) => handleAutoCreateChange(e.target.checked)}
          label="Create missing categories and subjects automatically"
          description="A category or subject in the file that does not exist yet is created on import, so a CSV from a new course works without setting up the hierarchy first."
        />

        {rows.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={errorCount > 0 ? 'danger' : 'success'}>
                  {validCount} valid
                </Badge>
                {errorCount > 0 && <Badge tone="danger">{errorCount} invalid</Badge>}
                {createdCount > 0 && (
                  <Badge tone="brand">
                    <PlusCircle className="mr-1 h-3 w-3" aria-hidden />
                    {createdCount} new taxonomy
                  </Badge>
                )}
                <span className="text-2xs text-slate-500">
                  {rows.length} row{rows.length === 1 ? '' : 's'} total
                </span>
              </div>
            </div>

            <div className="max-h-64 overflow-auto rounded-md border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">#</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Question</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Type</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Category</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Subject</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Pts</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Status</th>
                    <th className="px-3 py-2 text-2xs font-semibold uppercase text-slate-500">Valid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className={row.error ? 'bg-red-50/30' : ''}>
                      <td className="px-3 py-1.5 tabular">{i + 1}</td>
                      <td className="max-w-[240px] px-3 py-1.5">
                        <p
                          className="line-clamp-2 text-slate-700"
                          title={row.stem}
                        >
                          {row.stem || <em className="text-slate-400">—</em>}
                        </p>
                      </td>
                      <td className="px-3 py-1.5">{row.type || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          {row.categoryName}
                          {row.willCreateCategory && (
                            <Badge tone="brand" dot={false}>new</Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1">
                          {row.subjectName}
                          {row.willCreateSubject && (
                            <Badge tone="brand" dot={false}>new</Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 tabular">{row.points}</td>
                      <td className="px-3 py-1.5">{row.status}</td>
                      <td className="px-3 py-1.5">
                        {row.error ? (
                          <Badge tone="danger" dot={false}>
                            Invalid
                          </Badge>
                        ) : (
                          <Badge tone="success" dot={false}>
                            OK
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {errorCount > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-2xs font-medium text-red-700">
                  Rows with errors are skipped during import.
                </p>
                <ul className="mt-1 space-y-0.5 text-2xs text-red-600">
                  {rows
                    .filter((r) => r.error)
                    .slice(0, 5)
                    .map((r, i) => (
                      <li key={i}>Row {rows.indexOf(r) + 1}: {r.error}</li>
                    ))}
                  {errorCount > 5 && <li>+ {errorCount - 5} more errors</li>}
                </ul>
              </div>
            )}
          </>
        )}

        {!rows.length && !parseError && (
          <details className="rounded-md border border-slate-200 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              Download a template CSV
            </summary>
            <p className="mt-2 text-2xs text-slate-500">
              Required columns: stem, type, category, subject. Optional: difficulty,
              points, status, correctAnswer, explanation, tags, and option_a through
              option_f for multiple choice. Multiple-choice options may also be a
              single JSON <code>options</code> column, e.g.{' '}
              <code>[{"{"}"label":"A","text":"Option A"{"}"}]</code>.
            </p>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = 'questions-template.csv'
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
              }}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Template
            </button>
          </details>
        )}
      </form>
    </Modal>
  )
}
