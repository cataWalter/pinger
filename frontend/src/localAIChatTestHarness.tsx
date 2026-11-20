import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import LocalAIChat, { type LocalAIChatProps } from './LocalAIChat'

export function renderChat(overrides: Partial<LocalAIChatProps> = {}) {
  const props: LocalAIChatProps = {
    chatId: null,
    chatTitle: '',
    agentId: '',
    agents: [],
    hidden: false,
    onAgentChange: vi.fn(),
    onCreateAgent: vi.fn(async () => true),
    onChatCreated: vi.fn(),
    onChatsChanged: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<LocalAIChat {...props} />) }
}

export async function sendDraft(text: string) {
  const composer = screen.getByRole('textbox', { name: 'Message AI' }) as HTMLTextAreaElement
  await waitFor(() => expect(composer.disabled).toBe(false))
  fireEvent.change(composer, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send to AI' }))
}
