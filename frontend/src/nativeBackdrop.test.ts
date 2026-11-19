import { Flags } from '@wailsio/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { markLiquidGlassWhenReady } from './nativeBackdrop'

vi.mock('@wailsio/runtime', () => ({
  Flags: { GetFlag: vi.fn() },
}))

const getFlag = vi.mocked(Flags.GetFlag)

describe('markLiquidGlassWhenReady', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.liquidGlass
    getFlag.mockReset()
  })

  it('marks the root when the flag is already set', () => {
    getFlag.mockReturnValue(true)

    markLiquidGlassWhenReady()

    expect(getFlag).toHaveBeenCalledWith('macLiquidGlass')
    expect(document.documentElement.dataset.liquidGlass).toBe('true')
  })

  it('marks the root once the runtime reports its config is ready', () => {
    getFlag.mockImplementation(() => {
      throw new Error('runtime not injected yet')
    })
    markLiquidGlassWhenReady()
    expect(document.documentElement.dataset.liquidGlass).toBeUndefined()

    getFlag.mockReturnValue(true)
    window.dispatchEvent(new Event('wails:runtime-config-ready'))

    expect(document.documentElement.dataset.liquidGlass).toBe('true')
  })

  it('leaves the page opaque when the flag is not enabled', () => {
    getFlag.mockReturnValue(undefined)

    markLiquidGlassWhenReady()
    window.dispatchEvent(new Event('wails:runtime-config-ready'))

    expect(document.documentElement.dataset.liquidGlass).toBeUndefined()
  })
})
