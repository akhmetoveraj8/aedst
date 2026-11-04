// Package module registers the media module with the composition root
// (internal/platform/modulekit): presigned direct uploads; image/video
// processing on the "media" River queue. Media reaches tasks only through
// tasks/api (the TaskOwnership port).
package module

import (
	"context"
	"time"

	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	mediav1 "github.com/aedst/server/gen/go/aedst/media/v1"
	mediav1connect "github.com/aedst/server/gen/go/aedst/media/v1/mediav1connect"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	"github.com/aedst/server/internal/modules/media/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
	mediatasks "github.com/aedst/server/internal/modules/media/infrastructure/tasks"
	"github.com/aedst/server/internal/modules/media/transport"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

const smallRequestBytes = 64 << 10

func init() {
	m := &mediaModule{}
	modulekit.Register(modulekit.Module{
		Name:     "media",
		Requires: []string{"tasks"},
		Files:    []protoreflect.FileDescriptor{mediav1.File_aedst_media_v1_media_proto},
		Retention: func(env *modulekit.Env) []retention.Policy {
			return []retention.Policy{{
				Name:      "media.pending_uploads",
				Retention: time.Duration(env.Config.Media.PendingUploadTTLHours) * time.Hour,
				// m.jobsRepo is bound in Setup, after the River client exists
				// (it enqueues object cleanup); retention first runs after that.
				Purge: func(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
					return m.jobsRepo.PurgeAbandoned(ctx, cutoff, limit)
				},
			}}
		},
		Setup: m.setup,
		Mount: m.mount,
	})
}

type mediaModule struct {
	jobsRepo *postgres.Repository
	svc      mediaapi.Service
}

func (m *mediaModule) setup(ctx context.Context, env *modulekit.Env) error {
	cfg := env.Config
	tasks, err := modulekit.Require[tasksapi.Service](env)
	if err != nil {
		return err
	}
	d, err := openStorage(ctx, env)
	if err != nil {
		return err
	}
	repo := postgres.NewRepository(env.Pool, env.Jobs, env.Publisher, env.Clock)
	m.jobsRepo = postgres.NewRepository(env.JobsPool, env.Jobs, env.Publisher, env.Clock)
	river.AddWorker(env.Workers, processing.NewWorker(m.jobsRepo, d.objects, processing.Config{
		MaxImagePixels: cfg.Media.MaxImagePixels,
		MaxImageBytes:  cfg.Media.MaxImageBytes,
		FFmpeg: processing.FFmpeg{
			FFmpegPath:  cfg.Media.FFmpegPath,
			FFprobePath: cfg.Media.FFprobePath,
			Timeout:     time.Duration(cfg.Media.ProcessTimeoutSeconds) * time.Second,
		},
	}, env.Logger))
	river.AddWorker(env.Workers, processing.NewDeleteWorker(d.objects))
	svc := application.NewService(repo, d.objects, mediatasks.Ownership{Tasks: tasks}, env.Clock, application.Config{
		Limits: domain.Limits{
			MaxImageBytes: cfg.Media.MaxImageBytes, MaxVideoBytes: cfg.Media.MaxVideoBytes,
			MaxAudioBytes: cfg.Media.MaxAudioBytes, MaxDocumentBytes: cfg.Media.MaxDocumentBytes,
		},
		UploadURLTTL:   time.Duration(cfg.Storage.UploadURLTTLSeconds) * time.Second,
		DownloadURLTTL: time.Duration(cfg.Storage.DownloadURLTTLSeconds) * time.Second,
		Delivery:       d.images,
	}, d.enabled)
	m.svc = svc
	modulekit.Provide[mediaapi.Stats](env, svc)
	return nil
}

func (m *mediaModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, mediav1connect.RegisterMediaServiceHandler, mediav1connect.MediaServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
