import { memo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Member, Room } from '../bindings/mychat/desktop/models.js'
import { DialogScrim, DialogSurface } from './DialogSurface'
import { MAX_AGENT_INSTRUCTIONS_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_CHAT_AGENTS, MAX_CHAT_GOAL_LENGTH, type ChatAgentCollection, type ChatAgentProfile } from './aiPrompts'
import type { LanguageEntry } from './aiSettings'
import { describeError, initials } from './appShared'
import { InvitePeopleForm } from './RoomMembership'

// ChatGoalEditor keeps an unsaved draft. Inference fills the draft only, and nothing is saved until the user presses Save.
function ChatGoalEditor({ savedGoal, aiEnabled, onInfer, onSave }: {
  savedGoal: string
  aiEnabled: boolean
  onInfer: () => Promise<string>
  onSave: (goal: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(savedGoal)
  const [busy, setBusy] = useState<'' | 'inferring' | 'saving'>('')
  const [error, setError] = useState('')
  const dirty = draft.trim() !== savedGoal.trim()

  async function infer() {
    setBusy('inferring')
    setError('')
    try {
      setDraft((await onInfer()).trim())
    } catch (inferError) {
      setError(describeError(inferError))
    } finally {
      setBusy('')
    }
  }

  async function save(goal: string) {
    setBusy('saving')
    setError('')
    const saved = await onSave(goal.trim())
    setBusy('')
    if (!saved) setError(t('roomInfo.saveGoalError'))
    else setDraft(goal.trim())
  }

  return (
    <section className="room-agent-settings room-goal-settings" aria-label={t('roomInfo.chatGoalSection')}>
      <div className="room-members-heading"><h3>{t('roomInfo.chatGoalSection')}</h3><span>{draft.length}/{MAX_CHAT_GOAL_LENGTH}</span></div>
      <p className="room-agent-note">{t('roomInfo.goalNote')}</p>
      <label className="room-agent-field"><span>{t('roomInfo.goalLabel')}</span><textarea maxLength={MAX_CHAT_GOAL_LENGTH} rows={3} spellCheck={false} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <div className="room-agent-editor-actions">
        <button className="settings-command" type="button" disabled={!aiEnabled || busy !== ''} title={aiEnabled ? undefined : t('roomInfo.setUpAIFirst')} onClick={() => void infer()}><Sparkles size={14} />{busy === 'inferring' ? t('roomInfo.readingChat') : t('roomInfo.inferFromChat')}</button>
        <button className="settings-command" type="button" disabled={!dirty || busy !== ''} onClick={() => void save(draft)}>{busy === 'saving' ? t('roomInfo.saving') : t('roomInfo.saveGoal')}</button>
        {savedGoal && <button className="settings-command is-danger" type="button" disabled={busy !== ''} onClick={() => void save('')}>{t('roomInfo.clearGoal')}</button>}
      </div>
      {error && <p className="settings-error" role="alert">{error}</p>}
    </section>
  )
}

export const RoomInfoDialog = memo(function RoomInfoDialog({ room, chatGoal, aiEnabled, onInferChatGoal, onSaveChatGoal, agents, agentEditor, agentSettingsError, members, membersLoading, membersError, onClose, onAgentEditorChange, onDefaultAgentChange, onEditAgent, onDeleteAgent, onSaveAgent, onCreateAgent, onInvite, onLeave, learningLanguage, explanationLanguage, languageOptions, defaultLearningLanguageName, defaultExplanationLanguageName, onLearningLanguageChange, onExplanationLanguageChange }: {
  room: Room
  chatGoal: string
  aiEnabled: boolean
  onInferChatGoal: () => Promise<string>
  onSaveChatGoal: (goal: string) => Promise<boolean>
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
  onInvite: (userIDs: string[]) => Promise<void>
  onLeave: () => void
  learningLanguage: string
  explanationLanguage: string
  languageOptions: readonly LanguageEntry[]
  defaultLearningLanguageName: string
  defaultExplanationLanguageName: string
  onLearningLanguageChange: (code: string) => void
  onExplanationLanguageChange: (code: string) => void
}) {
  const { t } = useTranslation()
  return (
    <DialogScrim variant="drawer" className="room-info-scrim" onDismiss={onClose}>
      <DialogSurface className="room-info-dialog" labelledBy="room-info-title" onClose={onClose}>
        <header className="room-info-header">
          <div><span className="eyebrow">{t('roomInfo.eyebrow')}</span><h2 id="room-info-title">{room.name || room.id}</h2></div>
          <button className="icon-button" type="button" aria-label={t('roomInfo.closeDetails')} onClick={onClose}><X size={16} /></button>
        </header>
        <div className="room-info-content">
          <div className="room-info-fact"><span>{t('roomInfo.roomId')}</span><strong>{room.id}</strong></div>
          {room.topic && <div className="room-info-fact"><span>{t('roomInfo.topic')}</span><strong>{room.topic}</strong></div>}
          <ChatGoalEditor key={`${room.id}:${chatGoal}`} savedGoal={chatGoal} aiEnabled={aiEnabled} onInfer={onInferChatGoal} onSave={onSaveChatGoal} />
          <section className="room-agent-settings room-tutor-settings" aria-label={t('roomInfo.chatLanguages')}>
            <div className="room-members-heading"><h3>{t('roomInfo.languages')}</h3></div>
            <label className="room-agent-field"><span>{t('roomInfo.languageToLearn')}</span><select aria-label={t('roomInfo.languageToLearn')} value={learningLanguage} onChange={(event) => onLearningLanguageChange(event.target.value)}>
              <option value="">{t('roomInfo.defaultOption', { name: defaultLearningLanguageName })}</option>
              {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
            </select></label>
            <label className="room-agent-field"><span>{t('roomInfo.translationsAndExplanations')}</span><select aria-label={t('roomInfo.translationsAndExplanations')} value={explanationLanguage} onChange={(event) => onExplanationLanguageChange(event.target.value)}>
              <option value="">{t('roomInfo.defaultOption', { name: defaultExplanationLanguageName })}</option>
              {languageOptions.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
            </select></label>
          </section>
          <section className="room-agent-settings" aria-label={t('roomInfo.chatAgents')}>
            <div className="room-members-heading"><h3>{t('roomInfo.chatAgents')}</h3><span>{agents.agents.length}/{MAX_CHAT_AGENTS}</span></div>
            <p className="room-agent-note">{t('roomInfo.chatAgentsNote')}</p>
            <label className="room-agent-field"><span>{t('roomInfo.defaultAgent')}</span><select aria-label={t('roomInfo.defaultChatAgent')} value={agents.defaultAgentId} onChange={(event) => onDefaultAgentChange(event.target.value)}>
              <option value="">{t('roomInfo.noDefault')}</option>
              {agents.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select></label>
            {agents.agents.map((agent) => <div className="room-agent-row" key={agent.id}>
              <span>{agent.name}{agent.id === agents.defaultAgentId && <small>{t('roomInfo.defaultBadge')}</small>}</span>
              <button className="icon-button" type="button" aria-label={t('roomInfo.editNamed', { name: agent.name })} title={t('roomInfo.editNamed', { name: agent.name })} onClick={() => onEditAgent(agent)}><Pencil size={14} /></button>
              <button className="icon-button" type="button" aria-label={t('roomInfo.deleteNamed', { name: agent.name })} title={t('roomInfo.deleteNamed', { name: agent.name })} onClick={() => onDeleteAgent(agent)}><Trash2 size={14} /></button>
            </div>)}
            {agents.agents.length === 0 && <p className="room-info-state">{t('roomInfo.noChatAgents')}</p>}
            {agentSettingsError && <p className="settings-error" role="alert">{agentSettingsError}</p>}
            {agentEditor && <form className="room-agent-editor" onSubmit={onSaveAgent}>
              <label className="room-agent-field"><span>{t('roomInfo.nameLabel')}</span><input autoFocus maxLength={MAX_AGENT_NAME_LENGTH} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={agentEditor.name} onChange={(event) => onAgentEditorChange({ ...agentEditor, name: event.target.value })} required /></label>
              <label className="room-agent-field"><span>{t('roomInfo.instructionsLabel')}</span><textarea maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH} rows={4} spellCheck={false} autoCorrect="off" autoCapitalize="off" value={agentEditor.instructions} onChange={(event) => onAgentEditorChange({ ...agentEditor, instructions: event.target.value })} required /></label>
              <div className="room-agent-editor-actions"><button className="settings-command" type="submit">{t('roomInfo.saveAgent')}</button><button className="settings-command" type="button" onClick={() => onAgentEditorChange(null)}>{t('common.cancel')}</button></div>
            </form>}
            {!agentEditor && <button className="settings-command room-agent-add" type="button" disabled={agents.agents.length >= MAX_CHAT_AGENTS} onClick={onCreateAgent}><Plus size={14} />{t('roomInfo.addAgent')}</button>}
          </section>
          <div className="room-members-heading"><h3>{t('roomInfo.members')}</h3><span>{membersLoading ? t('roomInfo.loadingShort') : members.length}</span></div>
          <InvitePeopleForm key={room.id} onInvite={onInvite} />
          {membersLoading ? <div className="room-info-state"><span className="loading-mark" />{t('roomInfo.loadingMembers')}</div>
            : membersError ? <p className="room-info-state is-error" role="alert">{membersError}</p>
              : members.length === 0 ? <p className="room-info-state">{t('roomInfo.noMembersFound')}</p>
                : <div className="room-member-list">{members.map((member) => <div className="room-member-row" key={member.id}>
                  <span className="room-member-avatar">{initials(member.displayName || member.id)}</span>
                  <span><strong>{member.displayName || member.id}</strong>{member.displayName && <small>{member.id}</small>}</span>
                </div>)}</div>}
        </div>
        <footer className="room-info-footer">
          <button className="settings-command is-danger" type="button" onClick={onLeave}><LogOut size={15} />{t('roomInfo.leaveRoom')}</button>
        </footer>
      </DialogSurface>
    </DialogScrim>
  )
})
