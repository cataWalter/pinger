import { Suspense } from 'react'
import { Check, X, Plus, Upload } from 'lucide-react'
import { QuickSwitcher } from './QuickSwitcher'
import { ProfilePhotoViewer } from './ProfilePhotoViewer'
import { RoomInfoDialog } from './RoomInfoDialog'
import { NewRoomDialog } from './RoomMembership'
import { ThreadPanel } from './ThreadPanel'
import { VerificationDialog } from './VerificationDialog'
import { AppService } from '../bindings/mychat/desktop'
import { languageName, roomLearningLanguageChoice, roomLearningLanguageKey, roomTutorLanguageChoice, roomTutorLanguageKey } from './aiSettings'
import { DialogSurface } from './DialogSurface'
import { DialogPresence } from './DialogPresence'
import { Avatar } from './appShared'
import type { AppState } from './appState'
import { SettingsDialog, AIResultDialogs, ScheduledJobsDialog, ScheduledDraftDialog, MediaApprovalDialog, GeneratedImageDialog, LeaveRoomDialog, RedactDialog, ForwardMessageDialog, MediaGalleryDialog } from './appLazyDialogs'

export function AppDialogs({ app }: { app: AppState }) {
  const { acceptAIResult, accountError, accountHomeserver, accountManagerOpen, accountPassword, accountUsername, activeAccountID, activeThread, addingAccount, agentEditor, agentSettingsError, aiPanel, approveGeneratedImage, archiveInactiveRooms, audioInputDevices, busy, closeAIResult, closeLanguageTutor, closeMediaGallery, confirmMessageForward, createAgentProfile, createGroupRoom, deleteAgentProfile, editTarget, forwardBusy, forwardError, forwardTargetRoomID, forwardingMessage, generatedImageReview, historyRevision, inviteToSelectedRoom, isActiveAccountRoom, joinRoomByAddress, languageRoles, languageTutorState, leaveConfirmOpen, leaveRoomError, leaveSelectedRoom, leavingRoom, manageScheduledJob, mediaApproval, mediaGalleryError, mediaGalleryFilter, mediaGalleryItems, mediaGalleryLoading, mediaGalleryOpen, mediaGalleryScanned, messages, newRoomMode, openMediaGallery, persistRoomAgents, preferences, profilePhotoPreview, quickSwitcherIndex, quickSwitcherInputRef, quickSwitcherOpen, quickSwitcherQuery, quickSwitcherRooms, redactMessage, redactTarget, regenerateAIResult, resetAccountWorkspace, resolveMediaApproval, roomAgents, roomDrafts, roomInfoOpen, roomMembers, roomMembersError, roomMembersLoading, rooms, saveAgentProfile, scheduleTimeSuggestions, scheduledBusyID, scheduledDialogError, scheduledDraft, scheduledDueAt, scheduledJobs, scheduledJobsError, scheduledJobsOpen, scheduledLoading, scheduledSaving, scheduledTimes, selectedAudioInputDeviceId, selectedRoom, selectedRoomID, sendAIFollowUp, setAIFollowUp, setAccountError, setAccountHomeserver, setAccountManagerOpen, setAccountPassword, setAccountUsername, setAddingAccount, setAgentEditor, setAgentSettingsError, setForwardTargetRoomID, setForwardingMessage, setGeneratedImageReview, setLeaveConfirmOpen, setLeaveRoomError, setMediaGalleryFilter, setNewRoomMode, setOpenThread, setPreference, setPreferenceWithTransition, setPreferences, setProfilePhotoPreview, setQuickSwitcherIndex, setQuickSwitcherOpen, setQuickSwitcherQuery, setRedactTarget, setRoomInfoOpen, setScheduledDraft, setScheduledDueAt, setScheduledJobsOpen, setScheduledTimes, setSettingsOpen, setSettingsTab, setStagedAttachments, settingsOpen, settingsTab, showRoom, snapshot, snippets, stopAIRequest, submitAddAccount, submitScheduledDraft, switchAccount, updateSnippets, useLanguageTutorDraft } = app
  return (
    <>
    {forwardingMessage && <Suspense fallback={null}>
      <ForwardMessageDialog
        message={forwardingMessage}
        destinations={rooms.filter((room) => room.id !== selectedRoomID && isActiveAccountRoom(room))}
        targetRoomID={forwardTargetRoomID}
        busy={forwardBusy}
        error={forwardError}
        onTargetChange={setForwardTargetRoomID}
        onClose={() => setForwardingMessage(null)}
        onConfirm={() => void confirmMessageForward()}
      />
    </Suspense>}
    {(aiPanel || languageTutorState) && <Suspense fallback={null}>
      <AIResultDialogs
        aiPanel={aiPanel}
        languageTutorState={languageTutorState}
        hasEditTarget={Boolean(editTarget)}
        languageRoles={languageRoles}
        onCloseAIResult={closeAIResult}
        onAcceptAIResult={acceptAIResult}
        onStopAIRequest={stopAIRequest}
        onRegenerateAIResult={regenerateAIResult}
        onFollowUpChange={setAIFollowUp}
        onSendFollowUp={sendAIFollowUp}
        onCloseLanguageTutor={closeLanguageTutor}
        onUseLanguageTutorDraft={useLanguageTutorDraft}
      />
    </Suspense>}
    {accountManagerOpen && <div className="room-info-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAccountManagerOpen(false) }}>
      <DialogSurface className="room-info-dialog account-dialog" labelledBy="account-manager-title" onClose={() => { if (!busy) setAccountManagerOpen(false) }} onClick={(event) => event.stopPropagation()}>
        <header className="room-info-header">
          <div><span className="eyebrow">MATRIX</span><h2 id="account-manager-title">{addingAccount ? 'Add account' : 'Accounts'}</h2></div>
          <button className="icon-button" type="button" aria-label="Close account manager" disabled={busy} onClick={() => setAccountManagerOpen(false)}><X size={16} /></button>
        </header>
        {accountError && <p className="account-manager-error" role="alert">{accountError}</p>}
        {addingAccount ? <form className="account-add-form" onSubmit={submitAddAccount}>
          <div className="account-add-field-group">
            <label className="field" htmlFor="account-homeserver">
              <span>Homeserver</span>
              <input id="account-homeserver" type="url" spellCheck={false} autoCorrect="off" autoCapitalize="off" value={accountHomeserver} onChange={(event) => setAccountHomeserver(event.target.value)} autoComplete="url" aria-describedby="account-homeserver-help" required />
            </label>
            <p className="field-help" id="account-homeserver-help">Example: https://matrix.org</p>
          </div>
          <label className="field" htmlFor="account-username">
            <span>Username</span>
            <input id="account-username" value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoCorrect="off" required />
          </label>
          <label className="field" htmlFor="account-password">
            <span>Password</span>
            <input id="account-password" type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} autoComplete="new-password" required />
          </label>
          <div className="account-manager-actions">
            <button className="settings-command" type="button" disabled={busy} onClick={() => { setAddingAccount(false); setAccountError('') }}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Add account'}{!busy && <Plus size={15} />}</button>
          </div>
        </form> : <div className="account-manager-content">
          <div className="account-option-list" aria-label="Connected Matrix accounts">
            {(snapshot.accounts ?? []).map((account) => {
              const label = account.profile.displayName || account.profile.userId
              const active = account.id === snapshot.activeAccountId
              return <button key={account.id} className="account-option" type="button" aria-current={active ? 'true' : undefined} disabled={busy} onClick={() => void switchAccount(account.id)}>
                <Avatar uri={account.profile.avatarUri} label={label} className="profile-avatar" />
                <span className="account-option-copy"><strong>{label}</strong><span>{account.profile.userId}</span></span>
                {active ? <Check size={16} aria-label="Current account" /> : <span className="account-option-homeserver">{account.profile.homeserver}</span>}
              </button>
            })}
          </div>
          <button className="settings-command account-add-button" type="button" disabled={busy} onClick={() => { setAccountError(''); setAddingAccount(true) }}><Plus size={15} />Add account</button>
        </div>}
      </DialogSurface>
    </div>}
    <DialogPresence open={settingsOpen}>
    {settingsOpen && (
      <Suspense fallback={null}>
        <SettingsDialog
          tab={settingsTab}
          profile={snapshot.profile}
          preferences={preferences}
          snippets={snippets}
          rooms={rooms}
          audioInputDevices={audioInputDevices}
          selectedAudioInputDeviceId={selectedAudioInputDeviceId}
          onArchiveInactiveRooms={archiveInactiveRooms}
          onTabChange={setSettingsTab}
          onClose={() => setSettingsOpen(false)}
          onLogout={async () => {
            await AppService.Logout()
            roomDrafts.clearAccount()
            setStagedAttachments((current) => current.filter((item) => {
              if (item.accountID !== activeAccountID) return true
              if (item.previewURL) URL.revokeObjectURL(item.previewURL)
              return false
            }))
            setSettingsOpen(false)
            try {
              resetAccountWorkspace(await AppService.Snapshot())
            } catch {
              // The app is closing after logout from the final account.
            }
          }}
          onPreferenceChange={setPreferenceWithTransition}
          onPreferencesChange={setPreferences}
          onSnippetsChange={updateSnippets}
        />
      </Suspense>
    )}
    </DialogPresence>
    <DialogPresence open={scheduledJobsOpen}>
    {scheduledJobsOpen && <Suspense fallback={null}>
      <ScheduledJobsDialog
        rooms={rooms}
        jobs={scheduledJobs}
        loading={scheduledLoading}
        error={scheduledJobsError}
        times={scheduledTimes}
        setTimes={setScheduledTimes}
        busyID={scheduledBusyID}
        onManage={(id, action) => void manageScheduledJob(id, action)}
        onClose={() => setScheduledJobsOpen(false)}
      />
    </Suspense>}
    </DialogPresence>
    <DialogPresence open={!!scheduledDraft}>
    {scheduledDraft && <Suspense fallback={null}>
      <ScheduledDraftDialog
        draft={scheduledDraft}
        rooms={rooms}
        dueAt={scheduledDueAt}
        setDueAt={setScheduledDueAt}
        setDraft={setScheduledDraft}
        saving={scheduledSaving}
        error={scheduledDialogError}
        suggestions={scheduleTimeSuggestions}
        onSubmit={submitScheduledDraft}
        onClose={() => setScheduledDraft(null)}
      />
    </Suspense>}
    </DialogPresence>
    <DialogPresence open={roomInfoOpen && !!selectedRoom}>
    {roomInfoOpen && selectedRoom && <RoomInfoDialog
      room={selectedRoom}
      agents={roomAgents}
      agentEditor={agentEditor}
      agentSettingsError={agentSettingsError}
      members={roomMembers}
      membersLoading={roomMembersLoading}
      membersError={roomMembersError}
      onClose={() => setRoomInfoOpen(false)}
      onAgentEditorChange={setAgentEditor}
      onDefaultAgentChange={(agentID) => void persistRoomAgents({ ...roomAgents, defaultAgentId: agentID })}
      onEditAgent={(agent) => { setAgentSettingsError(''); setAgentEditor(agent) }}
      onDeleteAgent={(agent) => void deleteAgentProfile(agent)}
      onSaveAgent={(event) => void saveAgentProfile(event)}
      onCreateAgent={createAgentProfile}
      onInvite={inviteToSelectedRoom}
      onLeave={() => { setLeaveRoomError(''); setLeaveConfirmOpen(true) }}
      learningLanguage={roomLearningLanguageChoice(preferences, selectedRoom.id)}
      explanationLanguage={roomTutorLanguageChoice(preferences, selectedRoom.id)}
      languageOptions={languageRoles.languages}
      defaultLearningLanguageName={languageName(languageRoles.learning, languageRoles.languages)}
      defaultExplanationLanguageName={languageName(languageRoles.defaultLanguage, languageRoles.languages)}
      onLearningLanguageChange={(code) => void setPreference(roomLearningLanguageKey(selectedRoom.id), code)}
      onExplanationLanguageChange={(code) => void setPreference(roomTutorLanguageKey(selectedRoom.id), code)}
    />}
    </DialogPresence>
    {activeThread && <ThreadPanel
      key={activeThread.rootID}
      roomID={activeThread.roomID}
      rootID={activeThread.rootID}
      rootMessage={messages.find((message) => message.id === activeThread.rootID)}
      revision={historyRevision}
      currentUserID={snapshot?.profile.userId ?? ''}
      preferences={preferences}
      onClose={() => setOpenThread(null)}
    />}
    <DialogPresence open={!!newRoomMode}>{newRoomMode && <NewRoomDialog initialMode={newRoomMode} onClose={() => setNewRoomMode(null)} onJoin={joinRoomByAddress} onCreate={createGroupRoom} />}</DialogPresence>
    <DialogPresence open={mediaGalleryOpen && !!selectedRoom}>
    {mediaGalleryOpen && selectedRoom && <Suspense fallback={null}>
      <MediaGalleryDialog
        roomID={selectedRoom.id}
        roomName={selectedRoom.name || selectedRoom.id}
        items={mediaGalleryItems}
        filter={mediaGalleryFilter}
        loading={mediaGalleryLoading}
        scanned={mediaGalleryScanned}
        error={mediaGalleryError}
        preferences={preferences}
        onFilterChange={setMediaGalleryFilter}
        onClose={closeMediaGallery}
        onRetry={() => void openMediaGallery()}
      />
    </Suspense>}
    </DialogPresence>
    {mediaApproval && <Suspense fallback={null}>
      <MediaApprovalDialog request={mediaApproval} onResolve={resolveMediaApproval} />
    </Suspense>}
    {generatedImageReview && <Suspense fallback={null}>
      <GeneratedImageDialog review={generatedImageReview} onDiscard={() => setGeneratedImageReview(null)} onApprove={() => void approveGeneratedImage()} />
    </Suspense>}
    <DialogPresence open={leaveConfirmOpen && !!selectedRoom}>
    {leaveConfirmOpen && selectedRoom && <Suspense fallback={null}>
      <LeaveRoomDialog roomName={selectedRoom.name || selectedRoom.id} error={leaveRoomError} leaving={leavingRoom} onCancel={() => setLeaveConfirmOpen(false)} onConfirm={() => void leaveSelectedRoom()} />
    </Suspense>}
    </DialogPresence>
    <DialogPresence open={!!redactTarget}>
    {redactTarget && <Suspense fallback={null}>
      <RedactDialog busy={busy} onCancel={() => setRedactTarget(null)} onConfirm={() => void redactMessage()} />
    </Suspense>}
    </DialogPresence>
    <DialogPresence open={quickSwitcherOpen}>
    {quickSwitcherOpen && <QuickSwitcher
      results={quickSwitcherRooms}
      query={quickSwitcherQuery}
      activeIndex={quickSwitcherIndex}
      inputRef={quickSwitcherInputRef}
      onQueryChange={setQuickSwitcherQuery}
      onActiveIndexChange={setQuickSwitcherIndex}
      onSelect={(roomID) => { showRoom(roomID); setQuickSwitcherOpen(false) }}
      onClose={() => setQuickSwitcherOpen(false)}
    />}
    </DialogPresence>
    <DialogPresence open={!!profilePhotoPreview}>{profilePhotoPreview && <ProfilePhotoViewer source={profilePhotoPreview.source} label={profilePhotoPreview.label} onClose={() => setProfilePhotoPreview(null)} />}</DialogPresence>
    {snapshot.verification && <VerificationDialog key={snapshot.verification.transactionId} verification={snapshot.verification} />}
    <div className="drop-overlay" role="status"><div><Upload size={21} /><span>{selectedRoom ? `Add files to ${selectedRoom.name || selectedRoom.id}` : 'Select a room to upload files'}</span></div></div>
    </>
  )
}
