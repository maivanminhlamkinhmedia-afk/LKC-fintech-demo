// Test-only, fixed-code observations. Browser data, URLs, query text and action
// payloads never cross this boundary.
import type { Frame, Page, Request, Response } from '@playwright/test'

export const MEDIA_SEARCH_SIGNALS = Object.freeze([
  'BUTTON_MISSING', 'BUTTON_HIDDEN', 'BUTTON_DISABLED', 'BUTTON_COVERED', 'BUTTON_READY',
  'CLICK_EVENT', 'SUBMIT_EVENT', 'BUTTON_REENABLED',
  'ACTION_REQUEST', 'ACTION_RESPONSE', 'ACTION_FAILED',
  'NAVIGATION_REQUEST', 'NAVIGATION_RESPONSE', 'NAVIGATION_COMMIT',
])
const allowed = new Set(MEDIA_SEARCH_SIGNALS)

export async function observeMediaSearch(page: Page,
  emit: (record: { signal: string; elapsedMs: number; httpStatus: number }) => void) {
  const start = performance.now(), seen = new Set<string>()
  let actionSucceeded = false
  const record = (signal: string, httpStatus = 0) => {
    if (!allowed.has(signal) || !Number.isInteger(httpStatus) || httpStatus < 0 || httpStatus > 599) return
    seen.add(signal)
    if (signal === 'ACTION_RESPONSE' && httpStatus >= 200 && httpStatus < 300) actionSucceeded = true
    emit({ signal, elapsedMs: Math.round(performance.now() - start), httpStatus })
  }
  const binding = '__cmsMediaSearchSignal'
  await page.exposeBinding(binding, (_source, signal: string) => record(signal))
  const requests = new WeakMap<Request, 'ACTION' | 'NAVIGATION'>()
  const classify = (request: Request): 'ACTION' | 'NAVIGATION' | null => {
    const path = new URL(request.url()).pathname
    if (path !== '/creator/media') return null
    if (request.method() === 'POST') return 'ACTION'
    return request.isNavigationRequest() ? 'NAVIGATION' : null
  }
  const onRequest = (request: Request) => {
    const kind = classify(request)
    if (!kind) return
    requests.set(request, kind)
    record(`${kind}_REQUEST`)
  }
  const onResponse = (response: Response) => {
    const kind = requests.get(response.request())
    if (kind) record(`${kind}_RESPONSE`, response.status())
  }
  const onFailed = (request: Request) => {
    const kind = requests.get(request)
    if (kind === 'ACTION') record('ACTION_FAILED')
  }
  const onNavigation = (frame: Frame) => { if (frame === page.mainFrame()) record('NAVIGATION_COMMIT') }
  page.on('request', onRequest); page.on('response', onResponse)
  page.on('requestfailed', onFailed); page.on('framenavigated', onNavigation)
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
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === button || button.contains(hit) ? 'BUTTON_READY' : 'BUTTON_COVERED'
  }, binding)
  record(initial)
  return {
    saw: (signal: string) => seen.has(signal),
    actionSucceeded: () => actionSucceeded,
    dispose: () => {
      page.off('request', onRequest); page.off('response', onResponse)
      page.off('requestfailed', onFailed); page.off('framenavigated', onNavigation)
    },
  }
}
