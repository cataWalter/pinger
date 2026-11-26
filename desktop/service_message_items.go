package desktop

import "mychat/matrix"

// mapMessageItems converts matrix message items into their desktop representation.
func mapMessageItems(items []matrix.MessageItem) []MessageItem {
	if len(items) == 0 {
		return nil
	}
	mapped := make([]MessageItem, 0, len(items))
	for _, item := range items {
		messages := mapMessages([]matrix.Message{item.Message})
		mapped = append(mapped, MessageItem{RoomID: item.RoomID, Message: messages[0]})
	}
	return mapped
}

func cloneReactionCounts(counts map[string]int) map[string]int {
	cloned := make(map[string]int, len(counts))
	for k, v := range counts {
		cloned[k] = v
	}
	return cloned
}

func cloneReactionFlags(flags map[string]bool) map[string]bool {
	cloned := make(map[string]bool, len(flags))
	for k, v := range flags {
		cloned[k] = v
	}
	return cloned
}
