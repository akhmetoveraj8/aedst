package storage

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awshttp "github.com/aws/aws-sdk-go-v2/aws/transport/http"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// Provider presets. They only change defaults (endpoint addressing style and
// region); every value can still be overridden explicitly.
const (
	ProviderS3    = "s3"
	ProviderMinIO = "minio"
	ProviderR2    = "r2"
)

// Config configures the S3-compatible client (AEDST_STORAGE_*).
type Config struct {
	Provider string
	// Endpoint is the API endpoint the server uses ("" = AWS S3 for the region).
	// MinIO: http://localhost:9000; R2: https://<account id>.r2.cloudflarestorage.com.
	Endpoint string
	// PublicEndpoint, when set, is used to presign URLs handed to clients — for
	// setups where the server reaches storage by an internal name (minio:9000)
	// that clients cannot resolve.
	PublicEndpoint string
	Region         string
	Bucket         string
	// Static credentials. Empty uses the AWS default chain (env, shared config,
	// IRSA / ECS / EC2 instance roles).
	AccessKeyID     string
	SecretAccessKey string
	// PathStyle forces path-style addressing (bucket in the path instead of the
	// host). "" picks the preset default: true for minio and r2, false for s3.
	PathStyle string
}

// S3 is the ObjectStorage implementation for AWS S3, MinIO and Cloudflare R2.
type S3 struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

var _ ObjectStorage = (*S3)(nil)

// NewS3 builds the client. It does not contact the service.
func NewS3(ctx context.Context, cfg Config) (*S3, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("storage: bucket is required")
	}
	pathStyle, region, err := presetDefaults(cfg)
	if err != nil {
		return nil, err
	}

	loadOpts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if cfg.AccessKeyID != "" || cfg.SecretAccessKey != "" {
		loadOpts = append(loadOpts, awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, loadOpts...)
	if err != nil {
		return nil, fmt.Errorf("storage: load aws config: %w", err)
	}

	build := func(endpoint string) *s3.Client {
		return s3.NewFromConfig(awsCfg, func(o *s3.Options) {
			if endpoint != "" {
				o.BaseEndpoint = aws.String(endpoint)
			}
			o.UsePathStyle = pathStyle
			// Only compute/validate checksums when an operation requires one:
			// the SDK's default extra CRC32 trailer is not implemented by every
			// S3-compatible service and is redundant over TLS.
			o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
			o.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
		})
	}
	client := build(cfg.Endpoint)
	presignClient := client
	if cfg.PublicEndpoint != "" {
		presignClient = build(cfg.PublicEndpoint)
	}
	return &S3{client: client, presign: s3.NewPresignClient(presignClient), bucket: cfg.Bucket}, nil
}

func presetDefaults(cfg Config) (pathStyle bool, region string, err error) {
	region = cfg.Region
	switch cfg.Provider {
	case ProviderS3, "":
		if region == "" {
			return false, "", errors.New("storage: AEDST_STORAGE_REGION is required for provider s3")
		}
	case ProviderMinIO:
		pathStyle = true
		if region == "" {
			region = "us-east-1"
		}
		if cfg.Endpoint == "" {
			return false, "", errors.New("storage: AEDST_STORAGE_ENDPOINT is required for provider minio")
		}
	case ProviderR2:
		pathStyle = true
		if region == "" {
			region = "auto" // R2 ignores the region but SigV4 needs one; "auto" is what Cloudflare documents.
		}
		if cfg.Endpoint == "" {
			return false, "", errors.New("storage: AEDST_STORAGE_ENDPOINT is required for provider r2 (https://<account id>.r2.cloudflarestorage.com)")
		}
	default:
		return false, "", fmt.Errorf("storage: unknown provider %q (want s3, minio or r2)", cfg.Provider)
	}
	switch strings.ToLower(cfg.PathStyle) {
	case "":
	case "true":
		pathStyle = true
	case "false":
		pathStyle = false
	default:
		return false, "", fmt.Errorf("storage: AEDST_STORAGE_PATH_STYLE must be true or false, got %q", cfg.PathStyle)
	}
	return pathStyle, region, nil
}

func (s *S3) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	in := &s3.PutObjectInput{Bucket: &s.bucket, Key: &key, Body: body, ContentType: aws.String(contentType)}
	if size >= 0 {
		in.ContentLength = aws.Int64(size)
	}
	if _, err := s.client.PutObject(ctx, in); err != nil {
		return fmt.Errorf("storage: put %s: %w", key, err)
	}
	return nil
}

func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		if isNotFound(err) {
			return nil, ObjectInfo{}, ErrNotFound
		}
		return nil, ObjectInfo{}, fmt.Errorf("storage: get %s: %w", key, err)
	}
	return out.Body, ObjectInfo{
		Key:          key,
		Size:         aws.ToInt64(out.ContentLength),
		ContentType:  aws.ToString(out.ContentType),
		ETag:         aws.ToString(out.ETag),
		LastModified: aws.ToTime(out.LastModified),
	}, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	if _, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: &s.bucket, Key: &key}); err != nil && !isNotFound(err) {
		return fmt.Errorf("storage: delete %s: %w", key, err)
	}
	return nil
}

func (s *S3) Head(ctx context.Context, key string) (ObjectInfo, error) {
	out, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: &s.bucket, Key: &key})
	if err != nil {
		if isNotFound(err) {
			return ObjectInfo{}, ErrNotFound
		}
		return ObjectInfo{}, fmt.Errorf("storage: head %s: %w", key, err)
	}
	return ObjectInfo{
		Key:          key,
		Size:         aws.ToInt64(out.ContentLength),
		ContentType:  aws.ToString(out.ContentType),
		ETag:         aws.ToString(out.ETag),
		LastModified: aws.ToTime(out.LastModified),
	}, nil
}

func (s *S3) CreateUploadURL(ctx context.Context, req UploadRequest) (PresignedRequest, error) {
	in := &s3.PutObjectInput{
		Bucket:        &s.bucket,
		Key:           &req.Key,
		ContentType:   aws.String(req.ContentType),
		ContentLength: aws.Int64(req.Size),
	}
	if len(req.SHA256) > 0 {
		in.ChecksumAlgorithm = types.ChecksumAlgorithmSha256
		in.ChecksumSHA256 = aws.String(base64.StdEncoding.EncodeToString(req.SHA256))
	}
	signed, err := s.presign.PresignPutObject(ctx, in, s3.WithPresignExpires(req.TTL))
	if err != nil {
		return PresignedRequest{}, fmt.Errorf("storage: presign put %s: %w", req.Key, err)
	}
	return PresignedRequest{
		Method:    signed.Method,
		URL:       signed.URL,
		Headers:   clientHeaders(signed.SignedHeader),
		ExpiresAt: time.Now().Add(req.TTL),
	}, nil
}

// clientHeaders keeps the signed headers a client must send itself. Host and
// Content-Length are set by every HTTP stack from the URL and the body (and
// browsers forbid setting them), but they are still signed, so a body of a
// different length is rejected by the storage service.
func clientHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for name, values := range h {
		switch http.CanonicalHeaderKey(name) {
		case "Host", "Content-Length":
			continue
		}
		if len(values) > 0 {
			out[http.CanonicalHeaderKey(name)] = values[0]
		}
	}
	return out
}

func (s *S3) CreateDownloadURL(ctx context.Context, key string, ttl time.Duration, filename string) (string, error) {
	in := &s3.GetObjectInput{Bucket: &s.bucket, Key: &key}
	if filename != "" {
		in.ResponseContentDisposition = aws.String(mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	}
	signed, err := s.presign.PresignGetObject(ctx, in, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage: presign get %s: %w", key, err)
	}
	return signed.URL, nil
}

func isNotFound(err error) bool {
	var noKey *types.NoSuchKey
	var notFound *types.NotFound
	if errors.As(err, &noKey) || errors.As(err, &notFound) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound") {
		return true
	}
	var respErr *awshttp.ResponseError
	return errors.As(err, &respErr) && respErr.HTTPStatusCode() == http.StatusNotFound
}
