package matrix

import (
	"context"
	"errors"
	"fmt"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
)

func (c *Client) StorageUsage() (databaseBytes, walBytes int64, err error) {
	databaseInfo, err := os.Stat(c.dbPath)
	if err != nil {
		return 0, 0, fmt.Errorf("stat Matrix database: %w", err)
	}
	databaseBytes = databaseInfo.Size()
	walInfo, err := os.Stat(c.dbPath + "-wal")
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, 0, fmt.Errorf("stat Matrix database WAL: %w", err)
	}
	if err == nil {
		walBytes = walInfo.Size()
	}
	return databaseBytes, walBytes, nil
}

func (c *Client) OptimizeDatabase(ctx context.Context) error {
	ctx, finish, err := c.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finish()
	if _, err = c.engine.DB.Exec(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("optimize Matrix database: %w", err)
	}
	return nil
}
