package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"strings"
	"time"

	fcmv1 "google.golang.org/api/fcm/v1"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

// FCMConfig configures Firebase Cloud Messaging (AEDST_PUSH_FCM_*). The
// service account needs the "Firebase Cloud Messaging API Admin" role
// (cloudmessaging.messages.create).
type FCMConfig struct {
	// CredentialsJSON is the service-account key JSON; CredentialsFile is a
	// path to it. One of them is required (unless ClientOptions is set).
	CredentialsJSON string
	CredentialsFile string
	// ProjectID overrides the service account's project_id.
	ProjectID string
	// Timeout bounds one Send; 0 = no extra bound.
	Timeout time.Duration
	// ClientOptions are appended after the credentials, e.g. option.WithEndpoint
	// (with a trailing slash) and option.WithHTTPClient to point the client at a
	// fake FCM in tests.
	ClientOptions []option.ClientOption
}

// FCM sends through the FCM HTTP v1 client that Google generates from the API
// discovery document (google.golang.org/api/fcm/v1). OAuth token exchange and
// refresh come from the same module's transport; the wire format is the
// generated types'. Failed sends are not retried here: the push job queue owns
// retries.
type FCM struct {
	svc     *fcmv1.Service
	parent  string
	timeout time.Duration
}

// NewFCM builds the HTTP v1 client from the service-account key.
func NewFCM(ctx context.Context, cfg FCMConfig) (*FCM, error) {
	raw := []byte(cfg.CredentialsJSON)
	if len(raw) == 0 && cfg.CredentialsFile != "" {
		var err error
		if raw, err = os.ReadFile(cfg.CredentialsFile); err != nil {
			return nil, fmt.Errorf("push: fcm credentials: %w", err)
		}
	}
	var opts []option.ClientOption
	projectID := cfg.ProjectID
	if len(raw) > 0 {
		var sa struct {
			Type      string `json:"type"`
			ProjectID string `json:"project_id"`
		}
		if err := json.Unmarshal(raw, &sa); err != nil {
			return nil, fmt.Errorf("push: fcm credentials: %w", err)
		}
		if sa.Type != "service_account" {
			return nil, errors.New("push: fcm credentials must be a service-account key JSON")
		}
		if projectID == "" {
			projectID = sa.ProjectID
		}
		opts = append(opts,
			option.WithAuthCredentialsJSON(option.ServiceAccount, raw),
			option.WithScopes(fcmv1.FirebaseMessagingScope))
	} else if len(cfg.ClientOptions) == 0 {
		return nil, errors.New("push: fcm credentials are required (AEDST_PUSH_FCM_CREDENTIALS_JSON or _FILE)")
	}
	if projectID == "" {
		return nil, errors.New("push: fcm project id is unknown (set AEDST_PUSH_FCM_PROJECT_ID)")
	}
	opts = append(opts, cfg.ClientOptions...)
	// Detach from the caller's cancellation: the client outlives startup.
	svc, err := fcmv1.NewService(context.WithoutCancel(ctx), opts...)
	if err != nil {
		return nil, fmt.Errorf("push: fcm client: %w", err)
	}
	return &FCM{svc: svc, parent: "projects/" + projectID, timeout: cfg.Timeout}, nil
}

func (f *FCM) Send(ctx context.Context, target Target, msg Message) error {
	if target.Token == "" {
		return fmt.Errorf("%w: empty fcm token", ErrInvalidToken)
	}
	data := make(map[string]string, len(msg.Data)+5)
	maps.Copy(data, msg.Data)
	data["kind"] = msg.Kind
	data["title"] = msg.Title
	data["body"] = msg.Body
	data["link"] = msg.Link
	data["notification_id"] = msg.NotificationID
	// Token is the FCM registration token the clients register. The discovery
	// document marks the field deprecated in favour of Fid (a Firebase
	// Installation ID), which is a different identifier that our clients do not
	// send, so the field stays.
	m := &fcmv1.Message{
		Token:        target.Token,
		Notification: &fcmv1.Notification{Title: msg.Title, Body: msg.Body},
		Data:         data,
		Android:      &fcmv1.AndroidConfig{Priority: "HIGH", CollapseKey: msg.CollapseID},
	}
	if msg.TTL > 0 {
		// google.protobuf.Duration JSON form: whole seconds with an "s" suffix.
		m.Android.Ttl = fmt.Sprintf("%ds", int64(msg.TTL/time.Second))
	}
	if f.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, f.timeout)
		defer cancel()
	}
	if _, err := f.svc.Projects.Messages.Send(f.parent, &fcmv1.SendMessageRequest{Message: m}).Context(ctx).Do(); err != nil {
		return classifyFCM(ctx, err)
	}
	return nil
}

// classifyFCM maps a client error to the package's kinds.
func classifyFCM(ctx context.Context, err error) error {
	if apiErr, ok := errors.AsType[*googleapi.Error](err); ok {
		if fcmUnregistered(apiErr) {
			return fmt.Errorf("%w: fcm UNREGISTERED", ErrInvalidToken)
		}
		// A 400 about the token itself (malformed registration token).
		if apiErr.Code == 400 && strings.Contains(strings.ToLower(apiErr.Message), "registration token") {
			return fmt.Errorf("%w: fcm %s", ErrInvalidToken, apiErr.Message)
		}
		return classify("fcm", apiErr.Code, apiErr.Message)
	}
	// No HTTP response: a transport failure (timeout, refused connection,
	// cancellation, OAuth exchange) is retryable; the generated client does
	// not reject messages locally.
	if ctx.Err() != nil {
		return fmt.Errorf("push: fcm: %w", err)
	}
	return fmt.Errorf("push: fcm transport: %w", err)
}

// fcmUnregistered reports whether the error carries the FcmError detail with
// errorCode UNREGISTERED (the token is gone for good).
func fcmUnregistered(e *googleapi.Error) bool {
	for _, d := range e.Details {
		if m, ok := d.(map[string]any); ok && m["errorCode"] == "UNREGISTERED" {
			return true
		}
	}
	return false
}
