package desktop

import (
	"bufio"
	"encoding/json"
	"strings"
	"testing"
)

func TestBackendIPCDispatchesMethodsAndValidatesParameters(t *testing.T) {
	ipc := &backendIPC{service: &AppService{}}

	t.Run("invokes a zero-argument method", func(t *testing.T) {
		response := ipc.invoke(backendRequest{ID: json.RawMessage(`"1"`), Method: "AppVersion"})
		if response.Error != "" {
			t.Fatalf("AppVersion returned error: %s", response.Error)
		}
		if response.Result == nil {
			t.Fatal("AppVersion returned no result")
		}
	})

	t.Run("rejects unknown methods", func(t *testing.T) {
		response := ipc.invoke(backendRequest{ID: json.RawMessage(`"2"`), Method: "notAServiceMethod"})
		if response.Error == "" {
			t.Fatal("unknown method was accepted")
		}
	})

	t.Run("rejects an incorrect parameter count", func(t *testing.T) {
		response := ipc.invoke(backendRequest{ID: json.RawMessage(`"3"`), Method: "Login"})
		if response.Error == "" {
			t.Fatal("incorrect parameter count was accepted")
		}
	})

	t.Run("rejects malformed parameters", func(t *testing.T) {
		response := ipc.invoke(backendRequest{
			ID:     json.RawMessage(`"4"`),
			Method: "Login",
			Params: []json.RawMessage{json.RawMessage(`1`), json.RawMessage(`"user"`), json.RawMessage(`"pass"`)},
		})
		if response.Error == "" {
			t.Fatal("malformed parameter was accepted")
		}
	})
}

func TestBackendIPCServesJSONLines(t *testing.T) {
	output := &strings.Builder{}
	ipc := &backendIPC{service: &AppService{}, output: output}
	input := `{"id":"1","method":"AppVersion","params":[]}` + "\n"
	if err := ipc.serve(strings.NewReader(input)); err != nil {
		t.Fatalf("serve JSON-lines request: %v", err)
	}

	reader := bufio.NewReader(strings.NewReader(output.String()))
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read JSON-lines response: %v", err)
	}
	var response backendResponse
	if err = json.Unmarshal([]byte(line), &response); err != nil {
		t.Fatalf("decode JSON-lines response: %v", err)
	}
	if string(response.ID) != `"1"` || response.Error != "" || response.Result == nil {
		t.Fatalf("unexpected JSON-lines response: %+v", response)
	}
}
