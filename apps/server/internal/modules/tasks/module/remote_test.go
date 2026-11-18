package module

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/api/ownershiptest"
	"github.com/aedst/server/internal/modules/tasks/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/shared/ids"
)

func asUser(user ids.ID) context.Context {
	ctx := platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
	return platformauth.WithBearer(ctx, user.String())
}

// authenticate stands in for httpserver.AuthInterceptor on the serving side: the
// bearer token of these tests is the user id.
func authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		id, err := ids.Parse(token)
		if err != nil {
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(platformauth.WithIdentity(r.Context(), platformauth.Identity{UserID: id})))
	})
}

// serveTasks mounts the real tasks transport over svc, as cmd/server does.
func serveTasks(t *testing.T, svc tasksapi.Service) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mt := modulekit.NewMounter(mux, nil, nil, requestBytes, true)
	modulekit.Mount(mt, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(transport.NewHandler(svc)), requestBytes)
	srv := httptest.NewServer(authenticate(mux))
	t.Cleanup(srv.Close)
	return srv
}

// The in-process and the over-the-network implementation answer the same
// questions the same way: that is the property that makes tasks relocatable.
func TestOwnershipContract_InProcess(t *testing.T) {
	ownershiptest.Run(t, func(_ *testing.T, svc tasksapi.Service) (tasksapi.Ownership, func(ids.ID) context.Context) {
		return tasksapi.NewOwnership(svc), asUser
	})
}

func TestOwnershipContract_OverConnect(t *testing.T) {
	ownershiptest.Run(t, func(t *testing.T, svc tasksapi.Service) (tasksapi.Ownership, func(ids.ID) context.Context) {
		srv := serveTasks(t, svc)
		env := &modulekit.Env{}
		if err := remote(env, modulekit.RemoteTarget{Name: "tasks", BaseURL: srv.URL, HTTPClient: srv.Client()}); err != nil {
			t.Fatal(err)
		}
		own, err := modulekit.Require[tasksapi.Ownership](env)
		if err != nil {
			t.Fatal(err)
		}
		return own, asUser
	})
}

func TestRemoteOwnership_RefusesToAskOnBehalfOfSomeoneElse(t *testing.T) {
	alice, bob, task := ids.New(), ids.New(), ids.New()
	srv := serveTasks(t, ownershiptest.Service{Owned: map[ids.ID]ids.ID{task: alice}})
	env := &modulekit.Env{}
	if err := remote(env, modulekit.RemoteTarget{Name: "tasks", BaseURL: srv.URL, HTTPClient: srv.Client()}); err != nil {
		t.Fatal(err)
	}
	own, _ := modulekit.Lookup[tasksapi.Ownership](env)

	// Bob's request asks about Alice: the answer must be an error, never "true".
	if got, err := own.OwnsTask(asUser(bob), alice, task); err == nil || got {
		t.Fatalf("OwnsTask(bob asks as alice) = %v, %v; want an error and false", got, err)
	}
	// No identity at all (a background job): refused, not forwarded without a token.
	if got, err := own.OwnsTask(context.Background(), alice, task); err == nil || got {
		t.Fatalf("OwnsTask without identity = %v, %v; want an error and false", got, err)
	}
}
