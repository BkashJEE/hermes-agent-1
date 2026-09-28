/**
 * E2E for the `/btw` side chat window.
 *
 * This is the one thing the unit tests cannot prove: that a real Electron
 * window actually opens, that the question reaches the REAL gateway's
 * `prompt.btw`, and that the `btw.complete` event finds its way back into the
 * window rather than the transcript. Everything between those two ends is
 * covered by `electron/side-chat.test.ts`, `src/store/side-chat.test.ts` and
 * `src/app/side-chat/side-chat-app.test.tsx`.
 *
 * Prerequisite: `npm run build` must have been run so dist/ exists.
 */

import { expect, test } from './test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { MOCK_REPLY } from '../../../tests-js/scripts/mock-server'

const QUESTION = 'which file was that error in?'

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  // Cold boot brings up a real `hermes serve` behind the mock provider, which
  // outruns the 90s default on a first run.
  test.setTimeout(240_000)
  fixture = await setupMockBackend()
  await waitForAppReady(fixture!, 180_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

/** The side chat renders in its own window, marked by `?win=side`. */
const sideChatWindow = (app: MockBackendFixture['app']) =>
  app.windows().find(window => window.url().includes('win=side'))

test.describe('/btw side chat', () => {
  test('opens a window carrying the question, answers there, and leaves the transcript alone', async () => {
    const { app, page } = fixture!

    // A side chat asks ABOUT a conversation, so there has to be one first.
    const composer = page.locator('[contenteditable="true"]').first()
    await composer.waitFor({ state: 'visible', timeout: 10_000 })
    await composer.click()
    await composer.type('Hello, can you hear me?', { delay: 20 })
    await page.keyboard.press('Enter')

    await page.waitForFunction(
      () => (document.body?.textContent ?? '').includes('Hello, can you hear me?'),
      undefined,
      { timeout: 60_000 },
    )

    await composer.click()
    await composer.type(`/btw ${QUESTION}`, { delay: 20 })
    await page.keyboard.press('Enter')

    // 1. A second OS window appears, rendering the side chat.
    await expect
      .poll(() => Boolean(sideChatWindow(app)), { timeout: 30_000 })
      .toBe(true)

    const sideChat = sideChatWindow(app)!

    // 2. It opens with the question already asked — the user types once.
    await expect(sideChat.getByText(QUESTION)).toBeVisible({ timeout: 15_000 })

    // 3. The answer arrives IN THE WINDOW. This is the whole round trip:
    //    window -> main -> renderer -> prompt.btw -> btw.complete -> window.
    await expect(sideChat.getByText('Thinking…')).toHaveCount(0, { timeout: 90_000 })
    await expect(sideChat.getByText(MOCK_REPLY)).toBeVisible()

    // 4. And the conversation it is an aside to never hears about it.
    const transcript = (await page.textContent('body')) ?? ''
    expect(transcript).not.toContain('[btw')
  })

  test('answers a follow-up typed in the window', async () => {
    const { app } = fixture!
    const sideChat = sideChatWindow(app)!

    const followUp = 'and what line was it on?'
    const input = sideChat.getByLabel('Ask a side question')

    await input.click()
    await input.fill(followUp)
    await sideChat.keyboard.press('Enter')

    await expect(sideChat.getByText(followUp)).toBeVisible({ timeout: 15_000 })
    await expect(sideChat.getByText('Thinking…')).toHaveCount(0, { timeout: 90_000 })
  })
})
