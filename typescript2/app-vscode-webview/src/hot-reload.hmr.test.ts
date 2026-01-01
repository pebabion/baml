import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { chromium, Browser, Page } from 'playwright'
import {
  startDevServer,
  startWasmWatcher,
  waitForWasmRebuild,
  getHotReloadSourcePath,
  editFile,
  restoreFile,
  DevServer,
  ProcessCleanup,
} from '../test-utils/hmr'
import { ChildProcess } from 'child_process'

/**
 * Wait for a text to be visible on the page
 */
async function waitForText(page: Page, text: string, timeoutMs = 30_000): Promise<void> {
  await page.waitForSelector(`text=${text}`, { timeout: timeoutMs, state: 'visible' })
}

/**
 * Check that a text is not visible on the page
 */
async function expectTextNotVisible(page: Page, text: string): Promise<void> {
  const locator = page.locator(`text=${text}`)
  const count = await locator.count()
  if (count > 0) {
    const isVisible = await locator.first().isVisible()
    if (isVisible) {
      throw new Error(`Expected text "${text}" to not be visible, but it is`)
    }
  }
}

describe('WASM Hot Reload', () => {
  let browser: Browser
  let page: Page
  let devServer: DevServer
  let wasmWatcher: ChildProcess
  let originalFileContent: string
  const cleanup = new ProcessCleanup()

  beforeAll(async () => {
    // Start browser
    browser = await chromium.launch({
      headless: true,
    })

    // Start Vite dev server
    devServer = await startDevServer()
    cleanup.add(devServer.proc)

    // Start WASM file watcher
    wasmWatcher = await startWasmWatcher()
    cleanup.add(wasmWatcher)

    // Give nodemon time to complete initial build if needed
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }, 90_000) // 90 second timeout for setup

  afterAll(async () => {
    // Restore file if it was modified
    if (originalFileContent) {
      const filePath = getHotReloadSourcePath()
      restoreFile(filePath, originalFileContent)
    }

    // Close browser
    await browser?.close()

    // Kill all processes
    await cleanup.cleanup()
  })

  afterEach(async () => {
    // Close page after each test
    await page?.close()
  })

  test('browser updates when Rust source changes', async () => {
    // Create a new page
    page = await browser.newPage()

    // Navigate to the dev server
    await page.goto(`http://localhost:${devServer.port}`)

    // Wait for the app to load and verify initial state
    // The text "injected-hot-reload4" should be visible somewhere in the page
    await waitForText(page, 'injected-hot-reload4')

    // Get the Rust source file path
    const filePath = getHotReloadSourcePath()

    // Edit the file to change the hot-reload marker
    const { original } = editFile(filePath, (content) =>
      content.replace('injected-hot-reload4', 'injected-hot-reload5')
    )
    originalFileContent = original

    // Wait for nodemon to detect the change and rebuild WASM
    await waitForWasmRebuild(wasmWatcher, 60_000)

    // Wait for Vite HMR to update the browser
    // The new text should appear without a full page reload
    await waitForText(page, 'injected-hot-reload5')

    // Verify the old text is gone
    await expectTextNotVisible(page, 'injected-hot-reload4')

    // Restore the original file content
    restoreFile(filePath, originalFileContent)
    originalFileContent = '' // Clear so afterAll doesn't restore again
  }, 120_000) // 2 minute timeout for the test

  test('multiple sequential hot reloads work correctly', async () => {
    page = await browser.newPage()
    await page.goto(`http://localhost:${devServer.port}`)

    // Verify initial state
    await waitForText(page, 'injected-hot-reload4')

    const filePath = getHotReloadSourcePath()

    // First change: 4 -> 5
    const { original } = editFile(filePath, (content) =>
      content.replace('injected-hot-reload4', 'injected-hot-reload5')
    )
    originalFileContent = original

    await waitForWasmRebuild(wasmWatcher, 60_000)
    await waitForText(page, 'injected-hot-reload5')

    // Second change: 5 -> 6
    editFile(filePath, (content) =>
      content.replace('injected-hot-reload5', 'injected-hot-reload6')
    )

    await waitForWasmRebuild(wasmWatcher, 60_000)
    await waitForText(page, 'injected-hot-reload6')

    // Restore original
    restoreFile(filePath, originalFileContent)
    originalFileContent = ''
  }, 180_000) // 3 minutes for multiple rebuilds
})
