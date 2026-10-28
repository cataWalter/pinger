import type { FormEvent } from 'react'
import { LogOut, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Member, Room } from '../bindings/mychat/desktop/models.js'
import { DialogSurface } from './DialogSurface'
import { MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_CHAT_AGENTS, type ChatAgentCollection, type ChatAgentProfile } from './aiPrompts'
import { initials } from './appShared'

export function RoomInfoDialog({ room, agents, agentEditor, agentSettingsError, members, membersLoading, membersError, onClose, onAgentEditorChange, onDefaultAgentChange, onEditAgent, onDeleteAgent, onSaveAgent, onCreateAgent, onLeave }: {
  room: Room
  agents: ChatAgentCollection
  agentEditor: ChatAgentProfile | null
  agentSettingsError: string
  members: Member[]
  membersLoading: boolean
  membersError: string
  onClose: () => void
  onAgentEditorChange: (agent: ChatAgentProfile | null) => void
  onDefaultAgentChange: (agentID: string) => void
  onEditAgent: (agent: ChatAgentProfile) => void
  onDeleteAgent: (agent: ChatAgentProfile) => void
  onSaveAgent: (event: FormEvent<HTMLFormElement>) => void
  onCreateAgent: () => void
  onLeave: () => void
}) {
  return (
    <div className="room-info-scrim" role="presentation" onClick={onClose}>
      <DialogSurface className="room-info-dialog" labelledBy="room-info-title" onClose={onClose} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">ROOM DETAILS</span><h2 id="room-info-title">{room.name || room.id}</h2></div>
          <button className="icon-button" type="button" aria-label="Close room details" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="room-info-content">
          <div className="room-info-fact"><span>Room ID</span><strong>{room.id}</strong></div>
          {room.topic && <div className="room-info-fact"><span>Topic</span><strong>{room.topic}</strong></div>}
          <section className="room-agent-settings" aria-label="Chat agents">
            <div className="room-members-heading"><h3>Chat agents</h3><span>{agents.agents.length}/{MAX_CHAT_AGENTS}</span></div>
            <p className="room-agent-note">Profiles are saved to this account for this room. Profile instructions and included chat text are sent to the configured endpoint, which may be remote.</p>
            <label className="room-agent-field"><span>Default agent</span><select aria-label="Default chat agent" value={agents.defaultAgentId} onChange={(event) => onDefaultAgentChange(event.target.value)}>
              <option value="">No default</option>
              {agents.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select></label>
            {agents.agents.map((agent) => <div className="room-agent-row" key={agent.id}>
              <span>{agent.name}{agent.id === agents.defaultAgentId && <small>Default</small>}</span>
              <button className="icon-button" type="button" aria-label={`Edit ${agent.name}`} title={`Edit ${agent.name}`} onClick={() => onEditAgent(agent)}><Pencil size={14} /></button>
              <button className="icon-button" type="button" aria-label={`Delete ${agent.name}`} title={`Delete ${agent.name}`} onClick={() => onDeleteAgent(agent)}><Trash2 size={14} /></button>
            </div>)}
            {agents.agents.length === 0 && <p className="room-info-state">No chat agents are set up for this room.</p>}
            {agentSettingsError && <p className="settings-error" role="alert">{agentSettingsError}</p>}
            {agentEditor && <form className="room-agent-editor" onSubmit={onSaveAgent}>
              <label className="room-agent-field"><span>Name</span><input autoFocus maxLength={MAX_AGENT_NAME_LENGTH} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={agentEditor.name} onChange={(event) => onAgentEditorChange({ ...agentEditor, name: event.target.value })} required /></label>
              <label className="room-agent-field"><span>Instructions</span><textarea maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH} rows={4} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={agentEditor.instructions} onChange={(event) => onAgentEditorChange({ ...agentEditor, instructions: event.target.value })} required /></label>
              <div className="room-agent-editor-actions"><button className="settings-command" type="submit">Save agent</button><button className="settings-command" type="button" onClick={() => onAgentEditorChange(null)}>Cancel</button></div>
            </form>}
            {!agentEditor && <button className="settings-command room-agent-add" type="button" disabled={agents.agents.length >= MAX_CHAT_AGENTS} onClick={onCreateAgent}><Plus size={14} />Add agent</button>}
          </section>
          <div className="room-members-heading"><h3>Members</h3><span>{membersLoading ? 'Loading' : members.length}</span></div>
          {membersLoading ? <div className="room-info-state"><span className="loading-mark" />Loading members</div>
            : membersError ? <p className="room-info-state is-error" role="alert">{membersError}</p>
              : members.length === 0 ? <p className="room-info-state">No room members found.</p>
                : <div className="room-member-list">{members.map((member) => <div className="room-member-row" key={member.id}>
                  <span className="room-member-avatar">{initials(member.displayName || member.id)}</span>
                  <span><strong>{member.displayName || member.id}</strong>{member.displayName && <small>{member.id}</small>}</span>
                </div>)}</div>}
        </div>
        <footer className="room-info-footer">
          <button className="settings-command is-danger" type="button" onClick={onLeave}><LogOut size={15} />Leave room</button>
        </footer>
      </DialogSurface>
    </div>
  )
}
