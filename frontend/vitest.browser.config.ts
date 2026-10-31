import { playwright } from '@vitest/browser-playwright'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['react-virtuoso'],
  },
  test: {
    include: ['src/App.browser.test.tsx'],
    browser: {
      commands: {
        async setReducedMotion({ page }, reduced: boolean) {
          await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
        },
      },
      enabled: true,
      headless: true,
      viewport: { width: 1100, height: 780 },
      provider: playwright(),
      instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
    },
  },
})