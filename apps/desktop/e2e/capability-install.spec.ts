import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, type Page, test } from './test'

// These opt-in tests use the live public catalog and GitHub; only inference is
// mocked. Each app has an isolated Hermes home and installs into that home.
test.skip(process.env.HERMES_E2E_LIVE_CATALOG !== '1', 'Requires live catalog/GitHub access')

const pluginRepo = 'https://github.com/NousResearch/hermes-memory-wiki'
const pluginPin = '9bc3913b8474eaf4d7eec32e97af4d77957c36df'

const installedTabs = (page: Page) => page.locator('[data-capability-tabs]')

function verifyPlugin(home: string, expectedRevision?: string) {
  const directory = path.join(home, 'plugins', 'memory-wiki')
  expect(fs.existsSync(path.join(directory, 'plugin.yaml'))).toBe(true)
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim()
  expect(revision).toMatch(/^[a-f0-9]{40}$/)

  if (expectedRevision) {
    expect(revision).toBe(expectedRevision)
  }

  return directory
}

// Playwright requires an object-destructured fixture argument.
// eslint-disable-next-line no-empty-pattern
test('catalog cards install a skill and a pinned external plugin and retain them after reload', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = await setupMockBackend()
  const { page, sandbox } = fixture

  try {
    await waitForAppReady(fixture, 120_000)
    await page.getByText('Capabilities', { exact: true }).click()
    await installedTabs(page).getByRole('button', { name: 'Browse', exact: true }).click()
    await expect(page.locator('[data-catalog-card]').first()).toBeVisible({ timeout: 60_000 })

    const slider = page.getByRole('slider', { name: 'Choose category' })
    const top = (await slider.boundingBox())!.y
    const scroller = page.locator('[data-catalog-cards] .overflow-y-auto')
    await scroller.hover()
    await page.mouse.wheel(0, 500)
    await expect.poll(() => scroller.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    expect((await slider.boundingBox())!.y).toBe(top)

    const scrollbar = await scroller.evaluate(node => ({
      track: getComputedStyle(node, '::-webkit-scrollbar-track').backgroundColor,
      arrows: getComputedStyle(node, '::-webkit-scrollbar-button').display
    }))

    expect(scrollbar).toEqual({ track: 'rgba(0, 0, 0, 0)', arrows: 'none' })

    await page.getByRole('textbox', { name: 'Search skills', exact: true }).fill('decision-questionnaire')
    const skill = page.locator('[data-catalog-card]').filter({ has: page.getByRole('button', { name: 'decision-questionnaire', exact: true }) })
    await expect(skill).toHaveCount(1)
    await skill.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(skill.getByRole('button', { name: 'Installed', exact: true })).toBeVisible({ timeout: 60_000 })
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'skills/productivity/decision-questionnaire/SKILL.md'))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('skill-installed.png') })

    await page.getByText('Plugins', { exact: true }).click()
    await installedTabs(page).getByRole('button', { name: 'Browse', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search plugins', exact: true }).fill('hermes-memory-wiki')
    const plugin = page.locator('[data-catalog-card]').filter({ has: page.getByRole('button', { name: 'hermes-memory-wiki', exact: true }) })
    await expect(plugin).toHaveCount(1, { timeout: 60_000 })
    await plugin.getByRole('button', { name: 'Install', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('This package includes', { exact: true })).toBeVisible({ timeout: 60_000 })
    await dialog.getByRole('switch', { name: 'Enable agent plugin after install', exact: true }).uncheck()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 90_000 })
    await installedTabs(page).getByRole('button', { name: 'Installed', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search plugins', exact: true }).fill('memory-wiki')
    await expect(page.getByText('memory-wiki', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    const directory = verifyPlugin(sandbox.hermesHome)
    const sidecar = JSON.parse(fs.readFileSync(path.join(directory, '.hermes-catalog.json'), 'utf8'))
    expect(sidecar.catalog_name).toBe('hermes-memory-wiki')
    verifyPlugin(sandbox.hermesHome, sidecar.sha)
    await page.screenshot({ path: testInfo.outputPath('plugin-installed.png') })

    await page.reload()
    await page.getByText('Capabilities', { exact: true }).click({ timeout: 60_000 })
    await page.getByText('Plugins', { exact: true }).click()
    await installedTabs(page).getByRole('button', { name: 'Installed', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search plugins', exact: true }).fill('memory-wiki')
    await expect(page.getByText('memory-wiki', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await fixture.cleanup()
  }
})

// eslint-disable-next-line no-empty-pattern
test('Install from Git reviews and installs a repository at the requested commit', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = await setupMockBackend()
  const { page, sandbox } = fixture

  try {
    await waitForAppReady(fixture, 120_000)
    await page.getByText('Capabilities', { exact: true }).click()
    await page.getByText('Plugins', { exact: true }).click()
    await page.getByRole('button', { name: 'Install from Git', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Repository', exact: true }).fill(pluginRepo)
    await dialog.getByRole('button', { name: 'Review repository', exact: true }).click()
    await expect(dialog.getByText('This package includes', { exact: true })).toBeVisible({ timeout: 60_000 })
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'plugins/memory-wiki'))).toBe(false)
    await dialog.getByRole('textbox', { name: 'Pin to commit (optional)', exact: true }).fill(pluginPin)
    await dialog.getByRole('switch', { name: 'Enable agent plugin after install', exact: true }).uncheck()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(dialog).toHaveCount(0, { timeout: 90_000 })
    verifyPlugin(sandbox.hermesHome, pluginPin)
    await page.getByText('Capabilities', { exact: true }).click()
    await page.getByText('Plugins', { exact: true }).click()
    await installedTabs(page).getByRole('button', { name: 'Installed', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search plugins', exact: true }).fill('memory-wiki')
    await expect(page.getByText('memory-wiki', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: testInfo.outputPath('git-import-installed.png') })
  } finally {
    await fixture.cleanup()
  }
})
