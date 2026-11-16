import type { useComposerKeys } from './useComposerKeys'

type AppBase = ReturnType<typeof useComposerKeys>

export type AppState = Omit<AppBase, 'snapshot'> & { snapshot: NonNullable<AppBase['snapshot']> }
