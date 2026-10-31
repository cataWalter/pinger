import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'src/**/*.browser.test.tsx'],
  },
})
