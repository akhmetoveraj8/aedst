// Command check-invalid-indexes exits non-zero when the database holds an
// INVALID index. A failed CREATE INDEX CONCURRENTLY leaves one behind: it costs
// write time on every insert and serves no query, and `CREATE INDEX ... IF NOT
// EXISTS` would silently keep it. It runs after the migrations, in the Helm
// migration Job and in `task migrate`. The DSN comes from GOOSE_DBSTRING (the
// Job's variable) or the first argument.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

var errInvalidIndexes = errors.New("invalid indexes present")

func main() {
	if err := run(); err != nil {
		slog.ErrorContext(context.Background(), "check-invalid-indexes", "err", err)
		if errors.Is(err, errInvalidIndexes) {
			os.Exit(1)
		}
		os.Exit(2)
	}
}

func run() error {
	dsn := os.Getenv("GOOSE_DBSTRING")
	if len(os.Args) > 1 {
		dsn = os.Args[1]
	}
	if dsn == "" {
		return errors.New("usage: check-invalid-indexes <dsn> (or GOOSE_DBSTRING)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	invalid, err := find(ctx, dsn)
	if err != nil {
		return err
	}
	for _, name := range invalid {
		slog.ErrorContext(ctx, "INVALID index: DROP INDEX CONCURRENTLY it, then re-run the migration", "index", name)
	}
	if len(invalid) > 0 {
		return fmt.Errorf("%w: %d", errInvalidIndexes, len(invalid))
	}
	slog.InfoContext(ctx, "no invalid indexes")
	return nil
}

func find(ctx context.Context, dsn string) ([]string, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	rows, err := conn.Query(ctx, `SELECT indexrelid::regclass::text FROM pg_index WHERE NOT indisvalid ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("query pg_index: %w", err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("read pg_index: %w", err)
	}
	return names, nil
}
