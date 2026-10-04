// Test-only, fixed-code observations. Browser data, URLs, query text and action
// payloads never cross this boundary.
import type { Frame, Page, Request, Response } from '@playwright/test'

export const MEDIA_SEARCH_SIGNALS = Object.freeze([
  'BUTTON_MISSING', 'BUTTON_HIDDEN', 'BUTTON_DISABLED', 'BUTTON_OUTSIDE_VIEWPORT', 'BUTTON_NO_HIT',
  'BUTTON_COVERED', 'BUTTON_READY',
  'CLICK_EVENT', 'SUBMIT_EVENT', 'BUTTON_REENABLED',
  'ACTION_REQUEST', 'ACTION_RESPONSE', 'ACTION_FINISHED', 'ACTION_FAILED',
  'NAVIGATION_REQUEST', 'NAVIGATION_RESPONSE', 'NAVIGATION_COMMIT',
])
const allowed = new Set(MEDIA_SEARCH_SIGNALS)
export const MEDIA_SEARCH_FAILURE_CODES = Object.freeze([
  'ABORTED', 'CONNECTION_RESET', 'CONNECTION_CLOSED', 'EMPTY_RESPONSE',
  'HTTP2_PROTOCOL_ERROR', 'NETWORK_CHANGED', 'TIMED_OUT', 'FAILED', 'OTHER',
])
const failureCodes = new Map([
  ['net::ERR_ABORTED', 'ABORTED'],
  ['net::ERR_CONNECTION_RESET', 'CONNECTION_RESET'],
  ['net::ERR_CONNECTION_CLOSED', 'CONNECTION_CLOSED'],
  ['net::ERR_EMPTY_RESPONSE', 'EMPTY_RESPONSE'],
  ['net::ERR_HTTP2_PROTOCOL_ERROR', 'HTTP2_PROTOCOL_ERROR'],
  ['net::ERR_NETWORK_CHANGED', 'NETWORK_CHANGED'],
  ['net::ERR_TIMED_OUT', 'TIMED_OUT'],
  ['net::ERR_FAILED', 'FAILED'],
])

export async function observeMediaSearch(page: Page,
  emit: (record: { signal: string; elapsedMs: number; httpStatus: number;
    requestOrdinal: number; failureCode: string | null }) => void) {
  const start = performance.now(), seen = new Set<string>()
  let actionRequests = 0, finishedAction = 0, requestOrdinal = 0
  const record = (signal: string, httpStatus = 0, ordinal = 0, failureCode: string | null = null) => {
    if (!allowed.has(signal) || !Number.isInteger(httpStatus) || httpStatus < 0 || httpStatus > 599) return
    seen.add(signal)
    emit({ signal, elapsedMs: Math.round(performance.now() - start), httpStatus,
      requestOrdinal: ordinal, failureCode })
  }
  const binding = '__cmsMediaSearchSignal'
  await page.exposeBinding(binding, (_source, signal: string) => record(signal))
  const requests = new WeakMap<Request, { kind: 'ACTION' | 'NAVIGATION'; ordinal: number; status: number }>()
  const classify = (request: Request): 'ACTION' | 'NAVIGATION' | null => {
    const path = new URL(request.url()).pathname
    if (path !== '/creator/media') return null
    if (request.method() === 'POST') return 'ACTION'
    return request.isNavigationRequest() ? 'NAVIGATION' : null
  }
  const onRequest = (request: Request) => {
    const kind = classify(request)
    if (!kind) return
    const ordinal = ++requestOrdinal
    if (kind === 'ACTION') actionRequests++
    requests.set(request, { kind, ordinal, status: 0 })
    record(`${kind}_REQUEST`, 0, ordinal)
  }
  const onResponse = (response: Response) => {
    const tracked = requests.get(response.request())
    if (tracked) {
      tracked.status = response.status()
      record(`${tracked.kind}_RESPONSE`, tracked.status, tracked.ordinal)
    }
  }
  const onFinished = (request: Request) => {
    const tracked = requests.get(request)
    if (tracked?.kind !== 'ACTION') return
    record('ACTION_FINISHED', 0, tracked.ordinal)
    if (tracked.status >= 200 && tracked.status < 300) finishedAction = tracked.ordinal
  }
  const onFailed = (request: Request) => {
    const tracked = requests.get(request)
    if (tracked?.kind === 'ACTION') record('ACTION_FAILED', 0, tracked.ordinal,
      failureCodes.get(request.failure()?.errorText ?? '') ?? 'OTHER')
  }
  const onNavigation = (frame: Frame) => { if (frame === page.mainFrame()) record('NAVIGATION_COMMIT') }
  page.on('request', onRequest); page.on('response', onResponse)
  page.on('requestfinished', onFinished); page.on('requestfailed', onFailed); page.on('framenavigated', onNavigation)
  const initial = await page.evaluate(bindingName => {
    const form = document.querySelector<HTMLFormElement>('form[aria-label="Tìm ảnh"]')
    const button = form?.querySelector<HTMLButtonElement>('button')
    if (!form || !button) return 'BUTTON_MISSING'
    const announce = (signal: string) => {
      void (window as unknown as Record<string, (code: string) => Promise<void>>)[bindingName](signal)
    }
    form.addEventListener('click', event => { if (event.target === button) announce('CLICK_EVENT') }, true)
    form.addEventListener('submit', () => announce('SUBMIT_EVENT'), true)
    let disabled = button.disabled
    const observer = new MutationObserver(() => {
      const current = form.querySelector<HTMLButtonElement>('button')
      if (!current) return
      if (current.disabled !== disabled) {
        disabled = current.disabled
        announce(disabled ? 'BUTTON_DISABLED' : 'BUTTON_REENABLED')
      }
    })
    observer.observe(form, { attributes: true, attributeFilter: ['disabled'], subtree: true, childList: true })
    ;(window as typeof window & { __cmsMediaSearchDisconnect?: () => void }).__cmsMediaSearchDisconnect = () => observer.disconnect()
    const rect = button.getBoundingClientRect(), style = getComputedStyle(button)
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return 'BUTTON_HIDDEN'
    if (button.disabled) return 'BUTTON_DISABLED'
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return 'BUTTON_OUTSIDE_VIEWPORT'
    const hit = document.elementFromPoint(x, y)
    if (!hit) return 'BUTTON_NO_HIT'
    return hit === button || button.contains(hit) ? 'BUTTON_READY' : 'BUTTON_COVERED'
  }, binding)
  record(initial)
  return {
    saw: (signal: string) => seen.has(signal),
    actionFinishedOk: () => actionRequests === 1 && finishedAction > 0,
    dispose: () => {
      page.off('request', onRequest); page.off('response', onResponse)
      page.off('requestfinished', onFinished); page.off('requestfailed', onFailed)
      page.off('framenavigated', onNavigation)
    },
  }
}
