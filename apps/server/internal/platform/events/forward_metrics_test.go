package events

import (
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

func testCounters() (forwarded, failed, discarded metric.Int64Counter, err error) {
	m := otel.Meter("test")
	if forwarded, err = m.Int64Counter("t_forwarded"); err != nil {
		return
	}
	if failed, err = m.Int64Counter("t_failed"); err != nil {
		return
	}
	discarded, err = m.Int64Counter("t_discarded")
	return
}
