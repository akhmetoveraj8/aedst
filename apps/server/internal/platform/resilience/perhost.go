package resilience

import (
	"net/http"
	"strings"
	"sync"
)

// maxTrackedHosts bounds the per-host map. Hosts beyond it share one overflow
// breaker and limiter: the map cannot grow without limit, and a flood of new
// hosts can at worst trip the overflow breaker, never the established hosts'.
const maxTrackedHosts = 1024

// WrapRoundTripperPerHost is WrapRoundTripper with one breaker and one rate
// limiter per request host, for a dependency whose targets are chosen by users
// (Web Push endpoints): one dead or blackholing host opens only its own breaker
// and cannot fail requests to every other host. Breakers are named
// "<BreakerName>:<host>".
func WrapRoundTripperPerHost(next http.RoundTripper, cfg Config) http.RoundTripper {
	return &perHostRoundTripper{next: next, cfg: cfg, hosts: map[string]http.RoundTripper{}}
}

type perHostRoundTripper struct {
	next     http.RoundTripper
	cfg      Config
	mu       sync.Mutex
	hosts    map[string]http.RoundTripper
	overflow http.RoundTripper
}

func (p *perHostRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return p.forHost(strings.ToLower(req.URL.Host)).RoundTrip(req)
}

func (p *perHostRoundTripper) forHost(host string) http.RoundTripper {
	p.mu.Lock()
	defer p.mu.Unlock()
	if rt, ok := p.hosts[host]; ok {
		return rt
	}
	cfg := p.cfg
	if len(p.hosts) >= maxTrackedHosts {
		if p.overflow == nil {
			cfg.BreakerName += ":overflow"
			p.overflow = WrapRoundTripper(p.next, cfg)
		}
		return p.overflow
	}
	cfg.BreakerName += ":" + host
	rt := WrapRoundTripper(p.next, cfg)
	p.hosts[host] = rt
	return rt
}
