import { Flags } from '@wailsio/runtime'

const runtimeConfigReadyEvent = 'wails:runtime-config-ready'

function isMacLiquidGlassEnabled(): boolean {
  try {
    return Flags.GetFlag('macLiquidGlass') === true
  } catch {
    return false
  }
}

// On macOS the Wails runtime injects its flags after the page starts loading, so the flag is read again once the runtime reports its config is ready. Outside Wails the flag never appears and the page keeps its opaque background.
export function markLiquidGlassWhenReady(): void {
  const mark = (): boolean => {
    if (!isMacLiquidGlassEnabled()) {
      return false
    }
    document.documentElement.dataset.liquidGlass = 'true'
    return true
  }
  if (!mark()) {
    window.addEventListener(runtimeConfigReadyEvent, mark, { once: true })
  }
}
