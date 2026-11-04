package errors

import (
	"context"
	"errors"
	"io"
	"net"
	"syscall"
)

// classify decides whether an infrastructure error is a timeout or an outage of
// a dependency rather than a bug. It uses the standard library only (domain code
// imports this package): Postgres errors are recognised through their SQLSTATE
// without importing the driver.
func classify(err error) Kind {
	if err == nil {
		return KindUnknown
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return KindTimeout
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		if netErr.Timeout() {
			return KindTimeout
		}
		return KindUnavailable
	}
	for _, errno := range []error{syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.EPIPE, io.ErrUnexpectedEOF} {
		if errors.Is(err, errno) {
			return KindUnavailable
		}
	}
	var sqlState interface{ SQLState() string }
	if errors.As(err, &sqlState) {
		return classifySQLState(sqlState.SQLState())
	}
	return KindUnknown
}

// classifySQLState maps the SQLSTATEs that mean "the database is not available
// right now" or "the statement ran out of time" (appendix A of the PostgreSQL manual).
func classifySQLState(code string) Kind {
	switch {
	case code == "57014": // query_canceled: statement_timeout, lock_timeout
		return KindTimeout
	case code == "55P03": // lock_not_available (lock_timeout with NOWAIT/skip)
		return KindTimeout
	case len(code) >= 2 && code[:2] == "08": // connection_exception
		return KindUnavailable
	case code == "53300", code == "57P01", code == "57P02", code == "57P03": // too_many_connections, admin_shutdown, crash_shutdown, cannot_connect_now
		return KindUnavailable
	}
	return KindUnknown
}
