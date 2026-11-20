package matrix

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"maunium.net/go/mautrix"
	mautrixcrypto "maunium.net/go/mautrix/crypto"
	"maunium.net/go/mautrix/id"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func loadOrCreatePickleKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err == nil && len(key) == 0 {
		// A crash between create and write leaves an empty key. No data can be encrypted with it yet.
		if err = os.Remove(path); err != nil {
			return nil, fmt.Errorf("remove incomplete gomuks crypto key: %w", err)
		}
		return createPickleKey(path)
	}
	if err == nil {
		if len(key) != 32 {
			return nil, fmt.Errorf("invalid gomuks crypto key at %q: expected 32 bytes", path)
		}
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read gomuks crypto key: %w", err)
	}
	return createPickleKey(path)
}

func createPickleKey(path string) ([]byte, error) {
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate gomuks crypto key: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		key, err = os.ReadFile(path)
		if err == nil && len(key) != 32 {
			return nil, fmt.Errorf("invalid gomuks crypto key at %q: expected 32 bytes", path)
		}
		return key, err
	}
	if err != nil {
		return nil, fmt.Errorf("create gomuks crypto key: %w", err)
	}
	written, err := file.Write(key)
	if err == nil && written != len(key) {
		err = io.ErrShortWrite
	}
	if err == nil {
		err = file.Sync()
	}
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("write gomuks crypto key: %w", err)
	}
	if err = file.Close(); err != nil {
		return nil, fmt.Errorf("close gomuks crypto key: %w", err)
	}
	return key, nil
}

func ensureSecureFilePermissions(path string, mode os.FileMode) error {
	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat secured file at %q: %w", path, err)
	}
	if info.Mode().Perm() == mode.Perm() {
		return nil
	}
	if err = os.Chmod(path, mode); err != nil {
		return fmt.Errorf("secure file permissions at %q: %w", path, err)
	}
	return nil
}

func (c *Client) IsLoggedIn() bool {
	return c.engine.IsLoggedIn()
}

func (c *Client) NeedsVerification() bool {
	return c.engine.IsLoggedIn() && !c.engine.VerificationState.IsVerified
}

func (c *Client) Profile() AccountProfile {
	profile := AccountProfile{Verified: !c.NeedsVerification()}
	if account := c.engine.Account; account != nil {
		profile.UserID = string(account.UserID)
		profile.DisplayName = account.DisplayName
		profile.Homeserver = account.HomeserverURL
		profile.DeviceID = string(account.DeviceID)
		profile.AvatarURI = account.AvatarURL.String()
	}
	return profile
}

func (c *Client) Login(ctx context.Context, homeserver, username, password string) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	// LoginPassword uses gomuks' credential storage and crypto initialization.
	if err = c.engine.LoginPassword(ctx, homeserver, username, password); err != nil {
		return fmt.Errorf("Matrix login: %w", err)
	}
	if err = c.startEngine(ctx); err != nil {
		return fmt.Errorf("start Matrix sync: %w", err)
	}
	return nil
}

func (c *Client) Verify(ctx context.Context, recoveryKeyOrPassphrase string) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if err = c.engine.Verify(ctx, recoveryKeyOrPassphrase); err != nil {
		return fmt.Errorf("verify Matrix encryption keys: %w", err)
	}
	return nil
}

func (c *Client) ExportRoomKeys(ctx context.Context, passphrase string) ([]byte, error) {
	if strings.TrimSpace(passphrase) == "" {
		return nil, errors.New("key export passphrase is empty")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	export, err := mautrixcrypto.ExportKeysIter(passphrase, c.engine.CryptoStore.GetAllGroupSessions(ctx))
	if err != nil {
		if errors.Is(err, mautrixcrypto.ErrNoSessionsForExport) {
			return nil, errors.New("there are no Megolm room keys to export")
		}
		return nil, fmt.Errorf("export Megolm room keys: %w", err)
	}
	return export, nil
}

func (c *Client) ImportRoomKeys(ctx context.Context, passphrase string, data []byte) (int, int, error) {
	if strings.TrimSpace(passphrase) == "" {
		return 0, 0, errors.New("key export passphrase is empty")
	}
	if len(data) == 0 {
		return 0, 0, errors.New("key export file is empty")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer finish()
	imported, total, err := c.engine.Crypto.ImportKeys(ctx, passphrase, data)
	if err != nil {
		return imported, total, fmt.Errorf("import Megolm room keys: %w", err)
	}
	return imported, total, nil
}

func (c *Client) Devices(ctx context.Context) ([]Device, error) {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finish()
	response, err := c.engine.Client.GetDevicesInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("list Matrix devices: %w", err)
	}
	profile := c.Profile()
	devices := make([]Device, 0, len(response.Devices))
	for _, device := range response.Devices {
		deviceInfo := Device{
			ID:          string(device.DeviceID),
			DisplayName: device.DisplayName,
			LastSeenIP:  device.LastSeenIP,
			Current:     device.DeviceID.String() == profile.DeviceID,
		}
		if device.LastSeenTS > 0 {
			deviceInfo.LastSeenAt = time.UnixMilli(device.LastSeenTS)
		}
		devices = append(devices, deviceInfo)
	}
	sort.Slice(devices, func(i, j int) bool {
		if devices[i].Current != devices[j].Current {
			return devices[i].Current
		}
		return devices[i].LastSeenAt.After(devices[j].LastSeenAt)
	})
	return devices, nil
}

func (c *Client) RevokeDevice(ctx context.Context, deviceID, password string) error {
	if strings.TrimSpace(deviceID) == "" {
		return errors.New("Matrix device ID is empty")
	}
	if deviceID == c.Profile().DeviceID {
		return errors.New("cannot revoke the current device from this session")
	}
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	deleteRequest := &mautrix.ReqDeleteDevice[any]{}
	if err = c.engine.Client.DeleteDevice(ctx, id.DeviceID(deviceID), deleteRequest); err == nil {
		return nil
	}
	var apiError *mautrix.RespError
	if !errors.As(err, &apiError) {
		return fmt.Errorf("revoke Matrix device %q: %w", deviceID, err)
	}
	session, supported := passwordUIASession(apiError)
	if !supported {
		return fmt.Errorf("revoke Matrix device %q: %w", deviceID, err)
	}
	if password == "" {
		return errors.New("Matrix account password is required to revoke another device")
	}
	passwordAuth := passwordUIAAAuth{
		Type:     mautrix.AuthTypePassword,
		User:     c.Profile().UserID,
		Password: password,
		Session:  session,
	}
	deleteRequest.Auth = passwordAuth
	if err = c.engine.Client.DeleteDevice(ctx, id.DeviceID(deviceID), deleteRequest); err != nil {
		return fmt.Errorf("revoke Matrix device %q: %w", deviceID, err)
	}
	return nil
}

func passwordUIASession(apiError *mautrix.RespError) (string, bool) {
	if apiError == nil || apiError.ErrCode != "M_UNAUTHORIZED" {
		return "", false
	}
	session, ok := apiError.ExtraData["session"].(string)
	if !ok || session == "" {
		return "", false
	}
	flows, ok := apiError.ExtraData["flows"].([]any)
	if !ok {
		return "", false
	}
	for _, rawFlow := range flows {
		flow, ok := rawFlow.(map[string]any)
		if !ok {
			continue
		}
		stages, ok := flow["stages"].([]any)
		if !ok || len(stages) != 1 {
			continue
		}
		if stage, ok := stages[0].(string); ok && stage == string(mautrix.AuthTypePassword) {
			return session, true
		}
	}
	return "", false
}

func (c *Client) Logout(ctx context.Context) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	if c.engine.IsLoggedIn() {
		_, err = c.engine.Client.Logout(ctx)
	}
	finish()
	if err != nil {
		return fmt.Errorf("terminate Matrix session: %w", err)
	}
	c.Close()
	for _, path := range []string{
		c.dbPath, c.dbPath + "-wal", c.dbPath + "-shm", filepath.Join(filepath.Dir(c.dbPath), "crypto.key"),
	} {
		if removeErr := os.Remove(path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return fmt.Errorf("clear local Matrix session data at %q: %w", path, removeErr)
		}
	}
	c.mu.Lock()
	clear(c.rooms)
	clear(c.local)
	clear(c.mediaEncrypted)
	c.mu.Unlock()
	return nil
}
