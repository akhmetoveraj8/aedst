package config

import (
	"encoding/hex"
	"net/url"
	"slices"
	"strings"
)

// ServerConfig bounds the HTTP listener (see httpserver.ServerConfig). Zero
// means "use the built-in default".
type ServerConfig struct {
	ReadHeaderTimeoutSeconds int `env:"AEDST_HTTP_READ_HEADER_TIMEOUT_SECONDS" envDefault:"5"`
	ReadTimeoutSeconds       int `env:"AEDST_HTTP_READ_TIMEOUT_SECONDS" envDefault:"30"`
	// WriteTimeoutSeconds must exceed AEDST_REQUEST_TIMEOUT_SECONDS so a
	// timed-out RPC can still be answered. Streaming RPCs clear it per request.
	WriteTimeoutSeconds int `env:"AEDST_HTTP_WRITE_TIMEOUT_SECONDS" envDefault:"60"`
	IdleTimeoutSeconds  int `env:"AEDST_HTTP_IDLE_TIMEOUT_SECONDS" envDefault:"120"`
	MaxHeaderBytes      int `env:"AEDST_HTTP_MAX_HEADER_BYTES" envDefault:"65536"`
	// TLSCertFile/TLSKeyFile enable in-process TLS (min TLS 1.2). The default
	// deployment terminates TLS at the ingress/load balancer instead.
	TLSCertFile string `env:"AEDST_TLS_CERT_FILE" envDefault:""`
	TLSKeyFile  string `env:"AEDST_TLS_KEY_FILE" envDefault:""`
	// HSTSMaxAgeSeconds is sent as Strict-Transport-Security on HTTPS
	// requests (directly or via a trusted proxy's X-Forwarded-Proto). 0 disables.
	HSTSMaxAgeSeconds int `env:"AEDST_HSTS_MAX_AGE_SECONDS" envDefault:"63072000"`
	// RequireConnectProtocolHeader rejects Connect unary requests without the
	// Connect-Protocol-Version header (CSRF defense in depth; every official
	// Connect client sends it).
	RequireConnectProtocolHeader bool `env:"AEDST_REQUIRE_CONNECT_PROTOCOL_HEADER" envDefault:"true"`
}

// JobsConfig selects which River queues this process works.
type JobsConfig struct {
	// Queues maps queue -> max concurrent workers, e.g. "default=50,media=2".
	// A dedicated media worker deployment runs "media=4" and API replicas
	// "default=50"; an empty value makes the process insert-only.
	Queues map[string]int `env:"AEDST_JOBS_QUEUES" envSeparator:"," envKeyValSeparator:"=" envDefault:"default=50,media=2"`
	// PollOnly runs River without LISTEN/NOTIFY (river.Config.PollOnly): jobs
	// are picked up by polling (slightly higher latency, more idle queries).
	// Required for the jobs pool to sit behind a transaction pooler when no
	// AEDST_DATABASE_DIRECT_DSN is available. Prefer the direct DSN.
	PollOnly bool `env:"AEDST_JOBS_POLL_ONLY" envDefault:"false"`
	// Completed/Cancelled/DiscardedRetentionHours are how long River keeps
	// finished jobs (River's cleaner deletes them afterwards). Event
	// deliveries are River jobs, so this is the retention of the event log:
	// completed ones are only kept for dedupe/inspection, discarded ones are
	// the dead-letter list and live longest.
	CompletedRetentionHours int `env:"AEDST_JOBS_COMPLETED_RETENTION_HOURS" envDefault:"24"`
	CancelledRetentionHours int `env:"AEDST_JOBS_CANCELLED_RETENTION_HOURS" envDefault:"24"`
	DiscardedRetentionHours int `env:"AEDST_JOBS_DISCARDED_RETENTION_HOURS" envDefault:"168"`
}

// KnownQueues are the River queues the server defines.
var KnownQueues = []string{"default", "media"}

// StorageConfig configures object storage (see platform/storage). Empty
// Bucket disables media uploads (MediaService answers FAILED_PRECONDITION).
type StorageConfig struct {
	Provider        string `env:"AEDST_STORAGE_PROVIDER" envDefault:"s3"`
	Endpoint        string `env:"AEDST_STORAGE_ENDPOINT" envDefault:""`
	PublicEndpoint  string `env:"AEDST_STORAGE_PUBLIC_ENDPOINT" envDefault:""`
	Region          string `env:"AEDST_STORAGE_REGION" envDefault:""`
	Bucket          string `env:"AEDST_STORAGE_BUCKET" envDefault:""`
	AccessKeyID     string `env:"AEDST_STORAGE_ACCESS_KEY_ID" envDefault:""`
	SecretAccessKey string `env:"AEDST_STORAGE_SECRET_ACCESS_KEY" envDefault:""`
	PathStyle       string `env:"AEDST_STORAGE_PATH_STYLE" envDefault:""`
	// UploadURLTTLSeconds / DownloadURLTTLSeconds bound presigned URLs.
	UploadURLTTLSeconds   int `env:"AEDST_STORAGE_UPLOAD_URL_TTL_SECONDS" envDefault:"900"`
	DownloadURLTTLSeconds int `env:"AEDST_STORAGE_DOWNLOAD_URL_TTL_SECONDS" envDefault:"3600"`
}

// PushConfig configures the push providers (see platform/push). Each one is
// disabled while its required values are empty.
type PushConfig struct {
	VAPIDPublicKey  string `env:"AEDST_PUSH_VAPID_PUBLIC_KEY" envDefault:""`
	VAPIDPrivateKey string `env:"AEDST_PUSH_VAPID_PRIVATE_KEY" envDefault:""`
	VAPIDSubject    string `env:"AEDST_PUSH_VAPID_SUBJECT" envDefault:""`

	FCMCredentialsJSON string `env:"AEDST_PUSH_FCM_CREDENTIALS_JSON" envDefault:""`
	FCMCredentialsFile string `env:"AEDST_PUSH_FCM_CREDENTIALS_FILE" envDefault:""`
	FCMProjectID       string `env:"AEDST_PUSH_FCM_PROJECT_ID" envDefault:""`

	APNsKeyID          string `env:"AEDST_PUSH_APNS_KEY_ID" envDefault:""`
	APNsTeamID         string `env:"AEDST_PUSH_APNS_TEAM_ID" envDefault:""`
	APNsPrivateKey     string `env:"AEDST_PUSH_APNS_PRIVATE_KEY" envDefault:""`
	APNsPrivateKeyFile string `env:"AEDST_PUSH_APNS_PRIVATE_KEY_FILE" envDefault:""`
	APNsTopic          string `env:"AEDST_PUSH_APNS_TOPIC" envDefault:""`

	TimeoutSeconds int `env:"AEDST_PUSH_TIMEOUT_SECONDS" envDefault:"10"`
}

func (p PushConfig) WebPushEnabled() bool { return p.VAPIDPrivateKey != "" }
func (p PushConfig) FCMEnabled() bool {
	return p.FCMCredentialsJSON != "" || p.FCMCredentialsFile != ""
}

func (p PushConfig) APNsEnabled() bool {
	return p.APNsKeyID != "" && (p.APNsPrivateKey != "" || p.APNsPrivateKeyFile != "")
}

// MediaConfig bounds uploads and processing.
type MediaConfig struct {
	MaxImageBytes    int64 `env:"AEDST_MEDIA_MAX_IMAGE_BYTES" envDefault:"20971520"`
	MaxVideoBytes    int64 `env:"AEDST_MEDIA_MAX_VIDEO_BYTES" envDefault:"524288000"`
	MaxAudioBytes    int64 `env:"AEDST_MEDIA_MAX_AUDIO_BYTES" envDefault:"104857600"`
	MaxDocumentBytes int64 `env:"AEDST_MEDIA_MAX_DOCUMENT_BYTES" envDefault:"52428800"`
	// MaxImagePixels guards against decompression bombs.
	MaxImagePixels int64 `env:"AEDST_MEDIA_MAX_IMAGE_PIXELS" envDefault:"50000000"`
	// FFmpegPath / FFprobePath enable video posters and audio/video metadata.
	FFmpegPath  string `env:"AEDST_MEDIA_FFMPEG_PATH" envDefault:""`
	FFprobePath string `env:"AEDST_MEDIA_FFPROBE_PATH" envDefault:""`
	// ProcessTimeoutSeconds bounds one external ffmpeg/ffprobe invocation.
	ProcessTimeoutSeconds int `env:"AEDST_MEDIA_PROCESS_TIMEOUT_SECONDS" envDefault:"120"`
	// PendingUploadTTLHours is how long a PENDING_UPLOAD row (and any object
	// uploaded for it) lives before the retention job removes it.
	PendingUploadTTLHours int `env:"AEDST_MEDIA_PENDING_UPLOAD_TTL_HOURS" envDefault:"24"`
}

// ImgproxyConfig enables signed imgproxy delivery URLs for image renditions
// (ADR-0015). Disabled by default: clients then use the original URL. The
// key and salt are the same hex values imgproxy runs with (IMGPROXY_KEY /
// IMGPROXY_SALT); the bucket imgproxy reads is AEDST_STORAGE_BUCKET.
type ImgproxyConfig struct {
	Enabled bool   `env:"AEDST_IMGPROXY_ENABLED" envDefault:"false"`
	URL     string `env:"AEDST_IMGPROXY_URL" envDefault:""`
	Key     string `env:"AEDST_IMGPROXY_KEY" envDefault:""`
	Salt    string `env:"AEDST_IMGPROXY_SALT" envDefault:""`
	// URLTTLSeconds is how long a signed URL stays valid (rounded to a window
	// so CDNs can cache); 0 = never expires.
	URLTTLSeconds int `env:"AEDST_IMGPROXY_URL_TTL_SECONDS" envDefault:"3600"`
}

// IntegrityConfig configures Google Play Integrity verification (STANDARD API,
// modules/integrity). Disabled by default: IntegrityService answers
// FAILED_PRECONDITION and nothing is contacted.
type IntegrityConfig struct {
	Enabled bool `env:"AEDST_INTEGRITY_ENABLED" envDefault:"false"`
	// AllowedPackages are the accepted applicationIds (release, debug, ...).
	AllowedPackages []string `env:"AEDST_INTEGRITY_ALLOWED_PACKAGES" envSeparator:"," envDefault:""`
	// CredentialsJSON / CredentialsFile: a service-account key for the Cloud
	// project linked in Play Console. Both empty = Application Default Credentials.
	CredentialsJSON string `env:"AEDST_INTEGRITY_CREDENTIALS_JSON" envDefault:""`
	CredentialsFile string `env:"AEDST_INTEGRITY_CREDENTIALS_FILE" envDefault:""`
	// MaxTokenAgeSeconds is the freshness window; MaxFutureSkewSeconds how far
	// ahead of the server clock a token timestamp may be.
	MaxTokenAgeSeconds   int `env:"AEDST_INTEGRITY_MAX_TOKEN_AGE_SECONDS" envDefault:"300"`
	MaxFutureSkewSeconds int `env:"AEDST_INTEGRITY_MAX_FUTURE_SKEW_SECONDS" envDefault:"30"`
	// MinDeviceLevel: basic | device | strong.
	MinDeviceLevel string `env:"AEDST_INTEGRITY_MIN_DEVICE_LEVEL" envDefault:"device"`
	// RequirePlayRecognized demands appRecognitionVerdict PLAY_RECOGNIZED
	// (set false for sideloaded or internal builds).
	RequirePlayRecognized bool `env:"AEDST_INTEGRITY_REQUIRE_PLAY_RECOGNIZED" envDefault:"true"`
	// RequireLicensed demands appLicensingVerdict LICENSED (paid apps).
	RequireLicensed bool `env:"AEDST_INTEGRITY_REQUIRE_LICENSED" envDefault:"false"`
	// AllowTestingResponses accepts Play Console tester responses. Rejected in
	// production and staging.
	AllowTestingResponses bool `env:"AEDST_INTEGRITY_ALLOW_TESTING_RESPONSES" envDefault:"false"`
	// RateLimitPerMinute is the per-user verification budget (Google's decode
	// quota is shared by every user). 0 disables.
	RateLimitPerMinute int `env:"AEDST_INTEGRITY_RATE_LIMIT_PER_MINUTE" envDefault:"10"`
	// TimeoutSeconds bounds one call to Google.
	TimeoutSeconds int `env:"AEDST_INTEGRITY_TIMEOUT_SECONDS" envDefault:"10"`
}

// TasksConfig tunes the tasks module.
type TasksConfig struct {
	// DueSoonLeadMinutes is how long before a task's due date TASK_DUE_SOON fires.
	DueSoonLeadMinutes int `env:"AEDST_TASKS_DUE_SOON_LEAD_MINUTES" envDefault:"60"`
}

func (c Config) validateFeatures(bad func(string, ...any)) {
	s := c.Server
	if s.ReadHeaderTimeoutSeconds < 0 || s.ReadTimeoutSeconds < 0 || s.WriteTimeoutSeconds < 0 || s.IdleTimeoutSeconds < 0 || s.MaxHeaderBytes < 0 || s.HSTSMaxAgeSeconds < 0 {
		bad("AEDST_HTTP_* timeouts/limits and AEDST_HSTS_MAX_AGE_SECONDS must not be negative")
	}
	if s.WriteTimeoutSeconds > 0 && s.WriteTimeoutSeconds <= c.HTTP.RequestTimeout {
		bad("AEDST_HTTP_WRITE_TIMEOUT_SECONDS (%d) must exceed AEDST_REQUEST_TIMEOUT_SECONDS (%d), or timed-out RPCs cannot be answered", s.WriteTimeoutSeconds, c.HTTP.RequestTimeout)
	}
	if (s.TLSCertFile == "") != (s.TLSKeyFile == "") {
		bad("AEDST_TLS_CERT_FILE and AEDST_TLS_KEY_FILE must be set together")
	}
	for _, origin := range c.HTTP.AllowedOrigins {
		if origin == "*" {
			continue // rejected in deployed environments above
		}
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") {
			bad("AEDST_CORS_ALLOWED_ORIGINS: %q is not an origin (scheme://host[:port])", origin)
		}
	}
	for queue, workers := range c.Jobs.Queues {
		if !slices.Contains(KnownQueues, queue) {
			bad("AEDST_JOBS_QUEUES: unknown queue %q (want one of %v)", queue, KnownQueues)
		}
		if workers <= 0 {
			bad("AEDST_JOBS_QUEUES: queue %q needs a positive worker count", queue)
		}
	}
	if c.Storage.Bucket != "" {
		switch c.Storage.Provider {
		case "s3", "minio", "r2":
		default:
			bad("AEDST_STORAGE_PROVIDER %q must be s3, minio or r2", c.Storage.Provider)
		}
		if c.Storage.UploadURLTTLSeconds <= 0 || c.Storage.DownloadURLTTLSeconds <= 0 {
			bad("AEDST_STORAGE_*_URL_TTL_SECONDS must be positive")
		}
		if c.Env.IsDeployed() && strings.HasPrefix(c.Storage.PublicEndpoint, "http://") {
			bad("AEDST_STORAGE_PUBLIC_ENDPOINT must use https in %s", c.Env)
		}
	}
	if c.Push.WebPushEnabled() && c.Push.VAPIDSubject == "" {
		bad("AEDST_PUSH_VAPID_SUBJECT (mailto: or https: contact) is required with AEDST_PUSH_VAPID_PRIVATE_KEY")
	}
	if c.Push.APNsEnabled() && c.Push.APNsTeamID == "" {
		bad("AEDST_PUSH_APNS_TEAM_ID is required with AEDST_PUSH_APNS_KEY_ID")
	}
	if im := c.Imgproxy; im.Enabled {
		if c.Storage.Bucket == "" {
			bad("AEDST_IMGPROXY_ENABLED requires AEDST_STORAGE_BUCKET")
		}
		if u, err := url.Parse(im.URL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			bad("AEDST_IMGPROXY_URL must be an absolute http(s) URL")
		} else if c.Env.IsDeployed() && u.Scheme != "https" {
			bad("AEDST_IMGPROXY_URL must use https in %s", c.Env)
		}
		if _, err := hex.DecodeString(im.Key); err != nil || im.Key == "" {
			bad("AEDST_IMGPROXY_KEY must be non-empty hex")
		}
		if _, err := hex.DecodeString(im.Salt); err != nil || im.Salt == "" {
			bad("AEDST_IMGPROXY_SALT must be non-empty hex")
		}
		if im.URLTTLSeconds < 0 {
			bad("AEDST_IMGPROXY_URL_TTL_SECONDS must not be negative")
		}
	}
	m := c.Media
	if m.MaxImageBytes < 0 || m.MaxVideoBytes < 0 || m.MaxAudioBytes < 0 || m.MaxDocumentBytes < 0 || m.MaxImagePixels < 0 || m.ProcessTimeoutSeconds < 0 || m.PendingUploadTTLHours < 0 {
		bad("AEDST_MEDIA_* limits must not be negative")
	}
	if in := c.Integrity; in.Enabled {
		if len(in.AllowedPackages) == 0 {
			bad("AEDST_INTEGRITY_ENABLED requires AEDST_INTEGRITY_ALLOWED_PACKAGES")
		}
		if in.MaxTokenAgeSeconds <= 0 || in.MaxFutureSkewSeconds < 0 || in.RateLimitPerMinute < 0 || in.TimeoutSeconds <= 0 {
			bad("AEDST_INTEGRITY_*_SECONDS must be positive (skew and rate limit may be 0) and the rate limit must not be negative")
		}
		switch strings.ToLower(in.MinDeviceLevel) {
		case "basic", "device", "strong":
		default:
			bad("AEDST_INTEGRITY_MIN_DEVICE_LEVEL %q must be basic, device or strong", in.MinDeviceLevel)
		}
		if c.Env.IsDeployed() && in.AllowTestingResponses {
			bad("AEDST_INTEGRITY_ALLOW_TESTING_RESPONSES must be false in %s", c.Env)
		}
	}
	if c.Tasks.DueSoonLeadMinutes < 0 {
		bad("AEDST_TASKS_DUE_SOON_LEAD_MINUTES must not be negative")
	}
	if c.Retention.AuditDays < 0 {
		bad("AEDST_RETENTION_AUDIT_DAYS must not be negative")
	}
}
