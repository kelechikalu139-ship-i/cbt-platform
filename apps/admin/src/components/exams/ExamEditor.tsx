import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Layers, PlusCircle, Search, Trash2, Users } from 'lucide-react'
import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  FilterSelect,
  Input,
  Modal,
  Panel,
  PanelBody,
  Textarea,
  Toggle,
} from '../ui'
import { useSubmitGuard } from '../../hooks/useSubmitGuard'
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  STUDENT_LEVELS,
  type Category,
  type Difficulty,
  type Exam,
  type ExamInput,
  type QuestionType,
  type SchoolOptions,
  type Subject,
} from '../../types'
import { toDecimalNumber } from '../../utils'

const LEVELS = STUDENT_LEVELS as readonly number[]
const SEMESTERS = [1, 2, 3, 4, 5, 6] as const

/** A school's own values merged into the fixed catalogue, sorted. */
function withObserved(base: readonly number[], observed: number[] = []): string[] {
  return [...new Set([...base, ...observed])]
    .sort((a, b) => a - b)
    .map(String)
}

/** A server timestamp as a `datetime-local` input value. */
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export interface ExamEditorProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  subjects: Subject[]
  /** Distinct class names already in use by students. */
  classNames: string[]
  /**
   * The school's academic vocabulary — programmes, departments, classes,
   * levels and semesters — read from the register. Offered as suggestions
   * wherever the editor takes one of these values, so the choices match
   * the institution without hard-coding any school's structure.
   */
  schoolOptions?: SchoolOptions
  submitting: boolean
  error: string | null
  onSubmit: (payload: ExamInput) => void
  /**
   * The examination being edited. When set, the form is
   * prefilled and the paper keeps its attached questions
   * unless the selection is replaced — an update that sends
   * no question fields leaves the set untouched.
   */
  exam?: Exam | null
  /**
   * Values to seed a new examination with — used to
   * duplicate an existing paper. Create mode.
   */
  prefill?: Exam | null
}

type SourceMode = 'pool' | 'manual' | 'current'

/**
 * Create-examination dialog.
 *
 * A paper is defined by
 *  - who it is for: programme, level, semester and the specific
 *    class(es) it is set for, and
 *  - which questions it contains: either every eligible question
 *    from a chosen pool (category/subject, type, difficulty), an
 *    explicit list of question ids, or — when editing — the set
 *    already attached.
 *
 * The pool is resolved server-side at creation time, so questions
 * uploaded into a course are attached by picking that course here
 * — no id list to maintain by hand.
 */
export function ExamEditor({
  open,
  onClose,
  categories,
  subjects,
  classNames,
  schoolOptions,
  submitting,
  error,
  onSubmit,
  exam = null,
  prefill = null,
}: ExamEditorProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [program, setProgram] = useState('')
  const [department, setDepartment] = useState('')
  const [level, setLevel] = useState<number | ''>('')
  const [semester, setSemester] = useState<number | ''>('')
  const [session, setSession] = useState('')
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [customClass, setCustomClass] = useState('')

  const [sourceMode, setSourceMode] = useState<SourceMode>('pool')
  const [poolCategoryIds, setPoolCategoryIds] = useState<string[]>([])
  const [poolSubjectIds, setPoolSubjectIds] = useState<string[]>([])
  const [poolTypes, setPoolTypes] = useState<QuestionType[]>([])
  const [poolDifficulties, setPoolDifficulties] = useState<Difficulty[]>([])
  const [manualIds, setManualIds] = useState('')

  const [durationMinutes, setDurationMinutes] = useState(60)
  const [passPercentage, setPassPercentage] = useState(50)
  const [maxAttempts, setMaxAttempts] = useState(1)
  const [shuffleQuestions, setShuffleQuestions] = useState(true)
  const [shuffleOptions, setShuffleOptions] = useState(false)
  const [showResultImmediately, setShowResultImmediately] = useState(false)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')

  const [formError, setFormError] = useState<string | null>(null)
  const submitGuard = useSubmitGuard(submitting)

  // Pickers are seeded from the school's register, so the choices match
  // this institution — a nursing school sees "Nursing" and "Health
  // Sciences" here — while anything not yet registered can still be typed.
  const programOptions = schoolOptions?.programs ?? []
  const departmentOptions = schoolOptions?.departments ?? []
  const levelOptions = useMemo(
    () => withObserved(LEVELS, schoolOptions?.levels ?? []),
    [schoolOptions?.levels],
  )
  const semesterOptions = useMemo(
    () => withObserved(SEMESTERS, schoolOptions?.semesters ?? []),
    [schoolOptions?.semesters],
  )
  const allClassNames = useMemo(
    () =>
      [...new Set([...classNames, ...(schoolOptions?.classes ?? [])])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [classNames, schoolOptions],
  )

  useEffect(() => {
    if (!open) return
    const source = exam ?? prefill
    if (source) {
      // Editing keeps the attached questions unless the
      // selection is replaced; duplicating starts a new
      // paper, so its questions are picked again.
      setTitle(exam ? source.title : `${source.title} (copy)`)
      setDescription(source.description ?? '')
      setInstructions(source.instructions ?? '')
      setProgram(source.program ?? '')
      setDepartment(source.department ?? '')
      setLevel(source.level ?? '')
      setSemester(source.semester ?? '')
      setSession(source.session ?? '')
      setSelectedClasses(source.classes ?? [])
      setDurationMinutes(source.durationMinutes)
      setPassPercentage(toDecimalNumber(source.passPercentage) ?? 50)
      setMaxAttempts(source.maxAttempts)
      setShuffleQuestions(source.shuffleQuestions)
      setShuffleOptions(source.shuffleOptions)
      setShowResultImmediately(source.showResultImmediately)
      setStartAt(toDateTimeLocal(source.startAt))
      setEndAt(toDateTimeLocal(source.endAt))
    } else {
      setTitle('')
      setDescription('')
      setInstructions('')
      setProgram('')
      setDepartment('')
      setLevel('')
      setSemester('')
      setSession('')
      setSelectedClasses([])
      setDurationMinutes(60)
      setPassPercentage(50)
      setMaxAttempts(1)
      setShuffleQuestions(true)
      setShuffleOptions(false)
      setShowResultImmediately(false)
      setStartAt('')
      setEndAt('')
    }
    setCustomClass('')
    setPoolCategoryIds([])
    setPoolSubjectIds([])
    setPoolTypes([])
    setPoolDifficulties([])
    setManualIds('')
    setSourceMode(exam ? 'current' : 'pool')
    setFormError(null)
  }, [open, exam, prefill])

  const toggleIn = <T,>(list: T[], value: T, on: boolean): T[] =>
    on ? [...list, value] : list.filter((item) => item !== value)

  const addCustomClass = () => {
    const value = customClass.trim()
    if (!value) return
    if (!selectedClasses.includes(value)) {
      setSelectedClasses((prev) => [...prev, value])
    }
    setCustomClass('')
  }

  /** Estimate of how many questions the pool will attach. */
  const poolEstimate = useMemo(() => {
    const pool = subjects.filter((s) => {
      if (poolSubjectIds.length > 0) return poolSubjectIds.includes(s.id)
      if (poolCategoryIds.length > 0) return poolCategoryIds.includes(s.categoryId)
      return true
    })
    return pool.reduce((sum, s) => sum + (s.questionCount ?? 0), 0)
  }, [subjects, poolCategoryIds, poolSubjectIds])

  const poolHasCriteria =
    poolCategoryIds.length > 0 ||
    poolSubjectIds.length > 0 ||
    poolTypes.length > 0 ||
    poolDifficulties.length > 0

  const manualIdList = useMemo(
    () =>
      manualIds
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean),
    [manualIds],
  )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!submitGuard.begin()) return

    if (!title.trim()) {
      setFormError('Give the examination a title.')
      return
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
      setFormError('Duration must be at least one minute.')
      return
    }
    if (sourceMode === 'pool' && !poolHasCriteria) {
      setFormError(
        'Pick at least one category, subject, question type or difficulty so the paper has questions to draw from.',
      )
      return
    }
    if (sourceMode === 'manual' && manualIdList.length === 0) {
      setFormError('Enter at least one question id.')
      return
    }
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) {
      setFormError('The exam window must close after it opens.')
      return
    }

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      instructions: instructions.trim() || undefined,
      program: program.trim() || undefined,
      department: department.trim() || undefined,
      level,
      semester,
      session: session.trim() || undefined,
      classes: selectedClasses,
      durationMinutes,
      passPercentage,
      maxAttempts,
      shuffleQuestions,
      shuffleOptions,
      showResultImmediately,
      // "Keep current" sends no question field at all, so
      // the paper keeps the questions already attached.
      ...(sourceMode === 'pool'
        ? {
            questionFilter: {
              ...(poolCategoryIds.length > 0 ? { categoryIds: poolCategoryIds } : {}),
              ...(poolSubjectIds.length > 0 ? { subjectIds: poolSubjectIds } : {}),
              ...(poolTypes.length > 0 ? { types: poolTypes } : {}),
              ...(poolDifficulties.length > 0
                ? { difficulties: poolDifficulties }
                : {}),
            },
          }
        : sourceMode === 'manual'
          ? { questionIds: manualIdList }
          : {}),
      ...(startAt ? { startAt: new Date(startAt).toISOString() } : {}),
      ...(endAt ? { endAt: new Date(endAt).toISOString() } : {}),
    })
  }

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={exam ? 'Edit examination' : 'Create examination'}
      description={
        exam
          ? 'Change the title, the candidates it is for, the rules, or the question selection.'
          : 'Set the title, the classes and levels it is for, and where its questions come from.'
      }
      size="xl"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="exam-form"
            loading={submitting}
            icon={<ClipboardList className="h-4 w-4" />}
          >
            {submitting
              ? 'Saving…'
              : exam
                ? 'Save changes'
                : 'Create examination'}
          </Button>
        </>
      }
    >
      {(error || formError) && (
        <Alert
          tone="danger"
          title={exam ? 'Could not save the examination' : 'Could not create the examination'}
        >
          {formError ?? error}
        </Alert>
      )}

      <form id="exam-form" onSubmit={handleSubmit} className="space-y-5">
        <Panel>
          <PanelBody>
            <div className="space-y-4">
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Nursing Informatics — Semester 1 Exam"
                required
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Combobox
                  label="Programme"
                  value={program}
                  onChange={(e) => setProgram(e.target.value)}
                  options={programOptions}
                  placeholder="Pick or type, e.g. Nursing"
                />
                <Combobox
                  label="Department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  options={departmentOptions}
                  placeholder="Pick or type, e.g. Health Sciences"
                />
              </div>
              <Textarea
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
              <Textarea
                label="Instructions to candidates"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
              />
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelBody>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Users aria-hidden className="h-4 w-4 text-slate-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Candidates
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FilterSelect
                  label="Level"
                  value={level === '' ? '' : String(level)}
                  onChange={(v) => setLevel(v === '' ? '' : Number(v))}
                  options={[
                    { value: '', label: 'All levels' },
                    ...levelOptions.map((l) => ({ value: l, label: `${l} level` })),
                  ]}
                />
                <FilterSelect
                  label="Semester"
                  value={semester === '' ? '' : String(semester)}
                  onChange={(v) => setSemester(v === '' ? '' : Number(v))}
                  options={[
                    { value: '', label: 'All semesters' },
                    ...semesterOptions.map((s) => ({ value: s, label: `Semester ${s}` })),
                  ]}
                />
                <div className="sm:col-span-1">
                  <Combobox
                    label="Academic session"
                    value={session}
                    onChange={(e) => setSession(e.target.value)}
                    options={schoolOptions?.sessions ?? []}
                    placeholder="Pick or type, e.g. 2026/2027"
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 block text-xs font-medium text-slate-700">
                  Classes
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allClassNames.map((name) => {
                    const on = selectedClasses.includes(name)
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() =>
                          setSelectedClasses((prev) =>
                            on ? prev.filter((c) => c !== name) : [...prev, name],
                          )
                        }
                        aria-pressed={on}
                        className={
                          'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors ' +
                          (on
                            ? 'border-brand-500 bg-brand-50 text-brand-700'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
                        }
                      >
                        {name}
                      </button>
                    )
                  })}
                  {selectedClasses
                    .filter((name) => !allClassNames.includes(name))
                    .map((name) => (
                      <span
                        key={name}
                        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-brand-500 bg-brand-50 px-3 text-xs font-medium text-brand-700"
                      >
                        {name}
                        <button
                          type="button"
                          aria-label={`Remove class ${name}`}
                          onClick={() =>
                            setSelectedClasses((prev) => prev.filter((c) => c !== name))
                          }
                          className="text-brand-400 hover:text-brand-600"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      </span>
                    ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={customClass}
                    onChange={(e) => setCustomClass(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustomClass()
                      }
                    }}
                    placeholder="Add a class name, e.g. NMR 100 - A"
                    aria-label="Add a class name"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addCustomClass}
                    disabled={!customClass.trim()}
                    icon={<PlusCircle className="h-4 w-4" />}
                  >
                    Add
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  The examination is set for the selected classes
                  {level !== '' ? `, ${level} level` : ''}
                  {semester !== '' ? `, semester ${semester}` : ''}.
                  {selectedClasses.length === 0 &&
                    ' No classes selected — the paper is not tied to a specific class.'}
                </p>
              </div>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelBody>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Layers aria-hidden className="h-4 w-4 text-slate-400" />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Questions
                </h3>
                <div className="ml-auto flex rounded-md border border-slate-300 p-0.5">
                  {(
                    [
                      ...(exam
                        ? ([
                            {
                              value: 'current',
                              label: 'Keep current',
                              icon: ClipboardList,
                            },
                          ] as Array<{
                            value: SourceMode
                            label: string
                            icon: typeof Layers
                          }>)
                        : []),
                      { value: 'pool', label: 'From a pool', icon: Layers },
                      { value: 'manual', label: 'Pick by id', icon: Search },
                    ] as Array<{
                      value: SourceMode
                      label: string
                      icon: typeof Layers
                    }>
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSourceMode(option.value)}
                      aria-pressed={sourceMode === option.value}
                      className={
                        'inline-flex h-7 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors ' +
                        (sourceMode === option.value
                          ? 'bg-brand-600 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50')
                      }
                    >
                      <option.icon className="h-3.5 w-3.5" aria-hidden />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {sourceMode === 'current' ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                  The paper keeps the{' '}
                  {exam?.questionCount ?? exam?.attachedQuestions ?? 0} question(s)
                  already attached. Switch to a pool or pick by id to replace
                  the selection — saving replaces the whole set.
                </div>
              ) : sourceMode === 'pool' ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-700">
                      Categories (courses)
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {categories.map((category) => (
                        <Checkbox
                          key={category.id}
                          checked={poolCategoryIds.includes(category.id)}
                          onChange={(e) =>
                            setPoolCategoryIds((prev) =>
                              toggleIn(prev, category.id, e.target.checked),
                            )
                          }
                          label={category.name}
                          description={`${category.subjectCount} subject(s) · ${category.questionCount} question(s)`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-medium text-slate-700">
                      Subjects
                    </p>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {subjects.map((subject) => (
                        <Checkbox
                          key={subject.id}
                          checked={poolSubjectIds.includes(subject.id)}
                          onChange={(e) =>
                            setPoolSubjectIds((prev) =>
                              toggleIn(prev, subject.id, e.target.checked),
                            )
                          }
                          label={subject.name}
                          description={`${subject.categoryName} · ${subject.questionCount} question(s)`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-700">
                        Question types
                      </p>
                      <div className="space-y-1.5">
                        {QUESTION_TYPES.map((type) => (
                          <Checkbox
                            key={type}
                            checked={poolTypes.includes(type)}
                            onChange={(e) =>
                              setPoolTypes((prev) =>
                                toggleIn(prev, type, e.target.checked),
                              )
                            }
                            label={QUESTION_TYPE_LABELS[type]}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-700">
                        Difficulties
                      </p>
                      <div className="space-y-1.5">
                        {DIFFICULTIES.map((difficulty) => (
                          <Checkbox
                            key={difficulty}
                            checked={poolDifficulties.includes(difficulty)}
                            onChange={(e) =>
                              setPoolDifficulties((prev) =>
                                toggleIn(prev, difficulty, e.target.checked),
                              )
                            }
                            label={DIFFICULTY_LABELS[difficulty]}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {poolHasCriteria
                      ? `Every active question matching the selection is attached — about ${poolEstimate} question(s) from the current bank.`
                      : 'Select at least one category, subject, type or difficulty. Every active question that matches is attached to the paper.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    label="Question ids (comma-separated)"
                    value={manualIds}
                    onChange={(e) => setManualIds(e.target.value)}
                    rows={4}
                    placeholder="550e8400-e29b-41d4-a716-446655440000, 6ba7b810-9dad-11d1-80b4-00c04fd430c8"
                  />
                  <p className="text-xs text-slate-500">
                    {manualIdList.length} id(s) entered. Question ids are shown on
                    the Question Bank screen.
                  </p>
                </div>
              )}
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelBody>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  label="Duration (minutes)"
                  type="number"
                  min={1}
                  max={600}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  required
                />
                <Input
                  label="Pass mark (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={passPercentage}
                  onChange={(e) => setPassPercentage(Number(e.target.value))}
                  required
                />
                <Input
                  label="Attempts allowed"
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Opens"
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                />
                <Input
                  label="Closes"
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </div>
              <div className="divide-y divide-slate-100">
                <Toggle
                  checked={shuffleQuestions}
                  onChange={setShuffleQuestions}
                  label="Shuffle questions"
                  description="Each candidate sees the paper in a different order."
                />
                <Toggle
                  checked={shuffleOptions}
                  onChange={setShuffleOptions}
                  label="Shuffle options"
                  description="Option order is randomised per candidate."
                />
                <Toggle
                  checked={showResultImmediately}
                  onChange={setShowResultImmediately}
                  label="Show result immediately"
                  description="Candidates see their score on submission."
                />
              </div>
              <p className="text-2xs text-slate-400">
                {exam
                  ? 'Saving keeps the attached questions unless you replace the selection.'
                  : 'Created as a draft. Publish it when the paper is final — a draft can still be edited.'}
              </p>
            </div>
          </PanelBody>
        </Panel>
      </form>
    </Modal>
  )
}
