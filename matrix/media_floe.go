// Copyright 2025 Snowflake Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Licensed under the Apache License, Version 2.0. You may obtain a copy at
// http://www.apache.org/licenses/LICENSE-2.0
//
// Copyright (c) 2026 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// This file is a decrypt-only port of the FLOE attachment support in
// mautrix-go v0.33.0 (crypto/attachment/floe.go and crypto/floe/floe.go).
// The FLOE construction is the one specified by MSC4571 and implemented by
// Snowflake Inc. Test vectors come from mautrix-go's encryptor.

package matrix

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"

	"maunium.net/go/mautrix/event"
)

// floeVersion is the Matrix file encryption version for FLOE attachments.
const floeVersion = "com.beeper.floe.v1"

const (
	floeKeyLen        = 32
	floeIVLen         = 32
	floeHeaderTagLen  = 32
	floeMessageKeyLen = 48 // SHA-384 output
	floeSegmentLen    = 4 * 1024
	floeSegmentPrefix = 4
	floeNonceLen      = 12
	floeGCMTagLen     = 16
	floeMaskBits      = 20
	floeHeaderLen     = 10 + floeIVLen + floeHeaderTagLen
)

// floeParams is the encoded parameter block at the start of a FLOE header:
// AES-256-GCM, SHA-384, 4 KiB segments, and a 32-byte IV.
var floeParams = []byte{
	0,             // AEAD: AES-256-GCM
	0,             // hash: SHA-384
	0, 0, 0x10, 0, // segment length: 4096
	0, 0, 0, 0x20, // IV length: 32
}

var (
	errFLOEKey     = errors.New("invalid FLOE key")
	errFLOEHeader  = errors.New("invalid FLOE header")
	errFLOEHash    = errors.New("FLOE ciphertext hash mismatch")
	errFLOESegment = errors.New("invalid FLOE segment")
)

// EncryptedMediaFile describes an encrypted media file in a message. It
// extends event.EncryptedFileInfo with the FLOE fields, which mautrix-go
// v0.31.0 does not parse.
type EncryptedMediaFile struct {
	event.EncryptedFileInfo
	FLOEKey    string `json:"floe_key,omitempty"`
	FLOEHeader string `json:"floe_header,omitempty"`
}

// decrypt returns the plaintext of ciphertext. FLOE returns a new slice.
// Other formats are decrypted in place.
func (f *EncryptedMediaFile) decrypt(ciphertext []byte) ([]byte, error) {
	if f.Version == floeVersion {
		return f.decryptFLOE(ciphertext)
	}
	if err := f.DecryptInPlace(ciphertext); err != nil {
		return nil, err
	}
	return ciphertext, nil
}

func (f *EncryptedMediaFile) decryptFLOE(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, fmt.Errorf("%w: empty ciphertext", errFLOESegment)
	}
	key, err := base64.RawStdEncoding.DecodeString(f.FLOEKey)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errFLOEKey, err)
	}
	if len(key) != floeKeyLen {
		return nil, fmt.Errorf("%w: length %d", errFLOEKey, len(key))
	}
	header, err := base64.RawStdEncoding.DecodeString(f.FLOEHeader)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errFLOEHeader, err)
	}
	if len(header) != floeHeaderLen || !bytes.Equal(header[:len(floeParams)], floeParams) {
		return nil, fmt.Errorf("%w: unsupported parameters or length %d", errFLOEHeader, len(header))
	}
	iv := header[len(floeParams) : len(floeParams)+floeIVLen]
	headerTag := header[len(floeParams)+floeIVLen:]
	expectedTag, err := floeKDF(key, iv, "HEADER_TAG:", floeHeaderTagLen)
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare(expectedTag, headerTag) != 1 {
		return nil, fmt.Errorf("%w: header tag does not match the key", errFLOEHeader)
	}
	if f.Hashes.SHA256 != "" {
		expectedHash, err := base64.RawStdEncoding.DecodeString(f.Hashes.SHA256)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", errFLOEHash, err)
		}
		if len(expectedHash) != sha256.Size {
			return nil, fmt.Errorf("%w: hash length %d", errFLOEHash, len(expectedHash))
		}
		actualHash := sha256.Sum256(ciphertext)
		if subtle.ConstantTimeCompare(actualHash[:], expectedHash) != 1 {
			return nil, errFLOEHash
		}
	}
	messageKey, err := floeKDF(key, iv, "MESSAGE_KEY:", floeMessageKeyLen)
	if err != nil {
		return nil, err
	}
	segments := (len(ciphertext) + floeSegmentLen - 1) / floeSegmentLen
	plaintext := make([]byte, 0, len(ciphertext))
	for index := range segments {
		start := index * floeSegmentLen
		end := min(start+floeSegmentLen, len(ciphertext))
		segment, err := floeDecryptSegment(messageKey, iv, uint64(index), ciphertext[start:end], index == segments-1)
		if err != nil {
			return nil, err
		}
		plaintext = append(plaintext, segment...)
	}
	return plaintext, nil
}

// floeKDF is FLOE's HKDF-SHA-384 derivation. The info is the encoded
// parameters, the IV, and a purpose label. FLOE uses no associated data here.
func floeKDF(key, iv []byte, purpose string, length int) ([]byte, error) {
	info := make([]byte, 0, len(floeParams)+len(iv)+len(purpose))
	info = append(info, floeParams...)
	info = append(info, iv...)
	info = append(info, purpose...)
	return hkdf.Expand(sha512.New384, key, string(info), length)
}

// floeDecryptSegment decrypts one segment. A non-final segment is exactly
// floeSegmentLen bytes and starts with 0xFFFFFFFF. The final segment starts
// with its own length. Each segment uses an AES-256-GCM key derived from its
// index, and the additional data binds the index and the final flag.
func floeDecryptSegment(messageKey, iv []byte, index uint64, segment []byte, final bool) ([]byte, error) {
	if final {
		if len(segment) < floeSegmentPrefix+floeNonceLen+floeGCMTagLen || len(segment) > floeSegmentLen {
			return nil, fmt.Errorf("%w: final segment length %d", errFLOESegment, len(segment))
		}
		if binary.BigEndian.Uint32(segment[:floeSegmentPrefix]) != uint32(len(segment)) {
			return nil, fmt.Errorf("%w: final segment length prefix", errFLOESegment)
		}
	} else if len(segment) != floeSegmentLen || binary.BigEndian.Uint32(segment[:floeSegmentPrefix]) != ^uint32(0) {
		return nil, fmt.Errorf("%w: segment %d framing", errFLOESegment, index)
	}
	// Clearing the low bits of the index means that 2^20 consecutive segments share a key.
	maskedIndex := index &^ (1<<floeMaskBits - 1)
	purpose := binary.BigEndian.AppendUint64([]byte("DEK:"), maskedIndex)
	segmentKey, err := floeKDF(messageKey, iv, string(purpose), floeKeyLen)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(segmentKey)
	if err != nil {
		return nil, err
	}
	// The nonce is read from the start of the ciphertext.
	aead, err := cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return nil, err
	}
	additionalData := binary.BigEndian.AppendUint64(nil, index)
	if final {
		additionalData = append(additionalData, 1)
	} else {
		additionalData = append(additionalData, 0)
	}
	plaintext, err := aead.Open(nil, nil, segment[floeSegmentPrefix:], additionalData)
	if err != nil {
		return nil, fmt.Errorf("%w: segment %d: %w", errFLOESegment, index, err)
	}
	return plaintext, nil
}
