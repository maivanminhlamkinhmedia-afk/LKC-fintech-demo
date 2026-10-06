// Test-only MED-08/11 acceptance gate, shared with the isolated browser probe.
import { expect, type Page } from '@playwright/test'
import type { observeMediaSearch } from './media-search-observation'

type Observer = Awaited<ReturnType<typeof observeMediaSearch>>

export async function mediaSearchVisibleIds(page: Page): Promise<string[]> {
  return page.getByRole('list', { name: 'Danh sách ảnh' }).locator('li').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-media-id') ?? '').sort())
}

export async function assertMediaSearchGate(page: Page, observer: Observer,
  beforeIds: string[], expectedIds: string[], query: string) {
  const expected = [...expectedIds].sort()
  expect([...beforeIds].sort()).not.toEqual(expected)
  await expect.poll(() => observer.saw('CLICK_EVENT') && observer.saw('SUBMIT_EVENT')
    && observer.saw('ACTION_REQUEST') && observer.actionTransport() !== 'PENDING'
    && observer.saw('BUTTON_DISABLED') && observer.saw('BUTTON_REENABLED')).toBe(true)
  const transport = observer.actionTransport()
  expect(['FINISHED_2XX', 'ABORTED_AFTER_2XX']).toContain(transport)
  expect(observer.saw('ACTION_FAILED')).toBe(transport === 'ABORTED_AFTER_2XX')
  expect(observer.saw('NAVIGATION_REQUEST') || observer.saw('NAVIGATION_COMMIT')).toBe(false)
  await expect(page.locator('[data-error-code]')).toHaveCount(0)
  await expect(page.getByLabel('Tìm theo tên, alt hoặc chú thích')).toHaveValue(query)
  await expect(page.locator('section > p[role="status"]')).toHaveText(
    `${expected.length} ảnh trong phạm vi của bạn.`)
  await expect.poll(() => mediaSearchVisibleIds(page)).toEqual(expected)
}
