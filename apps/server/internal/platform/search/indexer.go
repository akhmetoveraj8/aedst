package search

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

// IndexKind is the River job kind of an index sync.
const IndexKind = "search.index"

// IndexArgs names one record to bring in step with the engine. It carries no
// document: the worker reads the current state through the index's Source, so
// a retried or reordered job never writes stale data.
type IndexArgs struct {
	Index string `json:"index"`
	ID    string `json:"id"`
}

func (IndexArgs) Kind() string { return IndexKind }

// InsertOpts collapses pending duplicates for the same record.
func (IndexArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		MaxAttempts: 10,
		UniqueOpts: river.UniqueOpts{
			ByArgs:  true,
			ByState: []rivertype.JobState{rivertype.JobStateAvailable, rivertype.JobStateRetryable, rivertype.JobStateScheduled, rivertype.JobStatePending},
		},
	}
}

// Source loads the current search document of one record from PostgreSQL.
// found=false means the record no longer exists (or must not be searchable):
// the worker then deletes it from the engine.
type Source func(ctx context.Context, id string) (doc Document, found bool, err error)

// Registry maps an index name to its Source. Modules register theirs from
// their Setup hook; the worker resolves it at run time.
type Registry struct {
	mu      sync.RWMutex
	sources map[string]Source
}

func NewRegistry() *Registry { return &Registry{sources: map[string]Source{}} }

// Register binds index to its Source. A second registration panics: an index
// has exactly one owner module.
func (r *Registry) Register(index string, src Source) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.sources[index]; dup {
		panic(fmt.Sprintf("search: index %q registered twice", index))
	}
	r.sources[index] = src
}

func (r *Registry) source(index string) (Source, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.sources[index]
	return s, ok
}

// Worker is the River worker for IndexArgs.
type Worker struct {
	river.WorkerDefaults[IndexArgs]
	engine   Engine
	registry *Registry
}

// Timeout bounds one sync.
func (*Worker) Timeout(*river.Job[IndexArgs]) time.Duration { return 30 * time.Second }

// Work syncs one record: upsert when the Source finds it, delete otherwise.
func (w *Worker) Work(ctx context.Context, job *river.Job[IndexArgs]) error {
	src, ok := w.registry.source(job.Args.Index)
	if !ok {
		// A deploy skew (job from a newer release): drop it rather than retry forever.
		return river.JobCancel(fmt.Errorf("search: no source registered for index %q", job.Args.Index))
	}
	doc, found, err := src(ctx, job.Args.ID)
	if err != nil {
		return fmt.Errorf("search: load %s/%s: %w", job.Args.Index, job.Args.ID, err)
	}
	if !found {
		if err := w.engine.Delete(ctx, job.Args.Index, []string{job.Args.ID}); err != nil {
			return fmt.Errorf("search: delete %s/%s: %w", job.Args.Index, job.Args.ID, err)
		}
		return nil
	}
	doc["id"] = job.Args.ID
	if err := w.engine.Upsert(ctx, job.Args.Index, []Document{doc}); err != nil {
		return fmt.Errorf("search: upsert %s/%s: %w", job.Args.Index, job.Args.ID, err)
	}
	return nil
}

// NewWorker builds the worker; Register is the normal entry point.
func NewWorker(engine Engine, registry *Registry) *Worker {
	return &Worker{engine: engine, registry: registry}
}

// Register adds the index worker to workers. Call it in every process (River
// validates kinds on insert), before building the client.
func Register(workers *river.Workers, engine Engine, registry *Registry) error {
	if err := river.AddWorkerSafely(workers, NewWorker(engine, registry)); err != nil {
		return fmt.Errorf("search: add worker: %w", err)
	}
	return nil
}

// Indexer enqueues index syncs. Call EnqueueTx inside the repository's
// transaction, next to the write it reflects; never from a request handler
// on its own and never to talk to the engine directly.
type Indexer struct {
	client  *river.Client[pgx.Tx]
	enabled bool
}

// NewIndexer builds the enqueuer. With enabled=false (no engine configured)
// EnqueueTx is a no-op, so modules call it unconditionally.
func NewIndexer(client *river.Client[pgx.Tx], enabled bool) *Indexer {
	return &Indexer{client: client, enabled: enabled}
}

// EnqueueTx schedules a sync of record id in index, atomically with tx.
func (i *Indexer) EnqueueTx(ctx context.Context, tx pgx.Tx, index, id string) error {
	if !i.enabled {
		return nil
	}
	if _, err := i.client.InsertTx(ctx, tx, IndexArgs{Index: index, ID: id}, nil); err != nil {
		return fmt.Errorf("search: enqueue %s/%s: %w", index, id, err)
	}
	return nil
}
