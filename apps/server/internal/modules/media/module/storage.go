package module

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
	"github.com/aedst/server/internal/platform/imgproxy"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/storage"
)

// delivery is what the media module builds from configuration: object storage,
// libvips and the imgproxy signer. Storage is optional: without a bucket
// MediaService answers FAILED_PRECONDITION and the server still starts.
type delivery struct {
	objects storage.ObjectStorage
	enabled bool
	images  *imgproxy.Signer
}

func openStorage(ctx context.Context, env *modulekit.Env) (delivery, error) {
	cfg := env.Config
	d := delivery{objects: storage.Disabled{}, enabled: cfg.Storage.Bucket != ""}
	// libvips lifecycle (build tag "vips"; a no-op stub otherwise, ADR-0015).
	stopImaging, err := processing.StartImaging()
	if err != nil {
		return d, err
	}
	env.OnClose(stopImaging)
	if d.enabled && !processing.ImagingBuiltIn {
		env.Logger.WarnContext(ctx, "media: built without libvips (-tags vips): image uploads will not process")
	}
	if cfg.Imgproxy.Enabled {
		d.images, err = imgproxy.New(imgproxy.Config{
			BaseURL: cfg.Imgproxy.URL, Bucket: cfg.Storage.Bucket, KeyHex: cfg.Imgproxy.Key, SaltHex: cfg.Imgproxy.Salt,
			TTL: time.Duration(cfg.Imgproxy.URLTTLSeconds) * time.Second,
		})
		if err != nil {
			return d, err
		}
	}
	if d.enabled {
		s3, err := storage.NewS3(ctx, storage.Config{
			Provider:        cfg.Storage.Provider,
			Endpoint:        cfg.Storage.Endpoint,
			PublicEndpoint:  cfg.Storage.PublicEndpoint,
			Region:          cfg.Storage.Region,
			Bucket:          cfg.Storage.Bucket,
			AccessKeyID:     cfg.Storage.AccessKeyID,
			SecretAccessKey: cfg.Storage.SecretAccessKey,
			PathStyle:       cfg.Storage.PathStyle,
		})
		if err != nil {
			return d, err
		}
		d.objects = s3
	}
	return d, nil
}
