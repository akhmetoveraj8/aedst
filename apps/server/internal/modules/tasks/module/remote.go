package module

import (
	"context"

	"connectrpc.com/connect/v2"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// remote binds what other units may ask of tasks to its Connect client, for a
// process that does not host tasks (AEDST_MODULE_TASKS_URL). It provides only
// the network-safe Ownership contract: the full Service and the operator
// AdminService are not available remotely, so a unit that Requires them fails
// at startup with a clear error instead of misbehaving at run time.
func remote(env *modulekit.Env, target modulekit.RemoteTarget) error {
	client := tasksv1connect.NewTasksServiceClient(modulekit.NewClient(target))
	modulekit.Provide[tasksapi.Ownership](env, remoteOwnership{client: client})
	return nil
}

// remoteOwnership implements tasksapi.Ownership over TasksService.GetTask. The
// remote unit scopes GetTask to the token's user, so the question can only be
// asked on behalf of the authenticated caller: anything else is refused here
// rather than answered about the wrong user.
type remoteOwnership struct {
	client tasksv1connect.TasksServiceClient
}

func (r remoteOwnership) OwnsTask(ctx context.Context, owner, taskID ids.ID) (bool, error) {
	if who, ok := platformauth.FromContext(ctx); !ok || who.UserID != owner {
		return false, sharederrors.Forbidden("tasks.OwnsTask", "ownership can only be asked on behalf of the authenticated user")
	}
	_, err := r.client.GetTask(ctx, &tasksv1.GetTaskRequest{Id: taskID.String()})
	switch {
	case err == nil:
		return true, nil
	case connect.CodeOf(err) == connect.CodeNotFound:
		return false, nil
	default:
		return false, modulekit.ErrorFromConnect("tasks.OwnsTask", err)
	}
}

var _ tasksapi.Ownership = remoteOwnership{}
