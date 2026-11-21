package httpserver

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
)

// CachePolicy marks one read as cacheable. A procedure without a policy keeps
// the router's "Cache-Control: no-store"; that is the default for everything
// per-user. Declare it in the module registration (modulekit.Module.Cacheable).
type CachePolicy struct {
	// MaxAge is how long a cache may reuse the response without asking again.
	// After that it revalidates with If-None-Match and usually gets a 304.
	MaxAge time.Duration
	// Shared allows shared caches (CDN, proxy): "public". Only a procedure
	// reachable without a token may set it (ValidateCachePolicy); otherwise the
	// response is "private" and only the caller's own client may store it.
	Shared bool
	// Vary lists the request headers the answer depends on. Accept-Encoding is
	// added by Connect for every GET and must not be repeated here.
	Vary []string
}

func (p CachePolicy) cacheControl() string {
	visibility := "private"
	if p.Shared {
		visibility = "public"
	}
	return visibility + ", max-age=" + strconv.Itoa(int(p.MaxAge/time.Second))
}

// ValidateCachePolicy fails startup on a policy that could never work or would
// leak: the procedure must exist, must be declared
// "option idempotency_level = NO_SIDE_EFFECTS" (that is what makes Connect
// serve it as a GET), must have a positive MaxAge, and may be Shared only when
// it is public (a per-user answer in a shared cache is a data leak).
func ValidateCachePolicy(policies map[string]CachePolicy, public map[string]bool, files ...protoreflect.FileDescriptor) error {
	safe := map[string]bool{}
	for _, file := range files {
		services := file.Services()
		for i := range services.Len() {
			methods := services.Get(i).Methods()
			for j := range methods.Len() {
				m := methods.Get(j)
				opts, _ := m.Options().(*descriptorpb.MethodOptions)
				safe["/"+string(services.Get(i).FullName())+"/"+string(m.Name())] = opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS
			}
		}
	}
	var errs []error
	for procedure, policy := range policies {
		noSideEffects, known := safe[procedure]
		switch {
		case !known:
			errs = append(errs, fmt.Errorf("cache policy names unknown procedure %q", procedure))
		case !noSideEffects:
			errs = append(errs, fmt.Errorf("cache policy for %q: the RPC is not declared idempotency_level = NO_SIDE_EFFECTS", procedure))
		case policy.MaxAge < time.Second:
			errs = append(errs, fmt.Errorf("cache policy for %q: MaxAge must be at least one second", procedure))
		case policy.Shared && !public[procedure]:
			errs = append(errs, fmt.Errorf("cache policy for %q: Shared (public) caching is only for procedures reachable without a token", procedure))
		}
	}
	return errors.Join(errs...)
}

// ConditionalReadInterceptor serves the cacheable reads in policies as
// conditional GETs: a successful Connect GET gets a strong ETag (SHA-256 of the
// deterministic encoding of the response message and of what selects its
// representation), the policy's Cache-Control and Vary, and a request whose
// If-None-Match matches is answered 304 with no body through Connect's own
// not-modified signal. POST calls and procedures without a policy are untouched.
//
// It must be the outermost interceptor: the 304 is produced here after the rest
// of the chain succeeded, so authentication, authorisation and rate limiting
// still run for every request and a not-modified answer is not logged as a failure.
func ConditionalReadInterceptor(policies map[string]CachePolicy) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			policy, cacheable := policies[spec.Procedure]
			info, overHTTP := connecthttp.ServerInfoForContext(ctx)
			if !cacheable || !overHTTP || info.HTTPMethod() != http.MethodGet {
				return next(ctx, spec, stream)
			}
			request := requestHeader(ctx)
			conditional := &conditionalStream{
				ServerStream: stream,
				response:     callInfo(ctx).ResponseHeader(),
				policy:       policy,
				ifNoneMatch:  request.Values("If-None-Match"),
				variant:      info.HTTPGetQueryParams().Get("encoding") + "\n" + request.Get("Accept-Encoding"),
			}
			if err := next(ctx, spec, conditional); err != nil {
				return err
			}
			if conditional.notModified {
				return connecthttp.NewNotModifiedError()
			}
			return nil
		}
	}
}

// conditionalStream decides at the first Send whether the client already has
// this exact representation.
type conditionalStream struct {
	connect.ServerStream
	response    *connect.Header
	policy      CachePolicy
	ifNoneMatch []string
	variant     string
	notModified bool
}

func (s *conditionalStream) Send(msg any) error {
	message, ok := msg.(proto.Message)
	if !ok {
		return s.ServerStream.Send(msg)
	}
	body, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return s.ServerStream.Send(msg) // not cacheable this time; the response itself is still sent
	}
	sum := sha256.New()
	sum.Write([]byte(s.variant))
	sum.Write([]byte{0})
	sum.Write(body)
	etag := `"` + base64.RawURLEncoding.EncodeToString(sum.Sum(nil)[:16]) + `"`

	s.response.Set("ETag", etag)
	s.response.Set("Cache-Control", s.policy.cacheControl())
	if len(s.policy.Vary) > 0 {
		s.response.Set("Vary", strings.Join(s.policy.Vary, ", "))
	}
	if etagMatches(s.ifNoneMatch, etag) {
		s.notModified = true
		return nil // no body: the interceptor answers 304
	}
	return s.ServerStream.Send(msg)
}

// etagMatches implements If-None-Match (RFC 9110 section 13.1.2): "*" or any
// listed entity tag equal to etag under the weak comparison (a W/ prefix is ignored).
func etagMatches(headers []string, etag string) bool {
	for _, header := range headers {
		for candidate := range strings.SplitSeq(header, ",") {
			candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
			if candidate == "*" || candidate == etag {
				return true
			}
		}
	}
	return false
}
