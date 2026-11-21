package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
)

// ProcedureLimit is the per-user budget of one expensive procedure, on top of
// the global per-user limit (AEDST_API_RATE_LIMIT_PER_MINUTE). It is
// configuration, never module code: a module declares its defaults in its
// registration (modulekit.Module.RateLimits) and a deployment overrides them
// with AEDST_PROCEDURE_RATE_LIMITS.
type ProcedureLimit struct {
	// PerMinute is the budget per user per minute. 0 means "no limit of its own"
	// (used in configuration to switch a built-in default off).
	PerMinute int
	// Bucket names the counter. Procedures with the same Bucket share one budget
	// (CreateChallenge and Enroll are one enrolment flow). Empty: the policy key,
	// so an exact entry has its own budget and a service wildcard one shared budget.
	Bucket string
}

// ParseProcedureLimits turns AEDST_PROCEDURE_RATE_LIMITS
// ("/pkg.Service/Method=10,/pkg.Service/*=60") into limits.
func ParseProcedureLimits(raw map[string]int) (map[string]ProcedureLimit, error) {
	limits := make(map[string]ProcedureLimit, len(raw))
	var errs []error
	for procedure, perMinute := range raw {
		procedure = strings.TrimSpace(procedure)
		if perMinute < 0 {
			errs = append(errs, fmt.Errorf("procedure rate limit for %q is negative", procedure))
			continue
		}
		limits[procedure] = ProcedureLimit{PerMinute: perMinute}
	}
	return limits, errors.Join(errs...)
}

// MergeProcedureLimits returns the modules' defaults overlaid by configured:
// an entry in the environment replaces the default for the same key, and an
// entry of 0 removes it.
func MergeProcedureLimits(defaults, configured map[string]ProcedureLimit) map[string]ProcedureLimit {
	out := make(map[string]ProcedureLimit, len(defaults)+len(configured))
	maps.Copy(out, defaults)
	maps.Copy(out, configured)
	maps.DeleteFunc(out, func(_ string, l ProcedureLimit) bool { return l.PerMinute <= 0 })
	return out
}

// ValidateProcedureLimits fails startup on a limit that would protect nothing:
// an unknown procedure or service (a typo), or a public procedure (it has no
// user to count; public procedures are limited per address).
func ValidateProcedureLimits(limits map[string]ProcedureLimit, known, public map[string]bool) error {
	var errs []error
	for procedure := range limits {
		if prefix, ok := strings.CutSuffix(procedure, "/*"); ok {
			matched := false
			for p := range known {
				matched = matched || strings.HasPrefix(p, prefix+"/")
			}
			if !matched {
				errs = append(errs, fmt.Errorf("procedure rate limit names unknown service %q", procedure))
			}
			continue
		}
		switch {
		case !known[procedure]:
			errs = append(errs, fmt.Errorf("procedure rate limit names unknown procedure %q (procedures look like /aedst.tasks.v1.TasksService/ListTasks)", procedure))
		case public[procedure]:
			errs = append(errs, fmt.Errorf("procedure rate limit names public procedure %q: it has no authenticated caller to count", procedure))
		}
	}
	return errors.Join(errs...)
}

// ProcedureRateLimitInterceptor throttles the listed procedures per user and
// bucket, cluster-wide through the shared limiter. An exact entry wins over the
// service wildcard. It must sit after AuthInterceptor; a call without an
// identity passes (public procedures are limited per address). Like every
// limiter here it fails open: a limiter outage must not become an API outage.
func ProcedureRateLimitInterceptor(limiter RateLimiter, limits map[string]ProcedureLimit, logger *slog.Logger) connect.ServerInterceptor {
	warnFailOpen := failOpenWarner(logger)
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			limit, bucket, limited := procedureLimit(limits, spec.Procedure)
			identity, ok := platformauth.FromContext(ctx)
			if !limited || !ok {
				return next(ctx, spec, stream)
			}
			allowed, err := limiter.Allow(ctx, "rl:proc:"+bucket+":"+identity.UserID.String(), limit.PerMinute, time.Minute)
			if err != nil {
				warnFailOpen(ctx, err)
			} else if !allowed {
				// The budget refills evenly, so one unit is back after 60/N seconds.
				wait := (59 + limit.PerMinute) / limit.PerMinute
				return rateLimited(ctx, "rate limit for this operation exceeded, try again later", strconv.Itoa(wait))
			}
			return next(ctx, spec, stream)
		}
	}
}

// procedureLimit resolves the limit and its counter name for procedure.
func procedureLimit(limits map[string]ProcedureLimit, procedure string) (ProcedureLimit, string, bool) {
	key := procedure
	limit, ok := limits[key]
	if !ok {
		if i := strings.LastIndexByte(procedure, '/'); i > 0 {
			key = procedure[:i] + "/*"
			limit, ok = limits[key]
		}
	}
	if !ok || limit.PerMinute <= 0 {
		return ProcedureLimit{}, "", false
	}
	if limit.Bucket != "" {
		key = limit.Bucket
	}
	return limit, key, true
}
