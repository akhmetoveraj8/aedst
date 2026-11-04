// Package tasks adapts the tasks module's public api to the media module's
// TaskOwnership port — the only way media learns about tasks.
package tasks

import (
	"context"

	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Ownership satisfies application.TaskOwnership through tasks/api.
type Ownership struct {
	Tasks tasksapi.Service
}

func (o Ownership) OwnsTask(ctx context.Context, owner, taskID ids.ID) (bool, error) {
	_, err := o.Tasks.GetTask(ctx, owner, taskID)
	if sharederrors.KindOf(err) == sharederrors.KindNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
