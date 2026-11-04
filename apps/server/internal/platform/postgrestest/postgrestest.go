//go:build integration

// Package postgrestest starts a throwaway PostgreSQL container for
// integration tests (Testcontainers; requires Docker) and applies the
// project's goose migrations and River's schema to it. Compiled only with
// the "integration" build tag so it never reaches the server binary.
package postgrestest

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver for goose
	"github.com/pressly/goose/v3"
	tc "github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/shared/ids"
)

// serverRoot is apps/server, resolved from this file's location so tests can
// run from any package directory.
func serverRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..")
}

// / ExistingServerEnv names an environment variable holding the DSN of an
// already-running Postgres server (e.g. a CI service container, or a local
// install where Docker is unavailable). When set, NewPool creates a fresh
// throwaway database on that server per test instead of starting a container;
// the DSN's role needs CREATEDB.
const ExistingServerEnv = "AEDST_TEST_DATABASE_URL"

// NewPool starts Postgres (a Testcontainers container, or a fresh database on
// the server named by AEDST_TEST_DATABASE_URL), applies the goose migrations
// of the shared platform schema and of each named module schema (e.g. "tasks",
// "auth") plus River's schema, and returns a pool that is closed (and the
// container terminated or database dropped) when the test ends.
func NewPool(t *testing.T, modules ...string) *pgxpool.Pool {
	t.Helper()
	dsn := NewDatabase(t)
	Migrate(t, dsn, modules...)
	pool := Connect(t, dsn)
	if err := platformjobs.Migrate(context.Background(), pool); err != nil {
		t.Fatalf("apply river migrations: %v", err)
	}
	return pool
}

// NewDatabase returns the DSN of a new, empty database that is dropped (or
// whose container is terminated) when the test ends. Use it with Migrate /
// MigrateTo to test a migration in isolation.
func NewDatabase(t *testing.T) string {
	t.Helper()
	ctx := context.Background()

	if server := os.Getenv(ExistingServerEnv); server != "" {
		return createDatabase(t, ctx, server)
	}
	container, err := tcpostgres.Run(ctx, "postgres:18",
		tcpostgres.WithDatabase("aedst_test"),
		tcpostgres.WithUsername("aedst"),
		tcpostgres.WithPassword("aedst"),
		tc.WithWaitStrategy(wait.ForListeningPort("5432/tcp").WithStartupTimeout(60*time.Second)),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("container connection string: %v", err)
	}
	return dsn
}

// Connect opens a pool on dsn, closed when the test ends.
func Connect(t *testing.T, dsn string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("open pgxpool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// Migrate applies every migration of the shared platform schema and of each
// named module, in that order — exactly like `task migrate`, which applies the
// platform schema first because module migrations may depend on it.
func Migrate(t *testing.T, dsn string, modules ...string) {
	t.Helper()
	for _, module := range append([]string{"platform"}, modules...) {
		migrate(t, dsn, module, func(db *sql.DB, dir string) error { return goose.Up(db, dir) })
	}
}

// MigrateTo applies module's migrations up to and including version, leaving
// later ones pending, so a test can insert data in the old shape and then run
// the migration under test with Migrate.
func MigrateTo(t *testing.T, dsn, module string, version int64) {
	t.Helper()
	migrate(t, dsn, module, func(db *sql.DB, dir string) error { return goose.UpTo(db, dir, version) })
}

func migrate(t *testing.T, dsn, module string, run func(*sql.DB, string) error) {
	t.Helper()
	// goose's runner wants database/sql, unlike the app's pgx pool.
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open migration connection: %v", err)
	}
	defer func() { _ = sqlDB.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose.SetDialect: %v", err)
	}
	// Each module keeps its own goose version table so schemas migrate
	// independently, exactly like `task migrate`.
	goose.SetTableName("goose_" + module)
	if err := run(sqlDB, filepath.Join(serverRoot(), "migrations", module)); err != nil {
		t.Fatalf("apply %s migrations: %v", module, err)
	}
}

// createDatabase makes a uniquely named database on the server at serverDSN,
// drops it when the test ends, and returns a DSN for it.
func createDatabase(t *testing.T, ctx context.Context, serverDSN string) string {
	t.Helper()
	u, err := url.Parse(serverDSN)
	if err != nil {
		t.Fatalf("parse %s: %v", ExistingServerEnv, err)
	}
	admin, err := pgx.Connect(ctx, serverDSN)
	if err != nil {
		t.Fatalf("connect to %s: %v", ExistingServerEnv, err)
	}
	name := "aedst_test_" + strings.ReplaceAll(ids.New().String(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		_ = admin.Close(ctx)
		t.Fatalf("create test database: %v", err)
	}
	t.Cleanup(func() {
		defer func() { _ = admin.Close(context.Background()) }()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
	})

	u.Path = "/" + name
	return u.String()
}

// TryMigrateTo is MigrateTo that returns the error instead of failing the
// test, for asserting that a migration refuses to run.
func TryMigrateTo(t *testing.T, dsn, module string, version int64) error {
	t.Helper()
	sqlDB, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open migration connection: %v", err)
	}
	defer func() { _ = sqlDB.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose.SetDialect: %v", err)
	}
	goose.SetTableName("goose_" + module)
	return goose.UpTo(sqlDB, filepath.Join(serverRoot(), "migrations", module), version)
}
