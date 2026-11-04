package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"sync"
	"time"
)

// Memory is an in-memory ObjectStorage for tests. Presigned URLs use the
// memory:// scheme; tests "upload" with Put directly.
type Memory struct {
	mu      sync.Mutex
	objects map[string]memoryObject
	now     func() time.Time
}

type memoryObject struct {
	data        []byte
	contentType string
	modified    time.Time
}

var _ ObjectStorage = (*Memory)(nil)

func NewMemory() *Memory {
	return &Memory{objects: map[string]memoryObject{}, now: time.Now}
}

func (m *Memory) Put(_ context.Context, key string, body io.Reader, _ int64, contentType string) error {
	data, err := io.ReadAll(body)
	if err != nil {
		return fmt.Errorf("storage: memory put %s: %w", key, err)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = memoryObject{data: data, contentType: contentType, modified: m.now()}
	return nil
}

func (m *Memory) Get(_ context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	obj, ok := m.objects[key]
	if !ok {
		return nil, ObjectInfo{}, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(obj.data)), m.info(key, obj), nil
}

func (m *Memory) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}

func (m *Memory) Head(_ context.Context, key string) (ObjectInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	obj, ok := m.objects[key]
	if !ok {
		return ObjectInfo{}, ErrNotFound
	}
	return m.info(key, obj), nil
}

func (m *Memory) CreateUploadURL(_ context.Context, req UploadRequest) (PresignedRequest, error) {
	return PresignedRequest{
		Method:    "PUT",
		URL:       "memory://bucket/" + url.PathEscape(req.Key),
		Headers:   map[string]string{"Content-Type": req.ContentType},
		ExpiresAt: m.now().Add(req.TTL),
	}, nil
}

func (m *Memory) CreateDownloadURL(_ context.Context, key string, _ time.Duration, _ string) (string, error) {
	return "memory://bucket/" + url.PathEscape(key), nil
}

// Keys lists stored keys (test assertions).
func (m *Memory) Keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	keys := make([]string, 0, len(m.objects))
	for k := range m.objects {
		keys = append(keys, k)
	}
	return keys
}

func (m *Memory) info(key string, obj memoryObject) ObjectInfo {
	return ObjectInfo{Key: key, Size: int64(len(obj.data)), ContentType: obj.contentType, LastModified: obj.modified}
}
