//go:build integration

package postgres_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/domain"
	"github.com/aedst/server/internal/modules/search/infrastructure/events"
	"github.com/aedst/server/internal/modules/search/infrastructure/postgres"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	platformevents "github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
)

type harness struct {
	t        *testing.T
	registry *platformevents.Registry
	svc      *application.Service
}

func newHarness(t *testing.T) harness {
	t.Helper()
	pool := postgrestest.NewPool(t, "search")
	repo := postgres.NewRepository(pool)
	registry := platformevents.NewRegistry()
	events.Subscribe(registry, pool, repo)
	return harness{t: t, registry: registry, svc: application.NewService(repo)}
}

func (h harness) publish(eventType string, payload any) {
	h.t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		h.t.Fatal(err)
	}
	if err := h.registry.Dispatch(context.Background(), platformevents.Event{ID: ids.New(), Type: eventType, Version: 1, OccurredAt: time.Now(), Payload: raw}); err != nil {
		h.t.Fatalf("publish %s: %v", eventType, err)
	}
}

func snapshot(task, user ids.ID, title, description string, version int) tasksapi.TaskSnapshot {
	return tasksapi.TaskSnapshot{TaskID: task.String(), UserID: user.String(), Title: title, Description: description, Version: version, UpdatedAt: time.Now().UTC()}
}

func TestSearch_ProjectionRankingHighlightAndScope(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	alice, bob := ids.New(), ids.New()
	rent := ids.New()
	h.publish(tasksapi.TaskCreatedEventType, snapshot(rent, alice, "Pay the rent", "Transfer the monthly rent to the landlord", 1))
	h.publish(tasksapi.TaskCreatedEventType, snapshot(ids.New(), alice, "Groceries", "milk, bread, and rent receipts", 1))
	h.publish(tasksapi.TaskCreatedEventType, snapshot(ids.New(), bob, "Bob's rent", "not visible to alice", 1))

	res, err := h.svc.Search(ctx, alice, "rent", nil, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) != 2 || res.Total != 2 {
		t.Fatalf("hits = %+v, want alice's two documents only", res.Hits)
	}
	if res.Hits[0].EntityID != rent {
		t.Errorf("a title match must outrank a body match: %+v", res.Hits)
	}
	if !strings.Contains(res.Hits[0].Snippet, domain.HighlightStart+"rent"+domain.HighlightStop) || strings.Contains(res.Hits[0].Snippet, "<b>") {
		t.Errorf("snippet %q must use the U+E000/U+E001 markers, not HTML", res.Hits[0].Snippet)
	}
	if res.Hits[0].Link != "/tasks/"+rent.String() {
		t.Errorf("link = %q", res.Hits[0].Link)
	}

	// websearch syntax: quoted phrase and negation.
	if res, err := h.svc.Search(ctx, alice, `rent -milk`, nil, 10, ""); err != nil || len(res.Hits) != 1 {
		t.Errorf("negation: %+v, %v", res.Hits, err)
	}
	if res, err := h.svc.Search(ctx, alice, `rent`, []domain.Kind{domain.KindMedia}, 10, ""); err != nil || len(res.Hits) != 0 {
		t.Errorf("kind filter: %+v, %v", res.Hits, err)
	}
}

func TestSearch_OutOfOrderEventsAndTombstones(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	user, task := ids.New(), ids.New()

	h.publish(tasksapi.TaskUpdatedEventType, snapshot(task, user, "Version two", "", 2))
	h.publish(tasksapi.TaskCreatedEventType, snapshot(task, user, "Version one", "", 1)) // late, older
	if res, _ := h.svc.Search(ctx, user, "two", nil, 10, ""); len(res.Hits) != 1 {
		t.Fatalf("newest snapshot lost to an older late event: %+v", res.Hits)
	}
	h.publish(tasksapi.TaskDeletedEventType, tasksapi.TaskDeletedEvent{TaskID: task.String(), UserID: user.String(), DeletedAt: time.Now(), Version: 3})
	h.publish(tasksapi.TaskUpdatedEventType, snapshot(task, user, "Version two", "", 2)) // redelivered old snapshot
	if res, _ := h.svc.Search(ctx, user, "two", nil, 10, ""); len(res.Hits) != 0 {
		t.Fatalf("a deleted document was resurrected: %+v", res.Hits)
	}
}

func TestSearch_KeysetPagingAndSuggest(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	user := ids.New()
	for i := range 5 {
		h.publish(tasksapi.TaskCreatedEventType, snapshot(ids.New(), user, "Deploy service "+string(rune('A'+i)), strings.Repeat("deploy ", i+1), 1))
	}
	seen := map[ids.ID]bool{}
	token := ""
	for page := 0; page < 5; page++ {
		res, err := h.svc.Search(ctx, user, "deploy", nil, 2, token)
		if err != nil {
			t.Fatal(err)
		}
		for _, hit := range res.Hits {
			if seen[hit.EntityID] {
				t.Fatalf("duplicate %s across pages", hit.EntityID)
			}
			seen[hit.EntityID] = true
		}
		if res.Next == nil {
			break
		}
		token = res.Next.Encode()
	}
	if len(seen) != 5 {
		t.Fatalf("paged through %d documents, want 5", len(seen))
	}

	got, err := h.svc.Suggest(ctx, user, "Depl", 3)
	if err != nil || len(got) != 3 || !strings.HasPrefix(got[0], "Deploy") {
		t.Fatalf("Suggest = %v, %v", got, err)
	}
	if got, err := h.svc.Suggest(ctx, user, "Deplou", 3); err != nil || len(got) == 0 {
		t.Errorf("typo-tolerant Suggest = %v, %v", got, err)
	}
	if got, _ := h.svc.Suggest(ctx, ids.New(), "Depl", 3); len(got) != 0 {
		t.Errorf("Suggest leaked another user's titles: %v", got)
	}
}
