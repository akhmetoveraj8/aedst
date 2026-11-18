//go:build integration

package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/aedst/server/internal/platform/cache"
)

// dragonflyImage must match deployments/docker/docker-compose.yml.
const dragonflyImage = "ghcr.io/dragonflydb/dragonfly:v2.1.0"

// The unit tests run the limiter against miniredis; this one proves the Lua
// script redis_rate sends (GCRA) and the go-redis client work against the real
// DragonflyDB, which is the only store the server is deployed with.
func TestRateLimiter_AgainstRealDragonfly(t *testing.T) {
	ctx := context.Background()
	ctr, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        dragonflyImage,
			ExposedPorts: []string{"6379/tcp"},
			WaitingFor:   wait.ForListeningPort("6379/tcp").WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("Docker/DragonflyDB unavailable: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })

	addr, err := ctr.PortEndpoint(ctx, "6379/tcp", "")
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}
	client := cache.NewClient(cache.Config{Addr: addr})
	t.Cleanup(func() { _ = client.Close() })
	if err := cache.Ping(ctx, client); err != nil {
		t.Fatalf("ping: %v", err)
	}

	l := cache.NewRateLimiter(client)
	for i := range 3 {
		if ok, err := l.Allow(ctx, "rl:it:a", 3, time.Minute); err != nil || !ok {
			t.Fatalf("request %d = %v, %v; want allowed", i+1, ok, err)
		}
	}
	if ok, err := l.Allow(ctx, "rl:it:a", 3, time.Minute); err != nil || ok {
		t.Fatalf("request 4 = %v, %v; want denied", ok, err)
	}
	if exhausted, err := l.Exhausted(ctx, "rl:it:a", 3, time.Minute); err != nil || !exhausted {
		t.Fatalf("Exhausted = %v, %v; want true", exhausted, err)
	}
	if ok, err := l.Allow(ctx, "rl:it:b", 3, time.Minute); err != nil || !ok {
		t.Fatalf("other key = %v, %v; want allowed", ok, err)
	}
}
