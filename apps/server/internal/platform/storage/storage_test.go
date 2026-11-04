package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPresetDefaults(t *testing.T) {
	tests := []struct {
		name      string
		cfg       Config
		wantPath  bool
		wantReg   string
		wantError bool
	}{
		{"s3 needs a region", Config{Provider: ProviderS3}, false, "", true},
		{"s3 virtual hosted", Config{Provider: ProviderS3, Region: "eu-central-1"}, false, "eu-central-1", false},
		{"minio path style", Config{Provider: ProviderMinIO, Endpoint: "http://localhost:9000"}, true, "us-east-1", false},
		{"minio needs endpoint", Config{Provider: ProviderMinIO}, false, "", true},
		{"r2 region auto", Config{Provider: ProviderR2, Endpoint: "https://acc.r2.cloudflarestorage.com"}, true, "auto", false},
		{"explicit override", Config{Provider: ProviderMinIO, Endpoint: "http://x", PathStyle: "false"}, false, "us-east-1", false},
		{"unknown provider", Config{Provider: "gcs", Region: "x"}, false, "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path, region, err := presetDefaults(tt.cfg)
			if (err != nil) != tt.wantError {
				t.Fatalf("err = %v, wantError %v", err, tt.wantError)
			}
			if err == nil && (path != tt.wantPath || region != tt.wantReg) {
				t.Errorf("got (%v, %q), want (%v, %q)", path, region, tt.wantPath, tt.wantReg)
			}
		})
	}
}

// The presigned PUT must sign content type, length and checksum so the client
// cannot upload something other than what it declared.
func TestS3_PresignedUploadSignsTypeLengthAndChecksum(t *testing.T) {
	s, err := NewS3(context.Background(), Config{
		Provider: ProviderMinIO, Endpoint: "http://minio:9000", PublicEndpoint: "http://localhost:9000",
		Bucket: "media", AccessKeyID: "test", SecretAccessKey: "testtesttest",
	})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("hello"))
	req, err := s.CreateUploadURL(context.Background(), UploadRequest{Key: "u/1/file.png", ContentType: "image/png", Size: 5, SHA256: sum[:], TTL: 15 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(req.URL)
	if err != nil {
		t.Fatal(err)
	}
	if u.Host != "localhost:9000" || !strings.HasPrefix(u.Path, "/media/") {
		t.Errorf("url = %s, want the public endpoint with a path-style bucket", req.URL)
	}
	signed := u.Query().Get("X-Amz-SignedHeaders")
	for _, h := range []string{"content-length", "content-type", "x-amz-checksum-sha256"} {
		if !strings.Contains(signed, h) {
			t.Errorf("signed headers %q lack %s", signed, h)
		}
	}
	if req.Method != "PUT" || req.Headers["Content-Type"] != "image/png" || req.Headers["X-Amz-Checksum-Sha256"] == "" {
		t.Errorf("request = %+v", req)
	}
	if _, ok := req.Headers["Host"]; ok {
		t.Error("Host must not be returned as a client header")
	}

	dl, err := s.CreateDownloadURL(context.Background(), "u/1/file.png", time.Minute, "my file.png")
	if err != nil || !strings.Contains(dl, "response-content-disposition") {
		t.Errorf("download url = %q, %v", dl, err)
	}
}

func TestMemory(t *testing.T) {
	m := NewMemory()
	ctx := context.Background()
	if _, err := m.Head(ctx, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Head(missing) = %v, want ErrNotFound", err)
	}
	if err := m.Put(ctx, "x", bytes.NewReader([]byte("abc")), 3, "text/plain"); err != nil {
		t.Fatal(err)
	}
	info, err := m.Head(ctx, "x")
	if err != nil || info.Size != 3 || info.ContentType != "text/plain" {
		t.Fatalf("Head = %+v, %v", info, err)
	}
	rc, _, err := m.Get(ctx, "x")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(rc)
	_ = rc.Close()
	if string(data) != "abc" {
		t.Errorf("Get = %q", data)
	}
	if err := m.Delete(ctx, "x"); err != nil {
		t.Fatal(err)
	}
	if err := m.Delete(ctx, "x"); err != nil {
		t.Fatalf("deleting a missing object must not fail: %v", err)
	}
}
