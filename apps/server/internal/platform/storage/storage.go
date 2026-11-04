// Package storage is the object-storage port every module uses for files
// (uploads, variants, exports). Bytes of user uploads never pass through the
// API: clients PUT to a presigned URL from CreateUploadURL and read through a
// presigned URL from CreateDownloadURL. The server itself only reads or
// writes objects in background jobs (media processing).
//
// There is ONE implementation for production, S3 (s3.go, aws-sdk-go-v2),
// which also speaks to MinIO and Cloudflare R2 through provider presets
// (AEDST_STORAGE_PROVIDER = s3 | minio | r2), plus an in-memory fake
// (memory.go) for tests.
package storage

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotFound is returned by Head and Get when the object does not exist.
var ErrNotFound = errors.New("storage: object not found")

// ErrDisabled is returned by every method of Disabled.
var ErrDisabled = errors.New("storage: object storage is not configured (AEDST_STORAGE_BUCKET)")

// ObjectInfo describes a stored object.
type ObjectInfo struct {
	Key          string
	Size         int64
	ContentType  string
	ETag         string
	LastModified time.Time
}

// UploadRequest describes a presigned upload. ContentType and Size are part
// of the signature, so the client cannot upload a different type or length
// than it declared; SHA256 (raw 32 bytes, optional) makes the storage service
// verify the body's checksum as well.
type UploadRequest struct {
	Key         string
	ContentType string
	Size        int64
	SHA256      []byte
	TTL         time.Duration
}

// PresignedRequest is what a client needs to perform a direct upload:
// method, URL and the exact headers to send.
type PresignedRequest struct {
	Method    string
	URL       string
	Headers   map[string]string
	ExpiresAt time.Time
}

// ObjectStorage is the port. All methods are safe for concurrent use.
type ObjectStorage interface {
	// Put stores body (size bytes, -1 if unknown) under key.
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	// Get opens key for reading; the caller closes the reader.
	Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	// Delete removes key. Deleting a missing object is not an error.
	Delete(ctx context.Context, key string) error
	// Head returns the object's metadata, or ErrNotFound.
	Head(ctx context.Context, key string) (ObjectInfo, error)
	// CreateUploadURL presigns a direct PUT.
	CreateUploadURL(ctx context.Context, req UploadRequest) (PresignedRequest, error)
	// CreateDownloadURL presigns a GET valid for ttl. A non-empty filename
	// makes browsers save the object under that name.
	CreateDownloadURL(ctx context.Context, key string, ttl time.Duration, filename string) (string, error)
}

// Disabled is the ObjectStorage used when no bucket is configured: the server
// still starts (media is an optional capability), and every call fails with
// ErrDisabled, which modules map to FAILED_PRECONDITION.
type Disabled struct{}

var _ ObjectStorage = Disabled{}

func (Disabled) Put(context.Context, string, io.Reader, int64, string) error { return ErrDisabled }
func (Disabled) Get(context.Context, string) (io.ReadCloser, ObjectInfo, error) {
	return nil, ObjectInfo{}, ErrDisabled
}
func (Disabled) Delete(context.Context, string) error { return ErrDisabled }
func (Disabled) Head(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, ErrDisabled
}

func (Disabled) CreateUploadURL(context.Context, UploadRequest) (PresignedRequest, error) {
	return PresignedRequest{}, ErrDisabled
}

func (Disabled) CreateDownloadURL(context.Context, string, time.Duration, string) (string, error) {
	return "", ErrDisabled
}
