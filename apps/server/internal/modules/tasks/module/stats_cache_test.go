package module

import (
	"context"
	"log/slog"
	"testing"
	"time"

	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/cache/cachetest"
	"github.com/aedst/server/internal/shared/ids"
)

// countingService stands in for the composed features: GetStats reports how
// many tasks the owner has and how often it was asked.
type countingService struct {
	tasksapi.Service
	tasks     map[ids.ID]int
	statReads int
}

func (s *countingService) GetStats(_ context.Context, userID ids.ID) (tasksapi.Stats, error) {
	s.statReads++
	return tasksapi.Stats{Total: s.tasks[userID]}, nil
}

func (s *countingService) CreateTask(_ context.Context, userID ids.ID, _, _ string, _ tasksapi.Priority, _ *time.Time, _ string) (tasksapi.Task, error) {
	s.tasks[userID]++
	return tasksapi.Task{}, nil
}

func (s *countingService) DeleteTask(_ context.Context, userID, _ ids.ID, _ string) error {
	s.tasks[userID]--
	return nil
}

func (s *countingService) UpdateTask(context.Context, ids.ID, ids.ID, tasksapi.Patch, *int, string) (tasksapi.Task, error) {
	return tasksapi.Task{}, nil
}

func (s *countingService) CompleteTask(context.Context, ids.ID, ids.ID) (tasksapi.Task, error) {
	return tasksapi.Task{}, nil
}

func (s *countingService) ReopenTask(context.Context, ids.ID, ids.ID) (tasksapi.Task, error) {
	return tasksapi.Task{}, nil
}

func TestCachedService_StatsAreCachedPerOwnerAndEveryWriteInvalidatesThem(t *testing.T) {
	store, _ := cachetest.NewStore(t)
	inner := &countingService{tasks: map[ids.ID]int{}}
	svc := cachedService{Service: inner, stats: newStatsCache(store, slog.New(slog.DiscardHandler))}
	ctx := context.Background()
	alice, bob := ids.New(), ids.New()

	total := func(user ids.ID) int {
		t.Helper()
		stats, err := svc.GetStats(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		return stats.Total
	}
	for _, user := range []ids.ID{alice, alice, bob} {
		if total(user) != 0 {
			t.Fatal("no tasks yet")
		}
	}
	if inner.statReads != 2 {
		t.Fatalf("stats loaded %d times, want 2 (one per owner, the repeat is a hit)", inner.statReads)
	}

	writes := map[string]func(){
		"create":   func() { _, _ = svc.CreateTask(ctx, alice, "t", "", tasksapi.PriorityLow, nil, "") },
		"update":   func() { _, _ = svc.UpdateTask(ctx, alice, ids.New(), tasksapi.Patch{}, nil, "") },
		"complete": func() { _, _ = svc.CompleteTask(ctx, alice, ids.New()) },
		"reopen":   func() { _, _ = svc.ReopenTask(ctx, alice, ids.New()) },
		"delete":   func() { _ = svc.DeleteTask(ctx, alice, ids.New(), "") },
	}
	for name, write := range writes {
		_ = total(alice) // warm
		before := inner.statReads
		write()
		if got, want := total(alice), inner.tasks[alice]; got != want {
			t.Fatalf("%s: stats total = %d after the write, want %d (read-your-write)", name, got, want)
		}
		if inner.statReads != before+1 {
			t.Fatalf("%s did not invalidate the owner's stats", name)
		}
	}
	before := inner.statReads
	if _ = total(bob); inner.statReads != before {
		t.Fatal("alice's writes must not invalidate bob's entry")
	}
}

func TestCachedService_WorksWithoutACacheAndDuringAnOutage(t *testing.T) {
	store, stop := cachetest.NewStore(t)
	stop()
	for name, svc := range map[string]cachedService{
		"no cache": {Service: &countingService{tasks: map[ids.ID]int{}}, stats: newStatsCache(nil, slog.New(slog.DiscardHandler))},
		"outage":   {Service: &countingService{tasks: map[ids.ID]int{}}, stats: newStatsCache(store, slog.New(slog.DiscardHandler))},
	} {
		user := ids.New()
		if _, err := svc.CreateTask(context.Background(), user, "t", "", tasksapi.PriorityLow, nil, ""); err != nil {
			t.Fatalf("%s: a write must not fail on the cache: %v", name, err)
		}
		stats, err := svc.GetStats(context.Background(), user)
		if err != nil || stats.Total != 1 {
			t.Fatalf("%s: GetStats = %+v, %v; want the loaded value", name, stats, err)
		}
	}
}
