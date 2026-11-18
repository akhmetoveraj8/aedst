package search_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/platform/search"
)

func work(t *testing.T, w river.Worker[search.IndexArgs], args search.IndexArgs) error {
	t.Helper()
	return w.Work(context.Background(), &river.Job[search.IndexArgs]{JobRow: &rivertype.JobRow{}, Args: args})
}

func newWorker(t *testing.T, e search.Engine, r *search.Registry) river.Worker[search.IndexArgs] {
	t.Helper()
	if err := search.Register(river.NewWorkers(), e, r); err != nil {
		t.Fatal(err)
	}
	return search.NewWorker(e, r)
}

func TestWorker_UpsertsThenDeletesFollowingTheSource(t *testing.T) {
	engine, reg := search.NewMemory(), search.NewRegistry()
	exists := true
	reg.Register("tasks", func(_ context.Context, id string) (search.Document, bool, error) {
		return search.Document{"title": "Buy milk " + id}, exists, nil
	})
	w := newWorker(t, engine, reg)

	if err := work(t, w, search.IndexArgs{Index: "tasks", ID: "1"}); err != nil {
		t.Fatal(err)
	}
	res, _ := engine.Search(context.Background(), "tasks", search.Query{Text: "milk"})
	if len(res.Hits) != 1 || res.Hits[0]["id"] != "1" {
		t.Fatalf("hits = %v; want the record upserted with its id", res.Hits)
	}

	exists = false // the row is gone: a retried job must converge on deletion
	if err := work(t, w, search.IndexArgs{Index: "tasks", ID: "1"}); err != nil {
		t.Fatal(err)
	}
	if res, _ = engine.Search(context.Background(), "tasks", search.Query{Text: "milk"}); len(res.Hits) != 0 {
		t.Fatalf("hits = %v; want none after the source reports not found", res.Hits)
	}
}

func TestWorker_UnknownIndexIsCancelledNotRetried(t *testing.T) {
	w := newWorker(t, search.NewMemory(), search.NewRegistry())
	err := work(t, w, search.IndexArgs{Index: "nope", ID: "1"})
	if _, ok := errors.AsType[*river.JobCancelError](err); !ok {
		t.Fatalf("err = %v; want a JobCancel", err)
	}
}

func TestMeili_SpeaksTheMeilisearchAPI(t *testing.T) {
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/search"):
			_ = json.NewEncoder(w).Encode(map[string]any{"hits": []map[string]any{{"id": "7", "title": "x"}}, "estimatedTotalHits": 1})
		case r.URL.Path == "/health":
			_, _ = w.Write([]byte(`{"status":"available"}`))
		default:
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"taskUid":1,"indexUid":"tasks","status":"enqueued","type":"documentAdditionOrUpdate","enqueuedAt":"2026-01-01T00:00:00Z"}`))
		}
	}))
	defer srv.Close()

	m := search.NewMeili(search.MeiliConfig{URL: srv.URL})
	ctx := context.Background()
	if err := m.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if err := m.Upsert(ctx, "tasks", []search.Document{{"id": "7", "title": "x"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	res, err := m.Search(ctx, "tasks", search.Query{Text: "x"})
	if err != nil || len(res.Hits) != 1 || res.Hits[0]["id"] != "7" || res.Estimated != 1 {
		t.Fatalf("search = %+v, %v", res, err)
	}
}
