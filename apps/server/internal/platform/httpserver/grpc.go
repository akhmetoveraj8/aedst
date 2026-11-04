package httpserver

import (
	"context"

	"connectrpc.com/connect/v2"
	"connectrpc.com/grpchealth/v2"
)

// healthChecker answers the standard gRPC health protocol (grpc.health.v1) from
// the same Readiness that backs /readyz, so a gRPC load balancer or client
// (grpc_health_probe, Envoy, gRPC-LB) and an HTTP one always agree.
type healthChecker struct {
	readiness *Readiness
	services  map[string]bool
}

// NewHealthChecker builds a grpchealth.Checker over readiness. The empty
// service name means "the whole server"; services lists the fully qualified
// gRPC services that may also be asked about individually (they share the
// server's status). Asking about any other name is an error, per the protocol.
func NewHealthChecker(readiness *Readiness, services ...string) grpchealth.Checker {
	known := make(map[string]bool, len(services))
	for _, s := range services {
		known[s] = true
	}
	return &healthChecker{readiness: readiness, services: known}
}

func (h *healthChecker) Check(ctx context.Context, req *grpchealth.CheckRequest) (*grpchealth.CheckResponse, error) {
	if req.Service != "" && !h.services[req.Service] {
		return nil, connect.NewError(connect.CodeNotFound, "unknown service")
	}
	if h.readiness.Draining() {
		return &grpchealth.CheckResponse{Status: grpchealth.StatusNotServing}, nil
	}
	if failed, _ := h.readiness.Evaluate(ctx); len(failed) > 0 {
		return &grpchealth.CheckResponse{Status: grpchealth.StatusNotServing}, nil
	}
	return &grpchealth.CheckResponse{Status: grpchealth.StatusServing}, nil
}
