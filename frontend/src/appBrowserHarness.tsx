import { cleanup, render } from '@testing-library/react'
import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { afterEach } from 'vitest'
import { page } from 'vitest/browser'
import type {} from '@vitest/browser-playwright'
import App from './App'
import { ROOM_DRAFTS_STORAGE_KEY } from './roomDrafts'
import './style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    setReducedMotion(reduced: boolean): Promise<void>
  }
}

export function installAppBrowserCleanup() {
  afterEach(() => {
    cleanup()
    document.querySelectorAll('#root').forEach((root) => root.remove())
    window.localStorage.removeItem(ROOM_DRAFTS_STORAGE_KEY)
  })
}

export function renderApp(onRender?: ProfilerOnRenderCallback) {
  const container = document.createElement('div')
  container.id = 'root'
  document.body.append(container)
  return render(onRender ? <Profiler id="App" onRender={onRender}><App /></Profiler> : <App />, { container })
}

export async function settleSurfaces() {
  await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => { })))
}

export async function captureScreenshot(options: { path: string }) {
  await settleSurfaces()
  const engine = navigator.userAgent.includes('Chrome/') ? 'chromium' : 'webkit'
  // Infinite CSS animations (shimmers, spinners, typing dots) can keep the captured body unstable on slower CI runners.
  await page.screenshot({ path: options.path.replace('/ui/', `/ui/${engine}/`), animations: 'disabled' })
}

export function rgbHex(value: string) {
  return `#${value.match(/\d+/g)!.slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`
}
