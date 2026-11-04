package httpserver_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/aedst/server/internal/platform/httpserver"
)

func TestReadiness_ConcurrentProbesShareOneEvaluation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls atomic.Int64
		release := make(chan struct{})
		r := httpserver.NewReadiness(httpserver.Check{Name: "db", Fn: func(context.Context) error {
			calls.Add(1)
			<-release
			return nil
		}})

		var wg sync.WaitGroup
		codes := make(chan int, 20)
		for range 20 {
			wg.Go(func() {
				rec := httptest.NewRecorder()
				r.Handler()(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
				codes <- rec.Code
			})
		}
		synctest.Wait() // every probe is now blocked on the shared evaluation
		close(release)
		wg.Wait()
		close(codes)

		if n := calls.Load(); n != 1 {
			t.Fatalf("dependency checked %d times for 20 concurrent probes, want 1", n)
		}
		for c := range codes {
			if c != http.StatusOK {
				t.Fatalf("probe = %d, want 200", c)
			}
		}
	})
}

func TestReadiness_ResultIsReusedBrieflyThenRefreshed(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls atomic.Int64
		var failing atomic.Bool
		r := httpserver.NewReadiness(httpserver.Check{Name: "db", Fn: func(context.Context) error {
			calls.Add(1)
			if failing.Load() {
				return context.DeadlineExceeded
			}
			return nil
		}})
		probe := func() int {
			rec := httptest.NewRecorder()
			r.Handler()(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			return rec.Code
		}
		first, second := probe(), probe()
		if first != http.StatusOK || second != http.StatusOK {
			t.Fatal("healthy probes must be 200")
		}
		if calls.Load() != 1 {
			t.Fatalf("two probes inside the cache window ran %d checks, want 1", calls.Load())
		}
		failing.Store(true)
		time.Sleep(1700 * time.Millisecond) // past the cache window (virtual time inside the synctest bubble)
		if got := probe(); got != http.StatusServiceUnavailable {
			t.Fatalf("after the dependency failed and the cache expired, probe = %d, want 503", got)
		}
	})
}
