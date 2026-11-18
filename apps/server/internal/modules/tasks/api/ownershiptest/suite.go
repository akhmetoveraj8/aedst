// Package ownershiptest is the contract suite for tasksapi.Ownership. Every
// implementation (in-process, Connect client) must pass the same cases, which is
// how "the unit behaves the same wherever it runs" is enforced rather than hoped.
package ownershiptest

import (
	"context"
	"testing"

	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Service is a tasksapi.Service holding fixed tasks: GetTask is owner-scoped like
// the real one, everything else is unimplemented (nil embedded interface panics,
// so a contract that grows a dependency on another method fails loudly).
type Service struct {
	tasksapi.Service
	// Owned maps task id to its owner.
	Owned map[ids.ID]ids.ID
}

// GetTask returns the task when owner owns it and NotFound otherwise.
func (s Service) GetTask(_ context.Context, owner, id ids.ID) (tasksapi.Task, error) {
	if s.Owned[id] != owner {
		return tasksapi.Task{}, sharederrors.NotFound("tasks.Get", "task not found")
	}
	return tasksapi.Task{ID: id, UserID: owner, Title: "t"}, nil
}

// Factory builds the implementation under test. as returns a context that
// carries the identity of user, the way a request does (the in-process version
// ignores it; the Connect version forwards it as the bearer token).
type Factory func(t *testing.T, svc tasksapi.Service) (impl tasksapi.Ownership, as func(user ids.ID) context.Context)

// Run executes the contract against the implementation newImpl builds.
func Run(t *testing.T, newImpl Factory) {
	t.Helper()
	alice, bob := ids.New(), ids.New()
	aliceTask, bobTask, missing := ids.New(), ids.New(), ids.New()
	svc := Service{Owned: map[ids.ID]ids.ID{aliceTask: alice, bobTask: bob}}
	impl, as := newImpl(t, svc)

	cases := []struct {
		name  string
		owner ids.ID
		task  ids.ID
		want  bool
	}{
		{"owner owns their task", alice, aliceTask, true},
		{"another user's task is not owned", alice, bobTask, false},
		{"a task that does not exist is not owned", alice, missing, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := impl.OwnsTask(as(tc.owner), tc.owner, tc.task)
			if err != nil {
				t.Fatalf("OwnsTask: %v", err)
			}
			if got != tc.want {
				t.Fatalf("OwnsTask = %v, want %v", got, tc.want)
			}
		})
	}
}
