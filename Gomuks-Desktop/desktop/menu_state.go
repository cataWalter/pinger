package desktop

// MenuState is the frontend state that enables, labels, and checks native menu items.
type MenuState struct {
	RoomSelected     bool   `json:"roomSelected"`
	RoomUnread       bool   `json:"roomUnread"`
	RoomArchived     bool   `json:"roomArchived"`
	RoomFavorite     bool   `json:"roomFavorite"`
	RoomUnanswered   bool   `json:"roomUnanswered"`
	RoomNeedsReply   bool   `json:"roomNeedsReply"`
	NeedsReplyCount  int    `json:"needsReplyCount"`
	PrivateChatOpen  bool   `json:"privateChatOpen"`
	PrivateChatInAll bool   `json:"privateChatInAll"`
	DraftReady       bool   `json:"draftReady"`
	Filter           string `json:"filter"`
}

// SetMenuState receives the frontend room and filter state that drives the native menu.
func (s *AppService) SetMenuState(state MenuState) {
	if s.menuStateChanged != nil {
		s.menuStateChanged(state)
	}
}

// notifyAccountsChanged tells the native client to refresh its account list.
func (s *AppService) notifyAccountsChanged() {
	if s.menuAccountsChanged != nil {
		s.menuAccountsChanged()
	}
}
