import { normalizeTaxonomyInput, mapTaxonomyError, type TaxonomyFailure, type TaxonomyItem, type TaxonomyKind, type TaxonomyMutationResult, type TaxonomyPage, type TaxonomyResult, type TaxonomySearch } from './taxonomy'

export type TaxonomyForm = { name: string; slug: string; description: string; sortOrder: string; isActive: boolean; symbol: string; instrumentType: 'INDEX' | 'EQUITY' | 'FUTURE' | 'ETF' | 'FUND' | 'BOND' | 'COMMODITY' | 'FX' | 'CRYPTO' | 'OTHER'; exchange: string; countryCode: string; currency: string }
type Actions = { create(kind: TaxonomyKind, input: unknown): Promise<TaxonomyMutationResult>; update(kind: TaxonomyKind, id: string, input: unknown): Promise<TaxonomyMutationResult>; remove(kind: TaxonomyKind, id: string, input: unknown): Promise<TaxonomyMutationResult>; search(kind: TaxonomyKind, input: TaxonomySearch): Promise<TaxonomyResult<TaxonomyPage>> }
export type TaxonomyPanelState = { snapshot: TaxonomyPage; selected: TaxonomyItem | null | undefined; values: TaxonomyForm; dirty: boolean; pending: boolean; searching: boolean; blocked: boolean; online: boolean; leaving: boolean; error: TaxonomyFailure | null; message: string; warning: string }
const empty = (): TaxonomyForm => ({ name: '', slug: '', description: '', sortOrder: '0', isActive: true, symbol: '', instrumentType: 'EQUITY', exchange: '', countryCode: '', currency: '' })
const from = (item: TaxonomyItem): TaxonomyForm => ({ name: item.name, slug: item.slug ?? '', description: item.description ?? '', sortOrder: String(item.sortOrder ?? 0), isActive: item.isActive ?? true, symbol: item.symbol ?? '', instrumentType: item.instrumentType ?? 'EQUITY', exchange: item.exchange ?? '', countryCode: item.countryCode ?? '', currency: item.currency ?? '' })
const unknown: TaxonomyFailure = { code: 'INTERNAL_ERROR', message: 'Chưa xác nhận được kết quả lưu. Tải lại để kiểm tra trước khi thực hiện lại.' }

export function createTaxonomyPanel(initial: TaxonomyPage, actions: Actions) {
  let state: TaxonomyPanelState = { snapshot: initial, selected: undefined, values: empty(), dirty: false, pending: false, searching: false, blocked: false, online: true, leaving: false, error: null, message: '', warning: '' }
  let baseline = state.values, active = false, generation = 0, readGeneration = 0
  const listeners = new Set<(state: TaxonomyPanelState) => void>()
  const publish = (patch: Partial<TaxonomyPanelState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(state) }
  const mutable = () => active && !state.pending && !state.blocked && !state.leaving
  const select = (item: TaxonomyItem | null | undefined) => { const values = item ? from(item) : empty(); baseline = values; publish({ selected: item, values, dirty: false, searching: false, error: null, warning: '', message: '' }) }
  const discard = (confirm: (question: string) => boolean) => !state.dirty || confirm('Bỏ thay đổi danh mục chưa lưu?')
  async function read(kind: TaxonomyKind, search: TaxonomySearch, resetForm: boolean) {
    const instance = generation, request = ++readGeneration
    publish({ searching: true })
    try {
      const result = await actions.search(kind, search)
      if (!active || generation !== instance || request !== readGeneration || state.leaving) return false
      if (!result.ok) { publish({ error: result.error, blocked: state.blocked || result.error.code === 'FORBIDDEN' }); return false }
      publish({ snapshot: result.data })
      if (resetForm) select(undefined)
      return true
    } catch { if (active && generation === instance && request === readGeneration && !state.leaving) publish({ message: 'Chưa tải được danh sách. Hãy thử tìm lại.' }); return false }
    finally { if (active && generation === instance && request === readGeneration && !state.leaving) publish({ searching: false }) }
  }
  async function dispatch(operation: 'save' | 'delete', target?: TaxonomyItem) {
    if (!mutable() || (operation === 'save' && state.selected === undefined)) return false
    if (!state.online) { publish({ message: 'Mất kết nối — chưa gửi thay đổi. Khi có mạng, hãy lưu lại thủ công.' }); return false }
    const instance = generation, selected = target ?? state.selected, kind = state.snapshot.kind, values = { ...state.values }
    // Any earlier search snapshot is superseded by a write. It must not replace
    // the ACK's list or editing baseline when its response arrives later.
    readGeneration++
    publish({ pending: true, searching: false, error: null, warning: '', message: 'Đang lưu danh mục…' })
    let dispatched = false
    try {
      let input: unknown
      if (operation === 'delete') input = { expectedUpdatedAt: selected!.updatedAt }
      else {
        const metadata = { name: values.name }
        const activeFields = { ...metadata, isActive: values.isActive }
        const fields = kind === 'tag' ? metadata : kind === 'instrument' ? { ...activeFields, countryCode: values.countryCode, currency: values.currency }
          : kind === 'category' ? { ...activeFields, description: values.description, sortOrder: values.sortOrder.trim() === '' ? NaN : Number(values.sortOrder) } : { ...activeFields, description: values.description }
        input = { ...fields, ...(selected ? { expectedUpdatedAt: selected.updatedAt } : kind === 'instrument'
          ? { symbol: values.symbol, instrumentType: values.instrumentType, exchange: values.exchange } : { slug: values.slug }) }
        // Validate the prepared plain UI snapshot before dispatch; errors here
        // cannot be mistaken for a lost ACK or leave the panel locked.
        normalizeTaxonomyInput(kind, selected ? 'update' : 'create', input)
      }
      dispatched = true
      const result = await (operation === 'delete' ? actions.remove(kind, selected!.id, input) : selected ? actions.update(kind, selected.id, input) : actions.create(kind, input))
      if (!active || generation !== instance || state.leaving) return false
      if (!result.ok) {
        publish({ error: result.error.code === 'INTERNAL_ERROR' ? unknown : result.error,
          blocked: !['VALIDATION_ERROR', 'IDENTITY_CONFLICT', 'TAXONOMY_IN_USE'].includes(result.error.code), message: 'Thay đổi chưa được xác nhận lưu.' })
        return false
      }
      select(result.data.item ?? undefined)
      publish({ warning: result.warning ?? '', message: operation === 'delete' ? 'Đã xóa danh mục.' : 'Đã lưu danh mục.' })
      // A failed list read after a committed ACK is a read failure, never an
      // invitation to create the record again. The canonical item/token stays.
      void read(kind, { q: state.snapshot.q, page: state.snapshot.page, active: state.snapshot.active }, false)
      return true
    } catch (error) {
      if (active && generation === instance && !state.leaving) publish({ error: dispatched ? unknown : mapTaxonomyError(error), blocked: dispatched, message: dispatched ? 'Chưa xác nhận kết quả. Tải lại để đối chiếu.' : 'Kiểm tra thông tin trước khi lưu.' })
      return false
    } finally { if (active && generation === instance && !state.leaving) publish({ pending: false }) }
  }
  return {
    getState: () => state,
    subscribe(listener: (value: TaxonomyPanelState) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    activate() {
      active = true; generation++
      // A request from a previous effect lifetime may have committed. Its ACK
      // cannot enter this lifetime; recover explicitly instead of retrying it.
      if (state.pending) publish({ pending: false, blocked: true, error: unknown, message: 'Chưa xác nhận kết quả. Tải lại để đối chiếu.' })
      if (state.searching) publish({ searching: false })
    }, deactivate() { active = false; generation++; readGeneration++ },
    setOnline(online: boolean) { publish({ online }) },
    setField<K extends keyof TaxonomyForm>(field: K, value: TaxonomyForm[K]) {
      if (!active || state.pending || state.leaving || state.selected === undefined) return
      const values = { ...state.values, [field]: value }
      publish({ values, dirty: (Object.keys(values) as (keyof TaxonomyForm)[]).some(key => values[key] !== baseline[key]), message: '' })
    },
    add(confirm: (question: string) => boolean) { if (!mutable() || !discard(confirm)) return false; readGeneration++; select(null); return true },
    edit(id: string, confirm: (question: string) => boolean) { if (!mutable() || !discard(confirm)) return false; const item = state.snapshot.items.find(row => row.id === id); if (!item) return false; readGeneration++; select(item); return true },
    cancel(confirm: (question: string) => boolean) { if (!mutable() || !discard(confirm)) return false; readGeneration++; select(undefined); return true },
    save: () => dispatch('save'),
    remove(id: string, confirm: (question: string) => boolean) {
      if (!mutable() || !discard(confirm)) return Promise.resolve(false)
      const item = state.snapshot.items.find(row => row.id === id)
      if (!item || !confirm(`Xóa danh mục “${item.name}”? Chỉ danh mục chưa được bài viết sử dụng mới có thể xóa.`)) return Promise.resolve(false)
      // Preserve selected form on a rejected delete, including its baseline.
      return dispatch('delete', item)
    },
    search(kind: TaxonomyKind, search: TaxonomySearch, confirm: (question: string) => boolean) {
      if (!mutable() || !discard(confirm)) return Promise.resolve(false)
      // Confirmed search/tab navigation ends this form instance immediately,
      // so typing during a delayed read cannot later be silently discarded.
      select(undefined)
      return read(kind, search, false)
    },
    sync(snapshot: TaxonomyPage) {
      if (state.dirty || state.pending || state.blocked || state.leaving || state.searching || snapshot.kind !== state.snapshot.kind || snapshot.q !== state.snapshot.q || snapshot.page !== state.snapshot.page || snapshot.active !== state.snapshot.active) return
      if (snapshot.items.some(item => state.snapshot.items.some(old => old.id === item.id && old.updatedAt > item.updatedAt))) return
      if (state.selected) { const item = snapshot.items.find(row => row.id === state.selected!.id); if (!item || item.updatedAt < state.selected.updatedAt) return; select(item) }
      publish({ snapshot })
    },
    shouldWarn: () => !state.leaving && (state.dirty || state.pending || state.blocked),
    leave() { generation++; readGeneration++; publish({ leaving: true }) },
  }
}
