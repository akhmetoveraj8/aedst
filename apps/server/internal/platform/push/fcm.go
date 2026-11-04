package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/errorutils"
	"firebase.google.com/go/v4/messaging"
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
	// Timeout bounds one Send including the SDK's own retries; 0 = no extra bound.
	Timeout time.Duration
	// ClientOptions are appended after the credentials, e.g. option.WithEndpoint
	// and option.WithHTTPClient to point the SDK at a fake FCM in tests.
	ClientOptions []option.ClientOption
}

// FCM sends through the Firebase Admin SDK messaging client (OAuth, token
// refresh and the HTTP v1 wire format are the SDK's).
type FCM struct {
	client  *messaging.Client
	timeout time.Duration
}

// NewFCM builds the messaging client from the service-account key.
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
		opts = append(opts, option.WithAuthCredentialsJSON(option.ServiceAccount, raw))
	} else if len(cfg.ClientOptions) == 0 {
		return nil, errors.New("push: fcm credentials are required (AEDST_PUSH_FCM_CREDENTIALS_JSON or _FILE)")
	}
	if projectID == "" {
		return nil, errors.New("push: fcm project id is unknown (set AEDST_PUSH_FCM_PROJECT_ID)")
	}
	opts = append(opts, cfg.ClientOptions...)
	// Detach from the caller's cancellation: the client outlives startup.
	app, err := firebase.NewApp(context.WithoutCancel(ctx), &firebase.Config{ProjectID: projectID}, opts...)
	if err != nil {
		return nil, fmt.Errorf("push: fcm app: %w", err)
	}
	client, err := app.Messaging(context.WithoutCancel(ctx))
	if err != nil {
		return nil, fmt.Errorf("push: fcm messaging client: %w", err)
	}
	return &FCM{client: client, timeout: cfg.Timeout}, nil
}

func (f *FCM) Send(ctx context.Context, target Target, msg Message) error {
	if target.Token == "" {
		return fmt.Errorf("%w: empty fcm token", ErrInvalidToken)
	}
	data := make(map[string]string, len(msg.Data)+5)
	for k, v := range msg.Data {
		data[k] = v
	}
	data["kind"] = msg.Kind
	data["title"] = msg.Title
	data["body"] = msg.Body
	data["link"] = msg.Link
	data["notification_id"] = msg.NotificationID
	// Token is the FCM registration token the clients register. SDK v4.22 marks the
	// field deprecated in favour of Fid (a Firebase Installation ID), which is a
	// different identifier that our clients do not send, so the field stays.
	m := &messaging.Message{
		Token:        target.Token, //nolint:staticcheck // registration token, not an FID (see above)
		Notification: &messaging.Notification{Title: msg.Title, Body: msg.Body},
		Data:         data,
		Android:      &messaging.AndroidConfig{Priority: "high", CollapseKey: msg.CollapseID},
	}
	if msg.TTL > 0 {
		ttl := msg.TTL.Truncate(time.Second)
		m.Android.TTL = &ttl
	}
	if f.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, f.timeout)
		defer cancel()
	}
	if _, err := f.client.Send(ctx, m); err != nil {
		return classifyFCM(ctx, err)
	}
	return nil
}

// classifyFCM maps an SDK error to the package's kinds. The SDK's errors are
// type-asserted by its helpers, so err must not be wrapped before they run.
func classifyFCM(ctx context.Context, err error) error {
	switch {
	case messaging.IsUnregistered(err):
		return fmt.Errorf("%w: fcm UNREGISTERED", ErrInvalidToken)
	case errorutils.IsInvalidArgument(err) && strings.Contains(strings.ToLower(err.Error()), "registration token"):
		return fmt.Errorf("%w: fcm %s", ErrInvalidToken, err.Error())
	}
	// The SDK has already read and closed the body when it built err; only the
	// status code is used here, so there is nothing to close.
	if resp := errorutils.HTTPResponse(err); resp != nil { //nolint:bodyclose // SDK-owned response, body already consumed
		return classify("fcm", resp.StatusCode, err.Error())
	}
	// No HTTP response: a transport failure (timeout, refused connection,
	// cancellation) is retryable; anything else is the SDK rejecting the
	// message before sending it, which retrying cannot fix.
	if ctx.Err() != nil || errorutils.IsUnavailable(err) || errorutils.IsDeadlineExceeded(err) || errorutils.IsUnknown(err) {
		return fmt.Errorf("push: fcm: %w", err)
	}
	return fmt.Errorf("%w: fcm: %w", ErrPermanent, err)
}
