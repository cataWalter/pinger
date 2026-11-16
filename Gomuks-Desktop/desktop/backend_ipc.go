package desktop

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"reflect"
	"sync"
)

type backendRequest struct {
	ID     json.RawMessage   `json:"id"`
	Method string            `json:"method"`
	Params []json.RawMessage `json:"params"`
}

type backendResponse struct {
	ID     json.RawMessage `json:"id"`
	Result any             `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Event  string          `json:"event,omitempty"`
	Data   any             `json:"data,omitempty"`
}

type backendIPC struct {
	service *AppService
	tutor   *LanguageTutorService
	output  io.Writer
	mu      sync.Mutex
}

func (ipc *backendIPC) emit(event string, data any) {
	if err := ipc.write(backendResponse{Event: event, Data: data}); err != nil {
		fmt.Fprintln(os.Stderr, "write Qt backend event:", err)
	}
}

func (ipc *backendIPC) write(response backendResponse) error {
	data, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("encode Qt backend response: %w", err)
	}
	ipc.mu.Lock()
	defer ipc.mu.Unlock()
	if _, err := ipc.output.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write Qt backend response: %w", err)
	}
	return nil
}

func (ipc *backendIPC) invoke(request backendRequest) backendResponse {
	method := reflect.ValueOf(ipc.service).MethodByName(request.Method)
	if !method.IsValid() && request.Method == "Analyze" && ipc.tutor != nil {
		method = reflect.ValueOf(ipc.tutor).MethodByName(request.Method)
	}
	if !method.IsValid() {
		return backendResponse{ID: request.ID, Error: fmt.Sprintf("unknown backend method %q", request.Method)}
	}

	methodType := method.Type()
	if len(request.Params) != methodType.NumIn() {
		return backendResponse{ID: request.ID, Error: fmt.Sprintf("%s expects %d parameters, received %d", request.Method, methodType.NumIn(), len(request.Params))}
	}
	args := make([]reflect.Value, len(request.Params))
	for i, raw := range request.Params {
		arg := reflect.New(methodType.In(i))
		if err := json.Unmarshal(raw, arg.Interface()); err != nil {
			return backendResponse{ID: request.ID, Error: fmt.Sprintf("decode parameter %d for %s: %v", i+1, request.Method, err)}
		}
		args[i] = arg.Elem()
	}

	results := method.Call(args)
	if len(results) > 2 {
		return backendResponse{ID: request.ID, Error: fmt.Sprintf("%s has an unsupported result signature", request.Method)}
	}
	var result any
	if len(results) > 0 {
		result = results[0].Interface()
	}
	if len(results) == 2 {
		errorType := reflect.TypeOf((*error)(nil)).Elem()
		if !results[1].Type().Implements(errorType) {
			return backendResponse{ID: request.ID, Error: fmt.Sprintf("%s has an unsupported result signature", request.Method)}
		}
		if !results[1].IsNil() {
			return backendResponse{ID: request.ID, Error: results[1].Interface().(error).Error()}
		}
	}
	if len(results) == 1 && results[0].Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
		if !results[0].IsNil() {
			return backendResponse{ID: request.ID, Error: results[0].Interface().(error).Error()}
		}
		result = nil
	}
	return backendResponse{ID: request.ID, Result: result}
}

func (ipc *backendIPC) serve(input io.Reader) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 64*1024*1024)
	var requests sync.WaitGroup
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var request backendRequest
		if err := json.Unmarshal(line, &request); err != nil {
			if writeErr := ipc.write(backendResponse{Error: fmt.Sprintf("decode request: %v", err)}); writeErr != nil {
				return writeErr
			}
			continue
		}
		if len(request.ID) == 0 || request.Method == "" {
			if writeErr := ipc.write(backendResponse{ID: request.ID, Error: "request must include an id and method"}); writeErr != nil {
				return writeErr
			}
			continue
		}
		requests.Add(1)
		go func(request backendRequest) {
			defer requests.Done()
			if err := ipc.write(ipc.invoke(request)); err != nil {
				fmt.Fprintln(os.Stderr, err)
			}
		}(request)
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read Qt backend requests: %w", err)
	}
	requests.Wait()
	return nil
}

func (ipc *backendIPC) startEvents() {
	ipc.service.startEventPump(func(update Update) {
		ipc.emit("update", update)
	})
	ipc.service.startPreferencePump(func(snapshot Snapshot) {
		ipc.emit("preferences", snapshot)
	})
	ipc.service.emitReminder = func(reminder ScheduledJob) {
		ipc.emit(scheduledReminderEventName, reminder)
	}
	ipc.service.emitLocalAIChatStream = func(event LocalAIChatStreamEvent) {
		ipc.emit(localAIChatStreamEventName, event)
	}
	ipc.service.emitLocalAIImageProgress = func(event LocalAIImageProgressEvent) {
		ipc.emit(localAIImageProgressEventName, event)
	}
	ipc.service.emitChatExportProgress = func(event ChatExportProgress) {
		ipc.emit(chatExportProgressEventName, event)
	}
	ipc.service.emitBulkChatExportProgress = func(event BulkChatExportProgress) {
		ipc.emit(bulkChatExportProgressEventName, event)
	}
	ipc.service.emitAIStream = func(event AIStreamEvent) {
		ipc.emit(aiStreamEventName, event)
	}
}
