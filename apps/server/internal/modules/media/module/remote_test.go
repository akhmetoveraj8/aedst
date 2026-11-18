package module

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	mediav1connect "github.com/aedst/server/gen/go/aedst/media/v1/mediav1connect"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/modules/media/transport"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

type fakeStats struct {
	count, bytes int64
	err          error
}

func (f fakeStats) Totals(context.Context) (int64, int64, error) { return f.count, f.bytes, f.err }

func remoteStatsFor(t *testing.T, s mediaapi.Stats) mediaapi.Stats {
	t.Helper()
	mux := http.NewServeMux()
	mt := modulekit.NewMounter(mux, nil, nil, smallRequestBytes, true)
	modulekit.Mount(mt, mediav1connect.RegisterMediaOperatorServiceHandler, mediav1connect.MediaOperatorServiceHandler(transport.NewOperatorHandler(s)), smallRequestBytes)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	env := &modulekit.Env{}
	if err := remote(env, modulekit.RemoteTarget{Name: "media", BaseURL: srv.URL, HTTPClient: srv.Client()}); err != nil {
		t.Fatal(err)
	}
	got, err := modulekit.Require[mediaapi.Stats](env)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// The in-process and the over-the-network Stats answer the same way, so admin's
// overview does not care where media runs.
func TestRemoteStats_MatchesInProcess(t *testing.T) {
	remote := remoteStatsFor(t, fakeStats{count: 12, bytes: 3456})
	count, bytes, err := remote.Totals(t.Context())
	if err != nil || count != 12 || bytes != 3456 {
		t.Fatalf("Totals = %d, %d, %v", count, bytes, err)
	}
}

func TestRemoteStats_ErrorsKeepTheirKind(t *testing.T) {
	remote := remoteStatsFor(t, fakeStats{err: sharederrors.Forbidden("media.Totals", "no")})
	_, _, err := remote.Totals(t.Context())
	if sharederrors.KindOf(err) != sharederrors.KindForbidden || errors.Is(err, nil) {
		t.Fatalf("err = %v, want Forbidden", err)
	}
}

func TestOperatorRolesAreClosedToOrdinaryUsers(t *testing.T) {
	roles := operatorRoles()["/aedst.media.v1.MediaOperatorService/*"]
	for _, r := range roles {
		if r == "" || r == "user" {
			t.Fatalf("roles = %v", roles)
		}
	}
	if len(roles) == 0 {
		t.Fatal("the operator service must be role-gated")
	}
}
