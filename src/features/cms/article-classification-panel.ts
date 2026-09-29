import { ArticleClassificationError, mapClassificationError, normalizeClassificationInput, sameClassification, selectionFromSnapshot,
  type ArticleClassificationSnapshot, type ClassificationFailure, type ClassificationOptions, type ClassificationOptionsResult,
  type ClassificationResult, type ClassificationSelection } from './article-classification'
import type { TaxonomyKind, TaxonomyOption } from './taxonomy'

type Actions = {
  save: (id: string, input: unknown) => Promise<ClassificationResult>
  search: (id: string, kind: TaxonomyKind, input: unknown) => Promise<ClassificationOptionsResult>
}
export type ClassificationPanelState = {
  snapshot: ArticleClassificationSnapshot; values: ClassificationSelection; known: TaxonomyOption[]; primaryResolved: boolean
  dirty: boolean; pending: boolean; blocked: boolean; leaving: boolean; online: boolean
  error: ClassificationFailure | null; warning: string; message: string
  kind: TaxonomyKind; q: string; options: ClassificationOptions | null; searching: boolean; searchError: string
}
const unknownResult = () => mapClassificationError(new ArticleClassificationError('INTERNAL_ERROR'))
const knownFrom = (snapshot: ArticleClassificationSnapshot) => [snapshot.category, ...snapshot.topics, ...snapshot.tags, ...snapshot.instruments].filter((item): item is TaxonomyOption => item !== null)
const resolved = (snapshot: ArticleClassificationSnapshot) => snapshot.instruments.filter(item => item.isPrimary).length <= 1

export function createClassificationPanel(initial: ArticleClassificationSnapshot, actions: Actions) {
  let baseline = selectionFromSnapshot(initial)
  let state: ClassificationPanelState = { snapshot: initial, values: baseline, known: knownFrom(initial), primaryResolved: resolved(initial),
    dirty: false, pending: false, blocked: false, leaving: false, online: true, error: null, warning: '', message: '',
    kind: 'category', q: '', options: null, searching: false, searchError: '' }
  let active = false, generation = 0, searchGeneration = 0
  const listeners = new Set<(value: ClassificationPanelState) => void>()
  function publish(patch: Partial<ClassificationPanelState>) { state = { ...state, ...patch }; for (const listener of listeners) listener(state) }
  const mutable = () => active && state.snapshot.canMutate && !state.pending && !state.blocked && !state.leaving
  function remember(items: TaxonomyOption[]) {
    const combined = new Map(state.known.map(item => [`${item.kind}:${item.id}`, item]))
    for (const item of items) combined.set(`${item.kind}:${item.id}`, item)
    return [...combined.values()]
  }
  function change(values: ClassificationSelection, primaryResolved = state.primaryResolved) {
    publish({ values, primaryResolved, dirty: !sameClassification(values, baseline) || primaryResolved !== resolved(state.snapshot), message: '', error: null })
  }
  return {
    getState: () => state,
    subscribe(listener: (value: ClassificationPanelState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    activate() {
      active = true; generation++
      // StrictMode/reattachment cannot make an outstanding write eligible to retry.
      if (state.pending) publish({ pending: false, blocked: true, error: unknownResult() })
    },
    deactivate() { active = false; generation++; searchGeneration++ },
    setOnline(online: boolean) { publish({ online }) },
    choose(item: TaxonomyOption, checked: boolean) {
      if (!mutable()) return
      const values = { ...state.values }
      if (item.kind === 'category') values.categoryId = checked ? item.id : null
      else {
        const field = item.kind === 'topic' ? 'topicIds' : item.kind === 'tag' ? 'tagIds' : 'instrumentIds'
        values[field] = checked ? [...new Set([...values[field], item.id])].sort() : values[field].filter(id => id !== item.id)
        if (!checked && item.id === values.primaryInstrumentId) values.primaryInstrumentId = null
      }
      publish({ known: remember([item]) }); change(values)
    },
    primary(id: string | null) {
      if (!mutable() || (id !== null && !state.values.instrumentIds.includes(id))) return
      change({ ...state.values, primaryInstrumentId: id }, true)
    },
    cancel(confirm: (message: string) => boolean) {
      if (!mutable() || (state.dirty && !confirm('Bỏ lựa chọn phân loại chưa lưu?'))) return false
      publish({ values: baseline, primaryResolved: resolved(state.snapshot), dirty: false, error: null, message: '', warning: '' })
      return true
    },
    async search(kind: TaxonomyKind, q: string, page = 1) {
      if (!active || state.leaving) return false
      const request = ++searchGeneration, instance = generation
      publish({ kind, q, searching: true, searchError: '', options: null })
      try {
        const result = await actions.search(state.snapshot.id, kind, { q, page })
        if (!active || state.leaving || generation !== instance || request !== searchGeneration) return false
        if (!result.ok) { publish({ searchError: result.error.message }); return false }
        publish({ options: result.data, known: remember(result.data.items) })
        return true
      } catch {
        if (active && !state.leaving && generation === instance && request === searchGeneration) publish({ searchError: 'Không thể tải danh mục. Lựa chọn đang nhập vẫn được giữ.' })
        return false
      } finally {
        if (active && !state.leaving && generation === instance && request === searchGeneration) publish({ searching: false })
      }
    },
    async save() {
      if (!mutable()) return false
      if (!state.online) { publish({ message: 'Mất kết nối — phân loại chưa được lưu. Khi có mạng, hãy nhấn Lưu phân loại lại.' }); return false }
      const instance = generation, snapshot = state.snapshot
      let dispatched = false
      publish({ pending: true, error: null, warning: '', message: 'Đang lưu phân loại…' })
      try {
        if (!state.primaryResolved) throw new ArticleClassificationError('VALIDATION_ERROR', 'primaryInstrumentId')
        const { selection } = normalizeClassificationInput({ ...state.values, expectedUpdatedAt: snapshot.updatedAt })
        // The validated copy owns new arrays; later UI/search activity cannot change this request.
        const input = { ...selection, expectedUpdatedAt: snapshot.updatedAt }
        dispatched = true
        const result = await actions.save(snapshot.id, input)
        if (!active || state.leaving || generation !== instance) return false
        if (!result.ok) {
          const retryable = ['VALIDATION_ERROR', 'INVALID_SELECTION'].includes(result.error.code)
          publish({ error: result.error.code === 'INTERNAL_ERROR' ? unknownResult() : result.error, blocked: !retryable, message: 'Phân loại chưa được xác nhận lưu.' })
          return false
        }
        baseline = selectionFromSnapshot(result.data)
        publish({ snapshot: result.data, values: baseline, known: remember(knownFrom(result.data)), primaryResolved: resolved(result.data), dirty: false,
          warning: result.warning ?? '', message: 'Đã lưu phân loại.', error: null })
        return true
      } catch (error) {
        if (!active || state.leaving || generation !== instance) return false
        publish({ error: dispatched ? unknownResult() : mapClassificationError(error), blocked: dispatched,
          message: dispatched ? 'Phân loại chưa được xác nhận lưu.' : 'Kiểm tra lựa chọn trước khi lưu.' })
        return false
      } finally { if (active && !state.leaving && generation === instance) publish({ pending: false }) }
    },
    sync(snapshot: ArticleClassificationSnapshot) {
      if (snapshot.id !== state.snapshot.id || state.dirty || state.pending || state.blocked || state.leaving || snapshot.updatedAt < state.snapshot.updatedAt) return
      baseline = selectionFromSnapshot(snapshot)
      publish({ snapshot, values: baseline, known: remember(knownFrom(snapshot)), primaryResolved: resolved(snapshot) })
    },
    shouldWarn: () => !state.leaving && (state.dirty || state.pending || state.blocked),
    leave() { publish({ leaving: true }); generation++; searchGeneration++ },
  }
}
