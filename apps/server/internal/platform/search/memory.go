package search

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// Memory is an in-process Engine for tests: case-insensitive substring match
// over every string field. It is not a ranking model and ignores Filter.
type Memory struct {
	mu   sync.Mutex
	data map[string]map[string]Document
}

func NewMemory() *Memory { return &Memory{data: map[string]map[string]Document{}} }

func (m *Memory) Upsert(_ context.Context, index string, docs []Document) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.data[index] == nil {
		m.data[index] = map[string]Document{}
	}
	for _, d := range docs {
		id, ok := d["id"].(string)
		if !ok || id == "" {
			return errors.New("search: document without string id")
		}
		m.data[index][id] = d
	}
	return nil
}

func (m *Memory) Delete(_ context.Context, index string, ids []string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, id := range ids {
		delete(m.data[index], id)
	}
	return nil
}

func (m *Memory) Search(_ context.Context, index string, q Query) (Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	needle := strings.ToLower(q.Text)
	var hits []Document
	for _, d := range m.data[index] {
		for _, v := range d {
			if s, ok := v.(string); ok && strings.Contains(strings.ToLower(s), needle) {
				hits = append(hits, d)
				break
			}
		}
	}
	return Result{Hits: hits, Estimated: int64(len(hits))}, nil
}

func (m *Memory) Ping(context.Context) error { return nil }
