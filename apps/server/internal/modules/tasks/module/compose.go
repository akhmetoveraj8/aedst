package module

import (
	"github.com/jackc/pgx/v5/pgxpool"

	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	completionapp "github.com/aedst/server/internal/modules/tasks/features/completion/application"
	completionpg "github.com/aedst/server/internal/modules/tasks/features/completion/infrastructure/postgres"
	completiontransport "github.com/aedst/server/internal/modules/tasks/features/completion/transport"
	coreapp "github.com/aedst/server/internal/modules/tasks/features/core/application"
	corepg "github.com/aedst/server/internal/modules/tasks/features/core/infrastructure/postgres"
	coretransport "github.com/aedst/server/internal/modules/tasks/features/core/transport"
	operatorapp "github.com/aedst/server/internal/modules/tasks/features/operator/application"
	operatorpg "github.com/aedst/server/internal/modules/tasks/features/operator/infrastructure/postgres"
	reminderspg "github.com/aedst/server/internal/modules/tasks/features/reminders/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/store"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// This file is where the module composes its features. Features never import
// each other, so everything that needs two of them at once lives here: the one
// api.Service, the one TasksService handler and the set of repositories. The
// aliases only give the embedded fields distinct names.
type (
	coreService       = coreapp.Service
	completionService = completionapp.Service
	coreHandler       = coretransport.Handler
	completionHandler = completiontransport.Handler
	coreRepo          = corepg.Repository
	completionRepo    = completionpg.Repository
	remindersRepo     = reminderspg.Repository
	operatorRepo      = operatorpg.Repository
)

// tasksService is api.Service: the core and the completion feature side by side.
type tasksService struct {
	*coreService
	*completionService
}

// The contract lives in api/, the implementations in the features; this is the
// one place that sees both, so the conformance checks are here.
var (
	_ tasksapi.Service         = tasksService{}
	_ tasksapi.AdminService    = (*operatorapp.AdminService)(nil)
	_ tasksapi.OperatorService = (*operatorapp.AdminService)(nil)
	_ tasksapi.Service         = cachedService{}
	_ tasksapi.AdminService    = cachedOperator{}
	_ tasksapi.OperatorService = cachedOperator{}
)

// tasksHandler serves aedst.tasks.v1.TasksService: one proto service, two features.
type tasksHandler struct {
	*coreHandler
	*completionHandler
}

func newTasksHandler(svc tasksapi.Service) tasksv1connect.TasksServiceHandler {
	return tasksHandler{coretransport.NewHandler(svc), completiontransport.NewHandler(svc)}
}

// repositories is every feature's repository over the module's one schema.
type repositories struct {
	*coreRepo
	*completionRepo
	*remindersRepo
	*operatorRepo
}

// newRepositories builds them. Request-path features use pool; the reminders
// feature runs in a River worker, so it gets jobsPool. opts carries the core
// feature's port onto reminders (corepg.WithReminders).
func newRepositories(pool, jobsPool *pgxpool.Pool, writer store.EventWriter, clock sharedtime.Clock, opts ...corepg.Option) repositories {
	events := store.NewEvents(writer, clock)
	return repositories{
		coreRepo:       corepg.NewRepository(pool, events, clock, opts...),
		completionRepo: completionpg.NewRepository(pool, events),
		remindersRepo:  reminderspg.NewRepository(jobsPool, events, clock),
		operatorRepo:   operatorpg.NewRepository(pool, events),
	}
}

func newService(repos repositories, clock sharedtime.Clock) tasksService {
	return tasksService{coreapp.NewService(repos.coreRepo, clock), completionapp.NewService(repos.completionRepo, clock)}
}
