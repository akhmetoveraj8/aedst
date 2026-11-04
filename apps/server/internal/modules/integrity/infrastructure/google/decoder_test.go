package google_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"google.golang.org/api/option"

	"github.com/aedst/server/internal/modules/integrity/application"
	"github.com/aedst/server/internal/modules/integrity/domain"
	"github.com/aedst/server/internal/modules/integrity/infrastructure/google"
)

const secretToken = "SECRET-TOKEN-VALUE"

// fakeGoogle serves v1/{package}:decodeIntegrityToken with the REST schema of
// playintegrity.googleapis.com (int64 fields are JSON strings).
func fakeGoogle(t *testing.T, handler func(w http.ResponseWriter, pkg, token string)) *google.Decoder {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, ":decodeIntegrityToken") {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			IntegrityToken string `json:"integrityToken"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("request body: %v", err)
		}
		pkg := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/"), ":decodeIntegrityToken")
		handler(w, pkg, body.IntegrityToken)
	}))
	t.Cleanup(srv.Close)
	d, err := google.NewDecoder(context.Background(), google.Config{
		Timeout:       5 * time.Second,
		ClientOptions: []option.ClientOption{option.WithEndpoint(srv.URL), option.WithHTTPClient(srv.Client())},
	})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestDecode_MapsTheStandardVerdict(t *testing.T) {
	issued := time.Date(2026, 10, 8, 11, 59, 0, 0, time.UTC)
	d := fakeGoogle(t, func(w http.ResponseWriter, pkg, token string) {
		if pkg != "com.aedst.android" || token != secretToken {
			t.Errorf("got package %q token %q", pkg, token)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"tokenPayloadExternal": map[string]any{
			"requestDetails": map[string]any{
				"requestPackageName": "com.aedst.android",
				"requestHash":        "hash-43",
				"timestampMillis":    "1791460740000",
			},
			"appIntegrity":    map[string]any{"appRecognitionVerdict": "PLAY_RECOGNIZED", "packageName": "com.aedst.android"},
			"deviceIntegrity": map[string]any{"deviceRecognitionVerdict": []string{"MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"}},
			"accountDetails":  map[string]any{"appLicensingVerdict": "LICENSED"},
			"testingDetails":  map[string]any{"isTestingResponse": true},
		}})
	})
	e, err := d.Decode(context.Background(), "com.aedst.android", secretToken)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	want := domain.Evidence{
		PackageName: "com.aedst.android", RequestHash: "hash-43", IssuedAt: issued,
		DeviceVerdicts: []string{"MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"},
		AppVerdict:     "PLAY_RECOGNIZED", AccountVerdict: "LICENSED", TestingResponse: true,
	}
	if !e.IssuedAt.Equal(want.IssuedAt) {
		t.Errorf("IssuedAt = %v, want %v", e.IssuedAt, want.IssuedAt)
	}
	e.IssuedAt = want.IssuedAt
	if strings.Join(e.DeviceVerdicts, ",") != strings.Join(want.DeviceVerdicts, ",") {
		t.Errorf("DeviceVerdicts = %v", e.DeviceVerdicts)
	}
	e.DeviceVerdicts, want.DeviceVerdicts = nil, nil
	if !reflect.DeepEqual(e, want) {
		t.Errorf("Evidence = %+v, want %+v", e, want)
	}
}

func TestDecode_ClassifiesGoogleFailures(t *testing.T) {
	status := func(code int, msg string) *google.Decoder {
		return fakeGoogle(t, func(w http.ResponseWriter, _, _ string) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": msg, "status": "X"}})
		})
	}
	if _, err := status(http.StatusBadRequest, "Integrity token decoding failed").Decode(context.Background(), "p", secretToken); !errors.Is(err, application.ErrUndecodable) {
		t.Errorf("400 = %v, want ErrUndecodable", err)
	}
	for _, code := range []int{http.StatusForbidden, http.StatusTooManyRequests, http.StatusInternalServerError} {
		_, err := status(code, "API disabled").Decode(context.Background(), "p", secretToken)
		if err == nil || errors.Is(err, application.ErrUndecodable) {
			t.Errorf("%d = %v, want an operational error", code, err)
		} else if strings.Contains(err.Error(), secretToken) {
			t.Errorf("%d error leaks the token: %v", code, err)
		}
	}
}

func TestDecode_PayloadWithoutRequestDetailsIsUndecodable(t *testing.T) {
	d := fakeGoogle(t, func(w http.ResponseWriter, _, _ string) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	})
	if _, err := d.Decode(context.Background(), "p", secretToken); !errors.Is(err, application.ErrUndecodable) {
		t.Fatalf("empty payload = %v, want ErrUndecodable", err)
	}
}

func TestNewDecoder_RejectsNonServiceAccountCredentials(t *testing.T) {
	_, err := google.NewDecoder(context.Background(), google.Config{CredentialsJSON: `{"type":"authorized_user"}`})
	if err == nil {
		t.Fatal("authorized_user credentials must be rejected")
	}
	if _, err := google.NewDecoder(context.Background(), google.Config{CredentialsFile: "/does/not/exist.json"}); err == nil {
		t.Fatal("missing credentials file must fail")
	}
}
