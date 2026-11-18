package search

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/meilisearch/meilisearch-go"
)

// MeiliConfig configures the Meilisearch engine.
type MeiliConfig struct {
	URL    string
	APIKey string
	// Timeout bounds every call (default 5s).
	Timeout time.Duration
}

// Meili is the Meilisearch implementation of Engine.
type Meili struct {
	sm meilisearch.ServiceManager
}

// NewMeili builds the engine. It does not connect.
func NewMeili(cfg MeiliConfig) *Meili {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 5 * time.Second
	}
	opts := []meilisearch.Option{meilisearch.WithCustomClient(&http.Client{Timeout: cfg.Timeout})}
	if cfg.APIKey != "" {
		opts = append(opts, meilisearch.WithAPIKey(cfg.APIKey))
	}
	return &Meili{sm: meilisearch.New(cfg.URL, opts...)}
}

func (m *Meili) Upsert(ctx context.Context, index string, docs []Document) error {
	if len(docs) == 0 {
		return nil
	}
	pk := "id"
	if _, err := m.sm.Index(index).AddDocuments(ctx, docs, &meilisearch.DocumentOptions{PrimaryKey: &pk}); err != nil {
		return fmt.Errorf("search: upsert %s: %w", index, err)
	}
	return nil
}

func (m *Meili) Delete(ctx context.Context, index string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if _, err := m.sm.Index(index).DeleteDocuments(ctx, ids, nil); err != nil {
		return fmt.Errorf("search: delete %s: %w", index, err)
	}
	return nil
}

func (m *Meili) Search(ctx context.Context, index string, q Query) (Result, error) {
	req := &meilisearch.SearchRequest{Limit: int64(q.Limit), Offset: int64(q.Offset)}
	if q.Filter != "" {
		req.Filter = q.Filter
	}
	resp, err := m.sm.Index(index).Search(ctx, q.Text, req)
	if err != nil {
		return Result{}, fmt.Errorf("search: query %s: %w", index, err)
	}
	var hits []Document
	if err := resp.Hits.DecodeInto(&hits); err != nil {
		return Result{}, fmt.Errorf("search: decode hits: %w", err)
	}
	return Result{Hits: hits, Estimated: resp.EstimatedTotalHits}, nil
}

func (m *Meili) Ping(ctx context.Context) error {
	if _, err := m.sm.Health(ctx); err != nil {
		return fmt.Errorf("search: ping: %w", err)
	}
	return nil
}
