import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Invite } from '../bindings/mychat/desktop/models.js'
import { InvitePeopleForm, InviteList, NewRoomDialog, parseMatrixIDList, sameInviteList } from './RoomMembership'

const invite: Invite = { roomId: '!dm:example.org', name: 'Alice', topic: '', avatar: '', inviter: '@alice:example.org', inviterName: 'Alice', direct: true, invitedAt: 10 }

describe('room membership helpers', () => {
  it('parses Matrix IDs separated by commas, semicolons and whitespace', () => {
    expect(parseMatrixIDList(' @a:example.org, @b:example.org;\n@c:example.org  ')).toEqual(['@a:example.org', '@b:example.org', '@c:example.org'])
    expect(parseMatrixIDList(' , ')).toEqual([])
  })

  it('compares invite lists by visible fields', () => {
    expect(sameInviteList([invite], [{ ...invite }])).toBe(true)
    expect(sameInviteList([invite], [{ ...invite, inviterName: 'Alicia' }])).toBe(false)
    expect(sameInviteList([invite], [])).toBe(false)
  })
})

describe('room membership components', () => {
  afterEach(() => cleanup())

  it('lists direct invitations and blocks actions while one is busy', () => {
    render(<InviteList invites={[invite]} busyRoomID={invite.roomId} onAccept={vi.fn()} onDecline={vi.fn()} />)

    expect(screen.getByText('Wants to chat: Alice')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Accept invitation to Alice' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Decline invitation to Alice' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('creates an unencrypted group with a topic', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(<NewRoomDialog initialMode="create" onClose={vi.fn()} onJoin={vi.fn()} onCreate={onCreate} />)

    const submit = screen.getByRole('button', { name: 'Create group' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '  Book club ')
    await user.type(screen.getByRole('textbox', { name: 'Topic (optional)' }), 'Monthly reads')
    await user.click(screen.getByRole('checkbox', { name: 'End-to-end encryption' }))
    expect(screen.getByText('Messages will be readable by the servers in this room.')).toBeTruthy()
    await user.click(submit)

    expect(onCreate).toHaveBeenCalledWith({ name: 'Book club', topic: 'Monthly reads', invitees: [], encrypted: false })
  })

  it('reports invite failures and keeps the draft', async () => {
    const user = userEvent.setup()
    const onInvite = vi.fn().mockRejectedValue(new Error('not allowed'))
    render(<InvitePeopleForm onInvite={onInvite} />)

    await user.type(screen.getByRole('textbox', { name: 'Invite people' }), '@a:example.org @b:example.org')
    await user.click(screen.getByRole('button', { name: 'Invite' }))

    expect((await screen.findByRole('alert')).textContent).toBe('not allowed')
    expect(onInvite).toHaveBeenCalledWith(['@a:example.org', '@b:example.org'])
    expect((screen.getByRole('textbox', { name: 'Invite people' }) as HTMLInputElement).value).toBe('@a:example.org @b:example.org')
  })
})
