package application_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/tasks/application"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type adminRepo struct {
	key   string
	id    ids.ID
	owner ids.ID
}

func (r *adminRepo) AdminList(context.Context, application.AdminListParams) (application.ListResult, error) {
	return application.ListResult{}, nil
}

func (r *adminRepo) AdminDeleteTx(context.Context, pgx.Tx, ids.ID) (ids.ID, error) {
	return r.owner, nil
}

func (r *adminRepo) AdminDeleteIdempotent(_ context.Context, key string, id ids.ID) (ids.ID, error) {
	r.key, r.id = key, id
	return r.owner, nil
}

func (r *adminRepo) AdminStats(context.Context) (application.AdminStats, error) {
	return application.AdminStats{}, nil
}

func (r *adminRepo) CountByOwners(context.Context, []ids.ID) (map[ids.ID]int64, error) {
	return nil, nil
}

func TestAdminService_OperatorDeleteNeedsAKey(t *testing.T) {
	repo := &adminRepo{owner: ids.New()}
	svc := application.NewAdminService(repo)
	task := ids.New()

	if _, err := svc.DeleteTask(context.Background(), "", task); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("no key: %v, want Validation (an unkeyed network delete could repeat)", err)
	}
	if repo.key != "" {
		t.Fatal("the repository was reached without a key")
	}
	owner, err := svc.DeleteTask(context.Background(), "audit-1", task)
	if err != nil || owner != repo.owner || repo.key != "audit-1" || repo.id != task {
		t.Fatalf("DeleteTask = %v, %v; repo saw %q %v", owner, err, repo.key, repo.id)
	}
}
