package modulekit

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/validate"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

// Mounter is the ONLY way a ConnectRPC service is mounted (rule: proto
// contract -> protovalidate -> Connect interceptor). Every handler it mounts
// gets the same interceptor chain with connectrpc.com/validate built in, the
// per-service message limit and the Connect protocol-header requirement, so a
// service cannot be mounted without request validation by construction.
// architecturetest's TestEveryConnectHandlerIsMountedThroughTheMounter fails
// the build if a generated Register*ServiceHandler is called outside Mount.
//
// connect v2 applies interceptors per connect.Server and HTTP options per
// connecthttp.Mount call, so each service gets its own Server (same chain) and
// its own read limit.
type Mounter struct {
	router         *http.ServeMux
	before, after  []connect.ServerInterceptor
	defaultMaxRead int
	requireHeader  bool
	mounted        []string
	logger         *slog.Logger
}

// NewMounter builds a mounter whose chain is recover + before + protovalidate + after.
func NewMounter(router *http.ServeMux, before, after []connect.ServerInterceptor, defaultMaxRead int, requireHeader bool) *Mounter {
	return &Mounter{router: router, before: before, after: after, defaultMaxRead: defaultMaxRead, requireHeader: requireHeader, logger: slog.Default()}
}

// WithLogger sets the logger a recovered handler panic is reported to.
func (m *Mounter) WithLogger(l *slog.Logger) *Mounter {
	m.logger = l
	return m
}

// newServer builds the per-service dispatcher: the panic guard is outermost
// (it also covers the interceptors), protovalidate sits between before and after.
func (m *Mounter) newServer() *connect.Server {
	chain := make([]connect.ServerInterceptor, 0, len(m.before)+len(m.after)+2)
	chain = append(chain, m.recoverInterceptor())
	chain = append(chain, m.before...)
	chain = append(chain, validate.NewServerInterceptor())
	chain = append(chain, m.after...)
	return connect.NewServer(chain...)
}

func (m *Mounter) httpOptions(maxRead int) []connecthttp.Option {
	if maxRead <= 0 {
		maxRead = m.defaultMaxRead
	}
	opts := []connecthttp.Option{connecthttp.WithReadMaxBytes(maxRead)}
	if m.requireHeader {
		opts = append(opts, connecthttp.WithRequireConnectProtocolHeader())
	}
	return opts
}

// Mount mounts a generated Connect service: register is the generated
// Register<Service>Handler. maxRead caps one request message for this service
// (0 = the server default, AEDST_MAX_REQUEST_BYTES).
func Mount[H any](m *Mounter, register func(*connect.Server, H), impl H, maxRead int) {
	server := m.newServer()
	register(server, impl)
	connecthttp.Mount(m.router, server, m.httpOptions(maxRead)...)
	seen := map[string]bool{}
	for spec := range server.Specs() {
		name, _, _ := strings.Cut(strings.TrimPrefix(spec.Procedure, "/"), "/")
		if !seen[name] {
			seen[name] = true
			m.mounted = append(m.mounted, name)
		}
	}
}

// Services lists the mounted service names (for gRPC health/reflection).
func (m *Mounter) Services() []string { return append([]string(nil), m.mounted...) }

// StreamingProcedures returns the mounted procedures that stream, from the
// protobuf registry (they are exempt from the unary request/write timeouts).
func (m *Mounter) StreamingProcedures() map[string]bool {
	out := map[string]bool{}
	for _, name := range m.mounted {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			continue
		}
		sd, ok := desc.(protoreflect.ServiceDescriptor)
		if !ok {
			continue
		}
		methods := sd.Methods()
		for i := range methods.Len() {
			if md := methods.Get(i); md.IsStreamingClient() || md.IsStreamingServer() {
				out["/"+name+"/"+string(md.Name())] = true
			}
		}
	}
	return out
}

// VerifyKnown fails startup when a mounted service's descriptor is missing from
// known: the role policy could not name its procedures (a module forgot Files).
func (m *Mounter) VerifyKnown(known map[string]bool) error {
	for _, name := range m.mounted {
		found := false
		for p := range known {
			if strings.HasPrefix(p, "/"+name+"/") {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("service %s is mounted but its descriptor is not in any module's Files", name)
		}
	}
	return nil
}

// recoverInterceptor turns a panic in a handler (or interceptor) into
// CodeInternal for that one call: without it net/http recovers, logs to stderr
// and aborts the connection, which a client sees as a transport failure and the
// structured log and trace never see (connect v2 has no WithRecover option).
// The panic value and the stack are logged with the request context (so with
// its trace_id); the client gets the same generic message as any internal
// error. http.ErrAbortHandler is re-panicked: it is net/http's own signal to
// abort the response.
func (m *Mounter) recoverInterceptor() connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) (err error) {
			defer func() {
				p := recover()
				if p == nil {
					return
				}
				if p == http.ErrAbortHandler { //nolint:errorlint // sentinel panic value, not an error chain
					panic(p)
				}
				m.logger.ErrorContext(ctx, "rpc panic recovered",
					slog.String("procedure", spec.Procedure),
					slog.Any("panic", p),
					slog.String("stack", string(debug.Stack())))
				err = connect.NewError(connect.CodeInternal, "internal error")
			}()
			return next(ctx, spec, stream)
		}
	}
}
