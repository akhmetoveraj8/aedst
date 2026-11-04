package database

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func parse(t *testing.T, dsn string) *pgxpool.Config {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("ParseConfig() error = %v", err)
	}
	return cfg
}

func TestApplyPooler_PgBouncerForcesCacheDescribe(t *testing.T) {
	// Even a DSN that explicitly asks for named prepared statements must be overridden.
	cfg := parse(t, "postgres://u:p@h/db?default_query_exec_mode=cache_statement")
	applyPooler(cfg, PoolerPgBouncer)

	if got := cfg.ConnConfig.DefaultQueryExecMode; got != pgx.QueryExecModeCacheDescribe {
		t.Errorf("exec mode = %v, want QueryExecModeCacheDescribe", got)
	}
	if got := cfg.ConnConfig.StatementCacheCapacity; got != 0 {
		t.Errorf("statement cache capacity = %d, want 0 (no named statements)", got)
	}
	if got := cfg.ConnConfig.DescriptionCacheCapacity; got <= 0 {
		t.Errorf("description cache capacity = %d, want > 0 (CacheDescribe needs it)", got)
	}
}

func TestApplyPooler_NoneKeepsPgxDefaults(t *testing.T) {
	for _, p := range []Pooler{"", PoolerNone} {
		cfg := parse(t, "postgres://u:p@h/db")
		applyPooler(cfg, p)
		if got := cfg.ConnConfig.DefaultQueryExecMode; got != pgx.QueryExecModeCacheStatement {
			t.Errorf("pooler %q: exec mode = %v, want QueryExecModeCacheStatement", p, got)
		}
		if cfg.ConnConfig.StatementCacheCapacity == 0 {
			t.Errorf("pooler %q: statement cache disabled, want pgx default", p)
		}
	}
}

func TestNewDirectPool_RefusesTransactionPooler(t *testing.T) {
	_, err := NewDirectPool(context.Background(), Config{DSN: "postgres://u:p@h/db", Pooler: PoolerPgBouncer})
	if !errors.Is(err, ErrPooledConnection) {
		t.Fatalf("NewDirectPool() error = %v, want ErrPooledConnection", err)
	}
}
