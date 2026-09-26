import type { ArticleDraftActionResult } from './article-draft-actions'
import {
  ArticleDraftError, canonicalizeArticleSlug, mapDraftError, normalizeCreateDraftInput,
  parseArticleId, parseExpectedUpdatedAt, type DraftFailure, type NormalizedDraftData,
} from './article-draft'

export const AUTOSAVE_DELAY_MS = 2000
export type DraftValues = Pick<NormalizedDraftData, 'title' | 'slug' | 'excerpt' | 'articleType' | 'contentJson'>
export type AutosavePhase = 'clean' | 'dirty' | 'saving' | 'offline' | 'validation-blocked' | 'conflict' | 'terminal' | 'uncertain' | 'leaving'
export type ArticleAutosaveState = Readonly<{
  phase: AutosavePhase; dirty: boolean; pending: boolean; error: DraftFailure | null; warning: string
}>
type Clock = { now(): number; setTimeout(callback: () => void, delay: number): unknown; clearTimeout(handle: unknown): void }
type Snapshot = { values: DraftValues; fingerprint: string; rawSlug: string }
type Options = {
  id: string; initial: DraftValues; updatedAt: string
  update(id: string, payload: DraftValues & { expectedUpdatedAt: string }): Promise<ArticleDraftActionResult>
  onCanonicalSlug?(from: string, to: string): void
  clock?: Clock
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child)
    Object.freeze(value)
  }
  return value
}

function snapshot(input: unknown): Snapshot {
  // Validation must precede any stringify or property read: never invoke an
  // untrusted getter/toJSON or erase a rejected value to manufacture valid JSON.
  const normalized = normalizeCreateDraftInput(input)
  const values = freezeJson({ title: normalized.title, slug: normalized.slug, excerpt: normalized.excerpt,
    articleType: normalized.articleType, contentJson: normalized.contentJson })
  const rawSlug = Object.getOwnPropertyDescriptor(input, 'slug')!.value as string
  return { values, fingerprint: JSON.stringify(values), rawSlug }
}

const failure = (code: DraftFailure['code']) => mapDraftError(new ArticleDraftError(code))

/** One update coordinator per persisted article, independent of React scheduling. */
export function createArticleAutosave(options: Options) {
  const clock: Clock = options.clock ?? {
    now: () => Date.now(), setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const listeners = new Set<(state: ArticleAutosaveState) => void>()
  let onCanonicalSlug = options.onCanonicalSlug
  let latest: Snapshot | null = null, confirmed: Snapshot | null = null
  let localError: DraftFailure | null = null, serverError: DraftFailure | null = null
  let barrier: 'conflict' | 'terminal' | 'uncertain' | null = null
  let blockedFingerprint: string | null = null, blockedSlug: string | null = null
  let token = options.updatedAt, warning = '', active = false, activated = false, left = false
  let online = true, composing = false, generation = 0, revision = 0, requestId = 0
  let deadline: number | null = null, timer: unknown, manualQueued = false
  let inFlight: { id: number; generation: number; revision: number; sent: Snapshot; promise: Promise<void> } | null = null
  try {
    parseArticleId(options.id)
    parseExpectedUpdatedAt(token)
    latest = confirmed = snapshot(options.initial)
  } catch {
    barrier = 'terminal'
    serverError = failure('UNSUPPORTED_DOCUMENT')
  }

  const blocked = () => !!latest && (latest.fingerprint === blockedFingerprint || latest.values.slug === blockedSlug)
  const dirty = () => !!inFlight || !!barrier || !latest || !confirmed || latest.fingerprint !== confirmed.fingerprint
  function state(): ArticleAutosaveState {
    const isDirty = dirty()
    const phase: AutosavePhase = left || (activated && !active) ? 'leaving' : barrier ?? (inFlight ? 'saving'
      : !isDirty ? 'clean' : localError || blocked() ? 'validation-blocked' : !online ? 'offline' : 'dirty')
    return Object.freeze({ phase, dirty: isDirty, pending: !!inFlight,
      error: barrier ? serverError : localError ?? (blocked() ? serverError : null), warning })
  }
  let cached = state()
  function publish() {
    const next = state()
    if (Object.keys(next).every(key => next[key as keyof ArticleAutosaveState] === cached[key as keyof ArticleAutosaveState])) return
    cached = next
    if (active) for (const listener of listeners) {
      // A UI observer cannot turn a known commit into an uncertain mutation.
      try { listener(cached) } catch { /* Observers do not own mutation state. */ }
    }
  }
  function cancelTimer() {
    if (timer !== undefined) clock.clearTimeout(timer)
    timer = undefined
  }
  function canDispatch(manual: boolean) {
    return active && !left && !inFlight && online && !composing && !!latest && !localError && dirty()
      && barrier !== 'conflict' && barrier !== 'terminal' && (manual || barrier !== 'uncertain' && !blocked())
  }
  function reconcile() {
    cancelTimer()
    if (!dirty()) deadline = null
    publish()
    if (!canDispatch(false)) return
    const delay = Math.max(0, (deadline ?? clock.now() + AUTOSAVE_DELAY_MS) - clock.now())
    timer = clock.setTimeout(() => { timer = undefined; void dispatch(false) }, delay)
  }
  function uncertain() {
    barrier = 'uncertain'
    serverError = failure('INTERNAL_ERROR')
    manualQueued = false
    cancelTimer()
  }
  async function dispatch(manual: boolean): Promise<void> {
    if (!canDispatch(manual) || !latest) { reconcile(); return }
    cancelTimer()
    manualQueued = false
    barrier = null
    serverError = null
    blockedFingerprint = blockedSlug = null
    const sent = latest
    const request = { id: ++requestId, generation, revision, sent, promise: Promise.resolve() }
    inFlight = request
    publish()
    request.promise = (async () => {
      try {
        const result = await options.update(options.id, Object.freeze({ ...sent.values, expectedUpdatedAt: token }))
        if (!active || left || request.generation !== generation) { uncertain(); return }
        if (result.ok) {
          const nextToken = parseExpectedUpdatedAt(result.data.updatedAt)
          if (result.data.id !== options.id || nextToken.getTime() <= parseExpectedUpdatedAt(token).getTime()
            || canonicalizeArticleSlug(result.data.slug) !== result.data.slug) throw new Error('Invalid acknowledgement')
          token = result.data.updatedAt
          confirmed = snapshot({ ...sent.values, slug: result.data.slug })
          warning = result.warning ?? ''
          if (latest?.rawSlug === sent.rawSlug) {
            const from = latest.rawSlug
            latest = snapshot({ ...latest.values, slug: result.data.slug })
            if (from !== result.data.slug) {
              try { onCanonicalSlug?.(from, result.data.slug) } catch { /* Do not retry a known commit. */ }
            }
          }
        } else {
          manualQueued = false
          serverError = result.error
          switch (result.error.code) {
            case 'VALIDATION_ERROR': blockedFingerprint = sent.fingerprint; break
            case 'SLUG_CONFLICT': blockedSlug = sent.values.slug; break
            case 'EDIT_CONFLICT': barrier = 'conflict'; break
            case 'FORBIDDEN': case 'NOT_FOUND': case 'NOT_EDITABLE': case 'UNSUPPORTED_DOCUMENT': barrier = 'terminal'; break
            default: uncertain()
          }
        }
      } catch {
        uncertain()
      } finally {
        if (inFlight === request) inFlight = null
        if (!active || left || request.generation !== generation) {
          manualQueued = false
          publish()
          return
        }
        const flush = manualQueued
        manualQueued = false
        publish()
        // An intent queued before an error must never bypass its recovery barrier.
        if (flush && !barrier && canDispatch(false)) void dispatch(true)
        else reconcile()
      }
    })()
    await request.promise
  }

  return {
    getState: () => cached,
    subscribe(listener: (state: ArticleAutosaveState) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    activate(canonicalSlugHandler = options.onCanonicalSlug) {
      if (active || left) return
      onCanonicalSlug = canonicalSlugHandler
      active = activated = true
      if (dirty() && !inFlight) deadline = clock.now() + AUTOSAVE_DELAY_MS
      const previous = cached
      reconcile()
      if (cached === previous) for (const listener of listeners) {
        try { listener(cached) } catch { /* Observers do not own mutation state. */ }
      }
    },
    deactivate() {
      if (!active) return
      active = false
      generation++
      manualQueued = false
      cancelTimer()
      publish()
    },
    leave() {
      left = true
      active = false
      generation++
      manualQueued = false
      cancelTimer()
      publish()
    },
    setValues(input: unknown) {
      if (left) return
      let next: Snapshot
      try { next = snapshot(input) } catch (error) {
        latest = null
        localError = mapDraftError(error)
        revision++
        deadline = clock.now() + AUTOSAVE_DELAY_MS
        reconcile()
        return
      }
      const changed = !latest || next.fingerprint !== latest.fingerprint
      latest = next
      localError = null
      if (changed) {
        revision++
        warning = ''
        deadline = clock.now() + AUTOSAVE_DELAY_MS
      }
      reconcile()
    },
    setOnline(value: boolean) {
      if (left || value === online) return
      online = value
      if (online) deadline = clock.now() + AUTOSAVE_DELAY_MS
      reconcile()
    },
    setComposing(value: boolean) {
      if (left || value === composing) return
      composing = value
      if (!composing) deadline = clock.now() + AUTOSAVE_DELAY_MS
      reconcile()
    },
    async manualSave() {
      if (!active || left || barrier === 'conflict' || barrier === 'terminal') return
      if (inFlight) {
        manualQueued = true
        publish()
        await inFlight.promise
        return
      }
      if (!online || composing) { reconcile(); return }
      await dispatch(true)
    },
    // An explicit navigation confirmation already accepted losing local work.
    // Do not raise a second native beforeunload prompt after disposal.
    shouldWarn: () => !left && (dirty() || manualQueued),
  }
}

export type ArticleAutosaveController = ReturnType<typeof createArticleAutosave>
