// Package google decodes Play Integrity tokens through Google's official
// generated client (google.golang.org/api/playintegrity/v1): OAuth, token
// refresh and the REST wire format are the client's, not ours.
package google

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	playintegrity "google.golang.org/api/playintegrity/v1"

	"github.com/aedst/server/internal/modules/integrity/application"
	"github.com/aedst/server/internal/modules/integrity/domain"
)

// Config configures the decoder (AEDST_INTEGRITY_*).
type Config struct {
	// CredentialsJSON is a service-account key JSON, CredentialsFile a path to
	// one. With neither, Application Default Credentials are used (workload
	// identity, GOOGLE_APPLICATION_CREDENTIALS, metadata server).
	CredentialsJSON string
	CredentialsFile string
	// Timeout bounds one decode call including the client's retries; 0 = none.
	Timeout time.Duration
	// ClientOptions are appended last, e.g. option.WithEndpoint and
	// option.WithHTTPClient to point the client at a fake Google in tests (and
	// then no credentials are looked up).
	ClientOptions []option.ClientOption
}

// Decoder calls v1/{packageName}:decodeIntegrityToken.
type Decoder struct {
	service *playintegrity.Service
	timeout time.Duration
}

var _ application.Decoder = (*Decoder)(nil)

// NewDecoder builds the client. It does not call Google.
func NewDecoder(ctx context.Context, cfg Config) (*Decoder, error) {
	raw := []byte(cfg.CredentialsJSON)
	if len(raw) == 0 && cfg.CredentialsFile != "" {
		var err error
		if raw, err = os.ReadFile(cfg.CredentialsFile); err != nil {
			return nil, fmt.Errorf("integrity: credentials: %w", err)
		}
	}
	var opts []option.ClientOption
	if len(raw) > 0 {
		var sa struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(raw, &sa); err != nil || sa.Type != "service_account" {
			return nil, errors.New("integrity: credentials must be a service-account key JSON")
		}
		opts = append(opts, option.WithAuthCredentialsJSON(option.ServiceAccount, raw))
	}
	opts = append(opts, cfg.ClientOptions...)
	// Detach from the caller's cancellation: the client outlives startup.
	svc, err := playintegrity.NewService(context.WithoutCancel(ctx), opts...)
	if err != nil {
		return nil, fmt.Errorf("integrity: play integrity client: %w", err)
	}
	return &Decoder{service: svc, timeout: cfg.Timeout}, nil
}

// Decode asks Google to decode token for packageName. A 400 means Google
// rejected the token (ErrUndecodable); every other failure is operational and
// its error never contains the token.
func (d *Decoder) Decode(ctx context.Context, packageName, token string) (domain.Evidence, error) {
	if d.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, d.timeout)
		defer cancel()
	}
	resp, err := d.service.V1.DecodeIntegrityToken(packageName, &playintegrity.DecodeIntegrityTokenRequest{IntegrityToken: token}).Context(ctx).Do()
	if err != nil {
		var gerr *googleapi.Error
		if errors.As(err, &gerr) {
			if gerr.Code == http.StatusBadRequest {
				return domain.Evidence{}, application.ErrUndecodable
			}
			// Status and Google's own message (e.g. "API has not been used in
			// project ... before or it is disabled"); not the request body.
			return domain.Evidence{}, fmt.Errorf("integrity: google decode failed: status %d: %s", gerr.Code, gerr.Message)
		}
		return domain.Evidence{}, fmt.Errorf("integrity: google decode failed: %w", err)
	}
	return evidenceOf(resp.TokenPayloadExternal)
}

// evidenceOf maps Google's tokenPayloadExternal to domain evidence. A payload
// without requestDetails is not a verdict we can judge: treated as undecodable.
func evidenceOf(p *playintegrity.TokenPayloadExternal) (domain.Evidence, error) {
	if p == nil || p.RequestDetails == nil {
		return domain.Evidence{}, application.ErrUndecodable
	}
	e := domain.Evidence{
		PackageName: p.RequestDetails.RequestPackageName,
		RequestHash: p.RequestDetails.RequestHash,
		IssuedAt:    time.UnixMilli(p.RequestDetails.TimestampMillis).UTC(),
	}
	if p.DeviceIntegrity != nil {
		e.DeviceVerdicts = p.DeviceIntegrity.DeviceRecognitionVerdict
	}
	if p.AppIntegrity != nil {
		e.AppVerdict = p.AppIntegrity.AppRecognitionVerdict
	}
	if p.AccountDetails != nil {
		e.AccountVerdict = p.AccountDetails.AppLicensingVerdict
	}
	if p.TestingDetails != nil {
		e.TestingResponse = p.TestingDetails.IsTestingResponse
	}
	return e, nil
}
