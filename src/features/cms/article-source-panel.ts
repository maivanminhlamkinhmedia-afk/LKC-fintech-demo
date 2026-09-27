import {
  ArticleSourceError, mapSourceError, sourceDateFromLocal, sourceDateToLocal,
  type ArticleSourcesSnapshot, type SourceActionResult, type SourceFailure, type SourceItem,
} from './article-sources'

export type SourceFormValues = {
  sourceType: SourceItem['sourceType']; title: string; publisher: string; url: string
  publishedAt: string; accessedAt: string; dataTimestamp: string; note: string
}
type SourceActions = {
  create: (articleId: string, input: unknown) => Promise<SourceActionResult>
  update: (articleId: string, sourceId: string, input: unknown) => Promise<SourceActionResult>
  remove: (articleId: string, sourceId: string, input: unknown) => Promise<SourceActionResult>
}
export type SourcePanelState = {
  snapshot: ArticleSourcesSnapshot; selected: string | null | undefined; values: SourceFormValues
  dirty: boolean; pending: boolean; blocked: boolean; leaving: boolean; online: boolean
  error: SourceFailure | null; warning: string; message: string
}
const empty = (): SourceFormValues => ({
  sourceType: 'WEBSITE', title: '', publisher: '', url: '', publishedAt: '', accessedAt: '', dataTimestamp: '', note: '',
})
const valuesFrom = (source: SourceItem): SourceFormValues => ({
  sourceType: source.sourceType, title: source.title, publisher: source.publisher ?? '', url: source.url ?? '',
  publishedAt: sourceDateToLocal(source.publishedAt), accessedAt: sourceDateToLocal(source.accessedAt),
  dataTimestamp: sourceDateToLocal(source.dataTimestamp), note: source.note ?? '',
})
const unknownResult: SourceFailure = {
  code: 'INTERNAL_ERROR', message: 'Chưa xác nhận được kết quả lưu. Tải lại để kiểm tra trước khi thực hiện lại.',
}
const discardQuestion = 'Bỏ thay đổi nguồn chưa lưu trong biểu mẫu này?'

// This controller schedules no work: only explicit save/remove dispatches a
// mutation. Article.updatedAt belongs to the snapshot being edited until ACK.
export function createSourcePanel(initial: ArticleSourcesSnapshot, actions: SourceActions) {
  let state: SourcePanelState = {
    snapshot: initial, selected: undefined, values: empty(), dirty: false, pending: false,
    blocked: false, leaving: false, online: true, error: null, warning: '', message: '',
  }
  let baseline = state.values
  let active = false
  let generation = 0
  const listeners = new Set<(value: SourcePanelState) => void>()
  const publish = (patch: Partial<SourcePanelState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }
  const mutable = () => active && state.snapshot.canMutate && !state.pending && !state.blocked && !state.leaving
  const select = (selected: string | null | undefined, values: SourceFormValues) => {
    baseline = values
    publish({ selected, values, dirty: false, error: null, warning: '', message: '' })
  }
  const canDiscard = (confirm: (question: string) => boolean) => !state.dirty || confirm(discardQuestion)

  async function dispatch(kind: 'save' | 'delete', sourceId?: string) {
    if (!mutable() || (kind === 'save' && state.selected === undefined)) return false
    if (!state.online) {
      publish({ message: 'Mất kết nối — nguồn chưa được lưu. Khi có mạng, hãy nhấn Lưu nguồn lại.' })
      return false
    }
    // Synchronous guard before preparation/action invocation prevents rapid
    // clicks, including add/update/delete competing in the same render.
    const requestGeneration = generation
    const snapshot = state.snapshot
    const selected = state.selected
    const values = { ...state.values }
    const token = snapshot.updatedAt
    publish({ pending: true, error: null, warning: '', message: 'Đang lưu nguồn…' })
    let dispatched = false
    try {
      const dateValue = (field: 'publishedAt' | 'accessedAt' | 'dataTimestamp') => {
        try { return sourceDateFromLocal(values[field]) }
        catch { throw new ArticleSourceError('VALIDATION_ERROR', field) }
      }
      const input = kind === 'delete' ? { expectedUpdatedAt: token } : {
        ...values, publishedAt: dateValue('publishedAt'),
        accessedAt: dateValue('accessedAt'), dataTimestamp: dateValue('dataTimestamp'),
        expectedUpdatedAt: token,
      }
      dispatched = true
      const result = await (kind === 'delete' ? actions.remove(snapshot.id, sourceId!, input)
        : selected ? actions.update(snapshot.id, selected, input) : actions.create(snapshot.id, input))
      if (!active || requestGeneration !== generation || state.leaving) return false
      if (!result.ok) {
        const retryable = result.error.code === 'VALIDATION_ERROR' || result.error.code === 'SOURCE_LIMIT_REACHED'
        publish({ error: result.error.code === 'INTERNAL_ERROR' ? unknownResult : result.error,
          blocked: !retryable, message: 'Nguồn chưa được xác nhận lưu.' })
        return false
      }
      // Only the ACK advances the list/token. No refresh-and-retry on failures.
      const newId = selected ?? result.data.sources.find(source => !snapshot.sources.some(old => old.id === source.id))?.id
      const saved = kind === 'save' ? result.data.sources.find(source => source.id === newId) : undefined
      const canonical = saved ? valuesFrom(saved) : empty()
      baseline = canonical
      publish({ snapshot: result.data, selected: saved?.id, values: canonical, dirty: false,
        error: null, warning: result.warning ?? '', message: kind === 'delete' ? 'Đã xóa nguồn.' : 'Đã lưu nguồn.' })
      return true
    } catch (error) {
      if (!active || requestGeneration !== generation || state.leaving) return false
      publish({ error: dispatched ? unknownResult : mapSourceError(error), blocked: dispatched,
        message: dispatched ? 'Nguồn chưa được xác nhận lưu.' : 'Kiểm tra thông tin nguồn trước khi lưu.' })
      return false
    } finally {
      if (active && requestGeneration === generation && !state.leaving) publish({ pending: false })
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (value: SourcePanelState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    activate() { active = true; generation++ },
    deactivate() { active = false; generation++ },
    setOnline(online: boolean) { publish({ online }) },
    setField<K extends keyof SourceFormValues>(key: K, value: SourceFormValues[K]) {
      if (!active || state.pending || state.leaving || state.selected === undefined) return
      const values = { ...state.values, [key]: value }
      const dirty = (Object.keys(values) as (keyof SourceFormValues)[]).some(field => values[field] !== baseline[field])
      publish({ values, dirty, message: '' })
    },
    add(confirm: (question: string) => boolean) {
      if (!mutable() || !canDiscard(confirm)) return false
      select(null, empty()); return true
    },
    edit(sourceId: string, confirm: (question: string) => boolean) {
      if (!mutable() || !canDiscard(confirm)) return false
      const source = state.snapshot.sources.find(item => item.id === sourceId)
      if (!source) return false
      select(source.id, valuesFrom(source)); return true
    },
    cancel(confirm: (question: string) => boolean) {
      if (!mutable() || !canDiscard(confirm)) return false
      select(undefined, empty()); return true
    },
    save: () => dispatch('save'),
    async remove(sourceId: string, confirm: (question: string) => boolean) {
      if (!mutable()) return false
      if (!state.online) {
        publish({ message: 'Mất kết nối — chưa thể xóa nguồn. Khi có mạng, hãy thực hiện lại.' })
        return false
      }
      if (!canDiscard(confirm)) return false
      const source = state.snapshot.sources.find(item => item.id === sourceId)
      if (!source || !confirm(`Xóa nguồn “${source.title}”? Thao tác này chỉ xóa nguồn tham khảo.`)) return false
      // An explicitly discarded form cannot have its token silently advanced
      // by a different source's delete ACK.
      select(undefined, empty())
      return dispatch('delete', source.id)
    },
    sync(snapshot: ArticleSourcesSnapshot) {
      if (snapshot.id !== state.snapshot.id || state.dirty || state.pending || state.blocked || state.leaving
        || snapshot.updatedAt < state.snapshot.updatedAt) return
      const selected = snapshot.canMutate && state.selected && snapshot.sources.find(source => source.id === state.selected)
      const values = selected ? valuesFrom(selected) : empty()
      baseline = values
      publish({ snapshot, values, selected: selected ? selected.id : snapshot.canMutate && state.selected === null ? null : undefined })
    },
    shouldWarn: () => !state.leaving && (state.dirty || state.pending || state.blocked),
    leave() { publish({ leaving: true }); generation++ },
  }
}
