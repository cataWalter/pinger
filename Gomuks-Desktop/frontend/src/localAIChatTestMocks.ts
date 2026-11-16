import { vi } from 'vitest'

export const eventHandlers = new Map<string, (event: { data: unknown }) => void>()
export const markdownRender = vi.fn()

export const service = {
  AICancel: vi.fn(),
  AppendLocalAIChatMessage: vi.fn(),
  CreateLocalAIChat: vi.fn(),
  GenerateLocalAIChatTitle: vi.fn(),
  LoadLocalAIChatMessages: vi.fn(),
  LocalAIChat: vi.fn(),
  LocalAIChatGenerateImage: vi.fn(),
  SetLocalAIChatAgent: vi.fn(),
  TruncateLocalAIChat: vi.fn(),
}

export const desktopMock = {
  AppService: service,
}

export const runtimeMock = {
  Call: { ByName: vi.fn() },
  Clipboard: { SetText: vi.fn() },
  Events: {
    On: vi.fn((name: string, handler: (event: { data: unknown }) => void) => {
      eventHandlers.set(name, handler)
      return () => eventHandlers.delete(name)
    }),
  },
}

export function resetLocalAIChatMocks() {
  Object.values(service).forEach((mock) => mock.mockReset())
  markdownRender.mockClear()
  eventHandlers.clear()
  // Start above the fixture seqs (1, 2, ...) so appended messages never share a React key.
  let seq = 100
  service.AICancel.mockResolvedValue(true)
  service.GenerateLocalAIChatTitle.mockResolvedValue('')
  service.AppendLocalAIChatMessage.mockImplementation(async (_chatID: string, message: object) => ({ ...message, seq: ++seq, createdAt: 1 }))
  service.CreateLocalAIChat.mockResolvedValue({ id: 'chat-1', title: '', agentId: '', updatedAt: 1 })
  service.LoadLocalAIChatMessages.mockResolvedValue([])
  service.LocalAIChatGenerateImage.mockResolvedValue([])
  service.SetLocalAIChatAgent.mockResolvedValue(undefined)
  service.TruncateLocalAIChat.mockResolvedValue(undefined)
}
