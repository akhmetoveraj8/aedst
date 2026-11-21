package cache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const (
	// keyPrefix namespaces every cache-aside key apart from the rate limiter's.
	keyPrefix = "aedst:c:"
	// defaultOpTimeout bounds one Dragonfly round trip of the cache-aside path:
	// a slow cache must cost less than the load it is meant to save.
	defaultOpTimeout = 150 * time.Millisecond

	requestsCounter = "aedst_cache_requests"
	failOpenTotal   = "aedst_cache_fail_open"
)

// Store is the byte-level store under Aside. A nil *Store is a valid, disabled
// cache: every read misses and every write is dropped, which is also what
// happens while Dragonfly is unreachable. Nothing correct may depend on it.
type Store struct {
	client    *redis.Client
	opTimeout time.Duration
	requests  metric.Int64Counter
	failOpen  metric.Int64Counter
}

// NewStore builds a Store on an existing client.
func NewStore(client *redis.Client) *Store {
	s := &Store{client: client, opTimeout: defaultOpTimeout}
	// A nil counter (instrument creation failed) only loses the metric.
	meter := otel.Meter("github.com/aedst/server/internal/platform/cache")
	s.requests, _ = meter.Int64Counter(requestsCounter,
		metric.WithDescription("Cache-aside lookups by cache name and result (hit, miss, negative_hit, error)."))
	s.failOpen, _ = meter.Int64Counter(failOpenTotal,
		metric.WithDescription("Cache operations skipped because Dragonfly returned an error or timed out, by cache name and operation."))
	return s
}

// errMiss is the internal "no such key" result.
var errMiss = errors.New("cache: miss")

func (s *Store) get(ctx context.Context, key string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, s.opTimeout)
	defer cancel()
	raw, err := s.client.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, errMiss
	}
	if err != nil {
		return nil, fmt.Errorf("cache: get: %w", err)
	}
	return raw, nil
}

func (s *Store) set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, s.opTimeout)
	defer cancel()
	if err := s.client.Set(ctx, key, value, ttl).Err(); err != nil {
		return fmt.Errorf("cache: set: %w", err)
	}
	return nil
}

func (s *Store) del(ctx context.Context, keys ...string) error {
	ctx, cancel := context.WithTimeout(ctx, s.opTimeout)
	defer cancel()
	if err := s.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("cache: del: %w", err)
	}
	return nil
}

// bump moves a tag to its next version and keeps the version key alive for ttl.
func (s *Store) bump(ctx context.Context, key string, ttl time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, s.opTimeout)
	defer cancel()
	pipe := s.client.TxPipeline()
	pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("cache: bump tag: %w", err)
	}
	return nil
}

func (s *Store) countRequest(ctx context.Context, name, result string) {
	if s.requests != nil {
		s.requests.Add(ctx, 1, metric.WithAttributes(attribute.String("cache", name), attribute.String("result", result)))
	}
}

func (s *Store) countFailOpen(ctx context.Context, name, op string) {
	if s.failOpen != nil {
		s.failOpen.Add(ctx, 1, metric.WithAttributes(attribute.String("cache", name), attribute.String("op", op)))
	}
}
