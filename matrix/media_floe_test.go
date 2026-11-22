package matrix

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// floeVector is a FLOE test vector produced by mautrix-go v0.33.0's
// attachment.FLOEFile.Encrypt, using plaintext byte(i % 251).
type floeVector struct {
	Name         string          `json:"name"`
	PlaintextLen int             `json:"plaintext_len"`
	File         json.RawMessage `json:"file"`
	Ciphertext   string          `json:"ciphertext"`
}

func loadFLOEVectors(t *testing.T) []floeVector {
	t.Helper()
	data, err := os.ReadFile("testdata/floe_v1_vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var vectors []floeVector
	if err = json.Unmarshal(data, &vectors); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	return vectors
}

func floeVectorWithPlaintextLen(t *testing.T, size int) floeVector {
	t.Helper()
	for _, vector := range loadFLOEVectors(t) {
		if vector.PlaintextLen == size {
			return vector
		}
	}
	t.Fatalf("no FLOE vector with plaintext length %d", size)
	return floeVector{}
}

// floeVectorPlaintext returns the plaintext used by the vector generator.
func floeVectorPlaintext(size int) []byte {
	plaintext := make([]byte, size)
	for i := range plaintext {
		plaintext[i] = byte(i % 251)
	}
	return plaintext
}

// decodeFLOEVector returns a fresh file descriptor and ciphertext for a vector.
func decodeFLOEVector(t *testing.T, vector floeVector) (*EncryptedMediaFile, []byte) {
	t.Helper()
	var file EncryptedMediaFile
	if err := json.Unmarshal(vector.File, &file); err != nil {
		t.Fatalf("parse file: %v", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(vector.Ciphertext)
	if err != nil {
		t.Fatalf("decode ciphertext: %v", err)
	}
	return &file, ciphertext
}

func mutateFLOEHeader(t *testing.T, file *EncryptedMediaFile, mutate func(header []byte)) {
	t.Helper()
	header, err := base64.RawStdEncoding.DecodeString(file.FLOEHeader)
	if err != nil {
		t.Fatalf("decode header: %v", err)
	}
	mutate(header)
	file.FLOEHeader = base64.RawStdEncoding.EncodeToString(header)
}

func TestFLOEDecryptMatchesReferenceVectors(t *testing.T) {
	for _, vector := range loadFLOEVectors(t) {
		t.Run(vector.Name, func(t *testing.T) {
			file, ciphertext := decodeFLOEVector(t, vector)
			got, err := file.decrypt(ciphertext)
			if err != nil {
				t.Fatalf("decrypt: %v", err)
			}
			if want := floeVectorPlaintext(vector.PlaintextLen); !bytes.Equal(got, want) {
				t.Fatalf("plaintext mismatch: got %d bytes, want %d", len(got), len(want))
			}
		})
	}
}

func TestFLOEDecryptRejectsHashMismatch(t *testing.T) {
	file, ciphertext := decodeFLOEVector(t, floeVectorWithPlaintextLen(t, 4164))
	file.Hashes.SHA256 = base64.RawStdEncoding.EncodeToString(make([]byte, 32))
	if _, err := file.decrypt(ciphertext); !errors.Is(err, errFLOEHash) {
		t.Fatalf("error = %v, want %v", err, errFLOEHash)
	}
}

func TestFLOEDecryptRejectsTampering(t *testing.T) {
	vector := floeVectorWithPlaintextLen(t, 4164)
	otherFile, _ := decodeFLOEVector(t, floeVectorWithPlaintextLen(t, 0))

	tests := []struct {
		name    string
		mutate  func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte
		wantErr error
	}{
		{
			name: "empty ciphertext",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				return nil
			},
			wantErr: errFLOESegment,
		},
		{
			name: "flipped byte in first segment",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				ciphertext[100] ^= 1
				return ciphertext
			},
			wantErr: errFLOESegment,
		},
		{
			name: "flipped byte in final segment",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				ciphertext[len(ciphertext)-1] ^= 1
				return ciphertext
			},
			wantErr: errFLOESegment,
		},
		{
			name: "dropped final segment",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				return ciphertext[:4096]
			},
			wantErr: errFLOESegment,
		},
		{
			name: "truncated final segment",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				return ciphertext[:len(ciphertext)-1]
			},
			wantErr: errFLOESegment,
		},
		{
			name: "appended trailing byte",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				return append(ciphertext, 0)
			},
			wantErr: errFLOESegment,
		},
		{
			name: "flipped byte in header IV",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				mutateFLOEHeader(t, file, func(header []byte) { header[10] ^= 1 })
				return ciphertext
			},
			wantErr: errFLOEHeader,
		},
		{
			name: "flipped byte in header tag",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				mutateFLOEHeader(t, file, func(header []byte) { header[len(header)-1] ^= 1 })
				return ciphertext
			},
			wantErr: errFLOEHeader,
		},
		{
			name: "unsupported header parameters",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				mutateFLOEHeader(t, file, func(header []byte) { header[4] = 0x20 })
				return ciphertext
			},
			wantErr: errFLOEHeader,
		},
		{
			name: "key from another file",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				file.FLOEKey = otherFile.FLOEKey
				return ciphertext
			},
			wantErr: errFLOEHeader,
		},
		{
			name: "malformed key",
			mutate: func(t *testing.T, file *EncryptedMediaFile, ciphertext []byte) []byte {
				file.FLOEKey = "!!!"
				return ciphertext
			},
			wantErr: errFLOEKey,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file, ciphertext := decodeFLOEVector(t, vector)
			// Clear the hash so that the header and segment checks are exercised.
			file.Hashes.SHA256 = ""
			ciphertext = tt.mutate(t, file, ciphertext)
			if _, err := file.decrypt(ciphertext); !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
