import { Suspense } from 'react'
import { Upload } from 'lucide-react'
import { QuickSwitcher } from './QuickSwitcher'
import { ProfilePhotoViewer } from './ProfilePhotoViewer'
import { RoomInfoDialog } from './RoomInfoDialog'
import { ThreadPanel } from './ThreadPanel'
import { VerificationDialog } from './VerificationDialog'
import { AppService } from '../bindings/mychat/desktop'
import { languageName, roomLearningLanguageChoice, roomLearningLanguageKey, roomTutorLanguageChoice, roomTutorLanguageKey } from './aiSettings'
import { DialogPresence } from './DialogPresence'
import type { AppState } from './appState'
import { SettingsDialog, AIResultDialogs, ScheduledJobsDialog, ScheduledDraftDialog, MediaApprovalDialog, GeneratedImageDialog, LeaveRoomDialog, RedactDialog, ForwardMessageDialog, MediaGalleryDialog, ImproveDraftDialog } from './appLazyDialogs'

export function AppDialogs({ app }: { app: AppState }) {
  const { acceptAIResult, activeAccountID, activeThread, agentEditor, agentSettingsError, aiEnabled, aiPanel, analyzeWithLanguageTutor, applyImprovedDraft, approveGeneratedImage, archiveInactiveRooms, audioInputDevices, busy, closeAIResult, closeImproveDraft, closeLanguageTutor, closeMediaGallery, confirmMessageForward, createAgentProfile, deleteAgentProfile, editTarget, forwardBusy, forwardError, forwardTargetRoomID, forwardingMessage, generatedImageReview, historyRevision, inferChatGoal, improveDraft, inviteToSelectedRoom, languageRoles, languageTutorState, leaveConfirmOpen, leaveRoomError, leaveSelectedRoom, leavingRoom, manageScheduledJob, mediaApproval, mediaGalleryError, mediaGalleryFilter, mediaGalleryItems, mediaGalleryLoading, mediaGalleryOpen, mediaGalleryScanned, messages, openMediaGallery, persistRoomAgents, preferences, profilePhotoPreview, quickSwitcherIndex, quickSwitcherInputRef, quickSwitcherOpen, quickSwitcherQuery, quickSwitcherRooms, redactMessage, redactTarget, regenerateAIResult, resetAccountWorkspace, resolveMediaApproval, roomAgents, roomChatGoal, roomDrafts, roomInfoOpen, roomMembers, roomMembersError, roomMembersLoading, rooms, runImproveDraft, saveAgentProfile, saveChatGoal, scheduleTimeSuggestions, scheduledBusyID, scheduledDialogError, scheduledDraft, scheduledDueAt, scheduledJobs, scheduledJobsError, scheduledJobsOpen, scheduledLoading, scheduledSaving, scheduledTimes, selectedAudioInputDeviceId, selectedRoom, selectedRoomID, sendAIFollowUp, setAIFollowUp, setAgentEditor, setAgentSettingsError, setForwardTargetRoomID, setForwardingMessage, setGeneratedImageReview, setImproveDraftGoal, setLeaveConfirmOpen, setLeaveRoomError, setMediaGalleryFilter, setOpenThread, setPreference, setPreferenceWithTransition, setPreferences, setProfilePhotoPreview, setQuickSwitcherIndex, setQuickSwitcherOpen, setQuickSwitcherQuery, setRedactTarget, setRoomInfoOpen, setScheduledDraft, setScheduledDueAt, setScheduledJobsOpen, setScheduledTimes, setSettingsOpen, setSettingsTab, setStagedAttachments, settingsOpen, settingsTab, showRoom, snapshot, snippets, stopAIRequest, stopImproveReview, submitScheduledDraft, updateSnippets, useLanguageTutorDraft } = app
  return (
    <>
    {forwardingMessage && <Suspense fallback={null}>
      <ForwardMessageDialog
        message={forwardingMessage}
        destinations={rooms.filter((room) => room.id !== selectedRoomID)}
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
        onCheckLanguageTutorDraft={(text) => void analyzeWithLanguageTutor(text, 'draft')}
        onUseLanguageTutorDraft={useLanguageTutorDraft}
      />
    </Suspense>}
    {improveDraft && <Suspense fallback={null}>
      <ImproveDraftDialog session={improveDraft} onGoalChange={setImproveDraftGoal} onRun={() => void runImproveDraft()} onStop={stopImproveReview} onUse={applyImprovedDraft} onClose={closeImproveDraft} />
    </Suspense>}
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
      chatGoal={roomChatGoal}
      aiEnabled={aiEnabled}
      onInferChatGoal={inferChatGoal}
      onSaveChatGoal={saveChatGoal}
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
