package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/aedst/server/internal/platform/push"
)

// buildPush wires the push providers: each disabled while unconfigured.
func (a *app) buildPush(ctx context.Context) error {
	cfg := a.cfg.Push
	timeout := time.Duration(cfg.TimeoutSeconds) * time.Second
	// One client, and so one circuit breaker, per provider.
	a.env.Dispatcher = &push.Dispatcher{}
	if cfg.WebPushEnabled() {
		wp, err := push.NewWebPush(push.WebPushConfig{PublicKey: cfg.VAPIDPublicKey, PrivateKey: cfg.VAPIDPrivateKey, Subject: cfg.VAPIDSubject}, push.NewHTTPClient(timeout, "webpush"))
		if err != nil {
			return err
		}
		a.env.Dispatcher.WebPush, a.env.WebPushKey = wp, wp.PublicKey()
	}
	if cfg.FCMEnabled() {
		fcm, err := push.NewFCM(ctx, push.FCMConfig{CredentialsJSON: cfg.FCMCredentialsJSON, CredentialsFile: cfg.FCMCredentialsFile, ProjectID: cfg.FCMProjectID, Timeout: timeout})
		if err != nil {
			return err
		}
		a.env.Dispatcher.FCM = fcm
	}
	if cfg.APNsEnabled() {
		apns, err := push.NewAPNs(push.APNsConfig{KeyID: cfg.APNsKeyID, TeamID: cfg.APNsTeamID, PrivateKey: cfg.APNsPrivateKey, PrivateKeyFile: cfg.APNsPrivateKeyFile, DefaultTopic: cfg.APNsTopic}, push.NewHTTPClient(timeout, "apns"))
		if err != nil {
			return err
		}
		a.env.Dispatcher.APNs = apns
	}
	a.logger.InfoContext(ctx, "push providers", slog.Any("enabled", a.env.Dispatcher.Enabled()))
	return nil
}
