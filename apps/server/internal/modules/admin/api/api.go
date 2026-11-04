// Package api is the admin module's public boundary. Admin is a composition
// layer: nothing depends on it (it depends on other modules' api/ packages);
// api exists for the transport and to keep the module template uniform.
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/domain"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

type (
	Actor      = domain.Actor
	AuditEntry = domain.AuditEntry
	Overview   = application.Overview
)

// Service is everything the transport can do. Authorization (the admin role)
// is enforced by httpserver.RoleInterceptor before any of this runs.
type Service interface {
	GetOverview(ctx context.Context) (Overview, error)
	ListTasks(ctx context.Context, ownerID *ids.ID, query string, pageSize int32, token string) (tasksapi.ListResult, error)
	DeleteTask(ctx context.Context, actor Actor, taskID ids.ID, reason string) error
	BroadcastNotification(ctx context.Context, actor Actor, userID *ids.ID, title, body, link string) (int64, error)
	ListAuditLog(ctx context.Context, pageSize int32, token string) ([]AuditEntry, *pagination.Cursor, error)
}

var _ Service = (*application.Service)(nil)
