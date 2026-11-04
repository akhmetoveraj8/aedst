package httpserver_test

import (
	"context"
	"log/slog"
	"testing"

	"go.opentelemetry.io/otel"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/aedst/server/internal/platform/httpserver"
)

// The request counter is labelled by platform, major version and support
// status, and the labels stay bounded whatever the (unauthenticated) header says.
func TestClientVersionInterceptor_CountsRequestsByVersionAndStatus(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	otel.SetMeterProvider(sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)))

	gate := httpserver.ClientVersionInterceptor(
		context.Background(),
		map[string]string{"android": "1.2.0"},
		map[string]string{"android": "1.5.0", "web": "3.0.0"},
		slog.New(slog.DiscardHandler))

	for _, header := range []string{
		"android/1.6.0",     // current
		"android/1.3.0",     // allowed but below the recommended release
		"android/1.3.1",     // same bucket
		"android/1.1.0",     // rejected
		"web/2.9.0",         // below recommended
		"",                  // unidentified
		"toaster/1.0.0",     // unknown platform: label collapses to none
		"android/99999.0.0", // absurd major: label collapses to other
	} {
		_, _ = callWithHeader(gate, httpserver.ClientHeader, header)
	}

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatal(err)
	}
	got := map[string]int64{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name != "aedst_client_requests_total" {
				continue
			}
			for _, dp := range m.Data.(metricdata.Sum[int64]).DataPoints {
				p, _ := dp.Attributes.Value("platform")
				maj, _ := dp.Attributes.Value("major")
				st, _ := dp.Attributes.Value("status")
				got[p.AsString()+"/"+maj.AsString()+"/"+st.AsString()] = dp.Value
			}
		}
	}
	want := map[string]int64{
		"android/1/current":           1,
		"android/1/below_recommended": 2,
		"android/1/below_minimum":     1,
		"web/2/below_recommended":     1,
		"none/none/unidentified":      1,
		"none/1/current":              1,
		"android/other/current":       1,
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("series %s = %d, want %d (all: %v)", k, got[k], v, got)
		}
	}
}
