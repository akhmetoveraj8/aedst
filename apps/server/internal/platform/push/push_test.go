package push

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v4/jwa"
	"github.com/lestrrat-go/jwx/v4/jwt"
	"google.golang.org/api/option"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// decryptAES128GCM is the user-agent side of RFC 8291, used to prove the
// server side interoperates.
func decryptAES128GCM(t *testing.T, ua *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	salt, rs, idlen := body[:16], binary.BigEndian.Uint32(body[16:20]), int(body[20])
	if rs != 4096 || idlen != 65 {
		t.Fatalf("header rs=%d idlen=%d", rs, idlen)
	}
	asPublicBytes := body[21 : 21+idlen]
	asPublic, err := ecdh.P256().NewPublicKey(asPublicBytes)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := ua.ECDH(asPublic)
	if err != nil {
		t.Fatal(err)
	}
	ikm, _ := hkdf.Key(sha256.New, shared, auth, "WebPush: info\x00"+string(ua.PublicKey().Bytes())+string(asPublicBytes), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+idlen:], nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	plain = bytes.TrimRight(plain, "\x00") // webpush-go pads the record to its full size
	if plain[len(plain)-1] != 0x02 {
		t.Fatalf("missing last-record delimiter")
	}
	return plain[:len(plain)-1]
}

func newVAPID(t *testing.T) (WebPushConfig, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := key.Bytes()
	pub, _ := key.PublicKey.Bytes()
	return WebPushConfig{PublicKey: b64(pub), PrivateKey: b64(d), Subject: "mailto:ops@example.com"}, key
}

func TestWebPush_EncryptsPerRFC8291AndSignsVAPID(t *testing.T) {
	cfg, vapidKey := newVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)

	var gotBody []byte
	var gotAuth, gotEncoding string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		gotAuth, gotEncoding = r.Header.Get("Authorization"), r.Header.Get("Content-Encoding")
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	wp, err := NewWebPush(cfg, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	target := Target{Platform: PlatformWebPush, Endpoint: srv.URL + "/push/abc", P256dh: b64(ua.PublicKey().Bytes()), Auth: b64(auth)}
	if err := wp.Send(context.Background(), target, Message{Title: "Hi", Body: "there", Link: "/tasks/1", Kind: "task_completed", NotificationID: "n1"}); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	if gotEncoding != "aes128gcm" {
		t.Errorf("Content-Encoding = %q", gotEncoding)
	}
	var payload webPushPayload
	if err := json.Unmarshal(decryptAES128GCM(t, ua, auth, gotBody), &payload); err != nil || payload.Title != "Hi" || payload.Link != "/tasks/1" || payload.Kind != "task_completed" || payload.NotificationID != "n1" {
		t.Fatalf("payload = %+v, %v", payload, err)
	}

	tPart, kPart, ok := strings.Cut(strings.TrimPrefix(gotAuth, "vapid t="), ", k=")
	if !ok || kPart != cfg.PublicKey {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	tok, err := jwt.Parse([]byte(tPart), jwt.WithKey(jwa.ES256(), &vapidKey.PublicKey))
	if err != nil {
		t.Fatalf("vapid jwt does not verify: %v", err)
	}
	if aud, _ := tok.Audience(); len(aud) != 1 || aud[0] != srv.URL {
		t.Errorf("aud = %v, want the push service origin %s", aud, srv.URL)
	}
}

func TestWebPush_GoneDeactivates(t *testing.T) {
	cfg, _ := newVAPID(t)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusGone) }))
	defer srv.Close()
	wp, _ := NewWebPush(cfg, srv.Client())
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	err := wp.Send(context.Background(), Target{Endpoint: srv.URL, P256dh: b64(ua.PublicKey().Bytes()), Auth: b64(make([]byte, 16))}, Message{Title: "x"})
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("err = %v, want ErrInvalidToken", err)
	}
	if err := wp.Send(context.Background(), Target{Endpoint: "http://insecure.example"}, Message{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("plain-http endpoint: err = %v", err)
	}
}

func TestNewWebPush_RejectsMismatchedKeys(t *testing.T) {
	cfg, _ := newVAPID(t)
	other, _ := newVAPID(t)
	cfg.PublicKey = other.PublicKey
	if _, err := NewWebPush(cfg, http.DefaultClient); err == nil {
		t.Fatal("want an error for a public key that does not match the private key")
	}
}

func TestWebPush_TransportFailureIsRetryableAndBadKeysAreInvalid(t *testing.T) {
	cfg, _ := newVAPID(t)
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusServiceUnavailable) }))
	defer srv.Close()
	wp, _ := NewWebPush(cfg, srv.Client())
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	good := Target{Endpoint: srv.URL, P256dh: b64(ua.PublicKey().Bytes()), Auth: b64(make([]byte, 16))}

	err := wp.Send(context.Background(), good, Message{Title: "x"})
	if err == nil || errors.Is(err, ErrInvalidToken) || errors.Is(err, ErrPermanent) {
		t.Errorf("503: err = %v, want a transient error", err)
	}
	bad := good
	bad.P256dh = b64([]byte("not a curve point"))
	if err := wp.Send(context.Background(), bad, Message{Title: "x"}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("bad p256dh: err = %v, want ErrInvalidToken", err)
	}
	if err := wp.Send(context.Background(), good, Message{Body: strings.Repeat("x", maxWebPushPayload+1)}); !errors.Is(err, ErrPermanent) {
		t.Errorf("oversize: err = %v, want ErrPermanent", err)
	}
}

func fcmServiceAccountJSON(t *testing.T, tokenURI string) string {
	t.Helper()
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(rsaKey)
	keyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	raw, _ := json.Marshal(map[string]string{
		"type": "service_account", "project_id": "demo", "private_key_id": "k1",
		"private_key": keyPEM, "client_email": "fcm@demo.iam.gserviceaccount.com", "token_uri": tokenURI,
	})
	return string(raw)
}

// fakeFCM answers the HTTP v1 send endpoint; the last request body is kept.
type fakeFCM struct {
	mu         sync.Mutex
	got        map[string]any
	auth       string
	respStatus int
	respBody   string
}

func (f *fakeFCM) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.URL.Path != "/v1/projects/demo/messages:send" {
		http.NotFound(w, r)
		return
	}
	f.auth = r.Header.Get("Authorization")
	_ = json.NewDecoder(r.Body).Decode(&f.got)
	if f.respStatus != 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(f.respStatus)
		_, _ = w.Write([]byte(f.respBody))
		return
	}
	_, _ = w.Write([]byte(`{"name":"projects/demo/messages/1"}`))
}

func (f *fakeFCM) set(status int, body string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.respStatus, f.respBody = status, body
}

func TestFCM_PayloadAndErrorMapping(t *testing.T) {
	fake := &fakeFCM{}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	f, err := NewFCM(context.Background(), FCMConfig{
		ProjectID:     "demo",
		Timeout:       5 * time.Second,
		ClientOptions: []option.ClientOption{option.WithEndpoint(srv.URL + "/v1"), option.WithHTTPClient(srv.Client())},
	})
	if err != nil {
		t.Fatal(err)
	}
	target := Target{Platform: PlatformFCM, Token: "device"}
	if err := f.Send(context.Background(), target, Message{Title: "T", Body: "B", Link: "/x", Kind: "system", NotificationID: "n2", CollapseID: "c1", TTL: time.Hour}); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	m, _ := fake.got["message"].(map[string]any)
	data, _ := m["data"].(map[string]any)
	android, _ := m["android"].(map[string]any)
	notif, _ := m["notification"].(map[string]any)
	if m["token"] != "device" || data["link"] != "/x" || data["kind"] != "system" || data["title"] != "T" || data["body"] != "B" || data["notification_id"] != "n2" {
		t.Errorf("message = %v", m)
	}
	if android["ttl"] != "3600s" || android["priority"] != "high" || android["collapse_key"] != "c1" || notif["title"] != "T" || notif["body"] != "B" {
		t.Errorf("android/notification = %v / %v", android, notif)
	}

	cases := []struct {
		name         string
		status       int
		body         string
		invalid      bool
		permanent    bool
		wantTransien bool
	}{
		{"unregistered", http.StatusNotFound, `{"error":{"code":404,"message":"gone","status":"NOT_FOUND","details":[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"UNREGISTERED"}]}}`, true, false, false},
		{"malformed registration token", http.StatusBadRequest, `{"error":{"code":400,"message":"The registration token is not a valid FCM registration token","status":"INVALID_ARGUMENT"}}`, true, false, false},
		{"bad request", http.StatusBadRequest, `{"error":{"code":400,"message":"Invalid JSON payload","status":"INVALID_ARGUMENT"}}`, false, true, false},
		{"permission denied", http.StatusForbidden, `{"error":{"code":403,"message":"nope","status":"PERMISSION_DENIED"}}`, false, true, false},
		{"quota", http.StatusTooManyRequests, `{"error":{"code":429,"message":"slow down","status":"RESOURCE_EXHAUSTED"}}`, false, false, true},
		{"internal", http.StatusInternalServerError, `{"error":{"code":500,"message":"oops","status":"INTERNAL"}}`, false, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake.set(tc.status, tc.body)
			err := f.Send(context.Background(), target, Message{Title: "T"})
			if err == nil {
				t.Fatal("want an error")
			}
			if got := errors.Is(err, ErrInvalidToken); got != tc.invalid {
				t.Errorf("ErrInvalidToken = %v, want %v (%v)", got, tc.invalid, err)
			}
			if got := errors.Is(err, ErrPermanent); got != tc.permanent {
				t.Errorf("ErrPermanent = %v, want %v (%v)", got, tc.permanent, err)
			}
		})
	}
	if err := f.Send(context.Background(), Target{Platform: PlatformFCM}, Message{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("empty token: err = %v", err)
	}
}

func TestFCM_ServiceAccountExchangesOAuthToken(t *testing.T) {
	fake := &fakeFCM{}
	mux := http.NewServeMux()
	var grant string
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		grant = r.Form.Get("grant_type")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok-123","token_type":"Bearer","expires_in":3600}`))
	})
	mux.Handle("/", fake)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	f, err := NewFCM(context.Background(), FCMConfig{
		CredentialsJSON: fcmServiceAccountJSON(t, srv.URL+"/token"),
		ClientOptions:   []option.ClientOption{option.WithEndpoint(srv.URL + "/v1")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Send(context.Background(), Target{Platform: PlatformFCM, Token: "device"}, Message{Title: "T"}); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	if grant != "urn:ietf:params:oauth:grant-type:jwt-bearer" || fake.auth != "Bearer tok-123" {
		t.Errorf("grant = %q, Authorization = %q", grant, fake.auth)
	}
}

func TestNewFCM_RejectsBadConfig(t *testing.T) {
	if _, err := NewFCM(context.Background(), FCMConfig{}); err == nil {
		t.Error("want an error without credentials")
	}
	if _, err := NewFCM(context.Background(), FCMConfig{CredentialsJSON: `{"type":"authorized_user"}`}); err == nil {
		t.Error("want an error for a non-service-account key")
	}
	if _, err := NewFCM(context.Background(), FCMConfig{CredentialsJSON: `{"type":"service_account"}`}); err == nil {
		t.Error("want an error without a project id")
	}
}

func newAPNsKeyPEM(t *testing.T) (string, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), key
}

func TestAPNs_HeadersPayloadAndInvalidDevice(t *testing.T) {
	keyPEM, key := newAPNsKeyPEM(t)

	var proto, bearer, path string
	var header http.Header
	var apnsBody map[string]any
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proto, path, header = r.Proto, r.URL.Path, r.Header.Clone()
		bearer = strings.TrimPrefix(r.Header.Get("authorization"), "bearer ")
		_ = json.NewDecoder(r.Body).Decode(&apnsBody)
		switch {
		case strings.HasSuffix(r.URL.Path, "/dead"), strings.HasSuffix(r.URL.Path, "/dead0"):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"reason":"BadDeviceToken"}`))
		case strings.HasSuffix(r.URL.Path, "/0000"):
			w.WriteHeader(http.StatusGone)
			_, _ = w.Write([]byte(`{"reason":"Unregistered"}`))
		case strings.HasSuffix(r.URL.Path, "/beef"):
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"reason":"ServiceUnavailable"}`))
		case strings.HasSuffix(r.URL.Path, "/f00d"):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"reason":"PayloadTooLarge"}`))
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()

	a, err := NewAPNs(APNsConfig{KeyID: "KEY123", TeamID: "TEAM45", PrivateKey: keyPEM, DefaultTopic: "com.example.app", ProductionURL: srv.URL, SandboxURL: srv.URL}, srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	msg := Message{Title: "T", Body: "B", Link: "/tasks/1", Kind: "task_due_soon", NotificationID: "n3", Badge: new(3), CollapseID: "col-1", TTL: time.Hour}
	if err := a.Send(context.Background(), Target{Platform: PlatformAPNs, Token: "abcd"}, msg); err != nil {
		t.Fatalf("Send() = %v", err)
	}
	aps, _ := apnsBody["aps"].(map[string]any)
	alert, _ := aps["alert"].(map[string]any)
	if apnsBody["link"] != "/tasks/1" || apnsBody["kind"] != "task_due_soon" || apnsBody["notification_id"] != "n3" || aps["badge"] != float64(3) || aps["sound"] != "default" || alert["title"] != "T" || alert["body"] != "B" {
		t.Errorf("apns payload = %v", apnsBody)
	}
	if proto != "HTTP/2.0" || path != "/3/device/abcd" {
		t.Errorf("proto=%s path=%s", proto, path)
	}
	if header.Get("apns-topic") != "com.example.app" || header.Get("apns-push-type") != "alert" || header.Get("apns-priority") != "10" || header.Get("apns-collapse-id") != "col-1" || header.Get("apns-expiration") == "" {
		t.Errorf("headers = %v", header)
	}
	tok, err := jwt.Parse([]byte(bearer), jwt.WithKey(jwa.ES256(), &key.PublicKey))
	if err != nil {
		t.Fatalf("provider token does not verify: %v", err)
	}
	if iss, _ := tok.Issuer(); iss != "TEAM45" {
		t.Errorf("iss = %q", iss)
	}

	// A per-device topic wins over the default.
	if err := a.Send(context.Background(), Target{Token: "abcd", APNsTopic: "com.example.other"}, Message{Title: "T"}); err != nil || header.Get("apns-topic") != "com.example.other" {
		t.Errorf("per-device topic: err=%v topic=%q", err, header.Get("apns-topic"))
	}

	for _, tc := range []struct {
		token     string
		invalid   bool
		permanent bool
	}{
		{"0000", true, false}, // 410 Unregistered
		{"dead", true, false}, // 400 BadDeviceToken (hex "dead")
		{"beef", false, false},
		{"f00d", false, true},
	} {
		err := a.Send(context.Background(), Target{Token: tc.token}, Message{Title: "T"})
		if err == nil || errors.Is(err, ErrInvalidToken) != tc.invalid || errors.Is(err, ErrPermanent) != tc.permanent {
			t.Errorf("token %s: err = %v, want invalid=%v permanent=%v", tc.token, err, tc.invalid, tc.permanent)
		}
	}
	if err := a.Send(context.Background(), Target{Token: "not-hex"}, Message{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("non-hex token: err = %v", err)
	}
}

func TestAPNs_SandboxDevicesUseSandboxHostAndNoTopicIsPermanent(t *testing.T) {
	keyPEM, _ := newAPNsKeyPEM(t)
	hit := map[string]int{}
	mk := func(name string) *httptest.Server {
		s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hit[name]++ }))
		s.EnableHTTP2 = true
		s.StartTLS()
		return s
	}
	prod, sandbox := mk("prod"), mk("sandbox")
	defer prod.Close()
	defer sandbox.Close()
	// One client trusts both test CAs.
	pool := x509.NewCertPool()
	pool.AddCert(prod.Certificate())
	pool.AddCert(sandbox.Certificate())
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}, ForceAttemptHTTP2: true}}

	a, err := NewAPNs(APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: keyPEM, ProductionURL: prod.URL, SandboxURL: sandbox.URL}, client)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Send(context.Background(), Target{Token: "ab"}, Message{}); !errors.Is(err, ErrPermanent) {
		t.Errorf("no topic: err = %v, want ErrPermanent", err)
	}
	for _, sb := range []bool{false, true} {
		if err := a.Send(context.Background(), Target{Token: "ab", APNsTopic: "com.x", APNsSandbox: sb}, Message{}); err != nil {
			t.Fatal(err)
		}
	}
	if hit["prod"] != 1 || hit["sandbox"] != 1 {
		t.Errorf("hits = %v, want one per environment", hit)
	}
}

func TestNewAPNs_RejectsBadConfig(t *testing.T) {
	keyPEM, _ := newAPNsKeyPEM(t)
	if _, err := NewAPNs(APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: "not pem"}, nil); err == nil {
		t.Error("want an error for a non-PEM key")
	}
	if _, err := NewAPNs(APNsConfig{KeyID: "", TeamID: "T", PrivateKey: keyPEM}, nil); err == nil {
		t.Error("want an error without a key id")
	}
}

func TestDispatcher_DisabledProvider(t *testing.T) {
	d := &Dispatcher{}
	if err := d.Send(context.Background(), Target{Platform: PlatformFCM}, Message{}); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
	if len(d.Enabled()) != 0 {
		t.Error("nothing should be enabled")
	}
}
