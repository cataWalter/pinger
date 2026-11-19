import { afterEach, describe, expect, it } from 'vitest'
import { preferredScrollBehavior } from './dom'

describe('preferredScrollBehavior', () => {
  afterEach(() => {
    delete document.documentElement.dataset.lowSpec
  })

  it('keeps smooth scrolling by default', () => {
    expect(preferredScrollBehavior()).toBe('smooth')
  })

  it('scrolls instantly in low-spec mode', () => {
    document.documentElement.dataset.lowSpec = 'true'

    expect(preferredScrollBehavior()).toBe('auto')
  })
})
