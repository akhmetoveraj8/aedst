package config

import (
	"net/url"
	"regexp"
	"strings"
)

// sslModeKV matches sslmode in a libpq keyword/value connection string.
var sslModeKV = regexp.MustCompile(`(?:^|\s)sslmode\s*=\s*'?([A-Za-z-]+)'?`)

// sslMode returns the sslmode of a PostgreSQL DSN (URL or keyword/value form).
// libpq's default when it is absent is "prefer": encrypted if the server offers
// it, silently plaintext otherwise, and never a verified server identity.
func sslMode(dsn string) string {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		if u, err := url.Parse(dsn); err == nil {
			if m := u.Query().Get("sslmode"); m != "" {
				return m
			}
		}
		return "prefer"
	}
	if m := sslModeKV.FindStringSubmatch(dsn); m != nil {
		return m[1]
	}
	return "prefer"
}

// verifiedTLS reports whether mode authenticates the server certificate.
func verifiedTLS(mode string) bool { return mode == "verify-full" || mode == "verify-ca" }

// databaseTLSProblems lists every configured DSN that does not verify the
// server certificate. Staging and production must: an unverified connection
// is open to an on-path attacker even though it is "encrypted".
func (c Config) databaseTLSProblems() []string {
	named := map[string]string{
		"AEDST_DATABASE_URL":        c.DB.DSN,
		"AEDST_DATABASE_DIRECT_DSN": c.DB.DirectDSN,
		"AEDST_DATABASE_READ_URL":   c.DB.ReadDSN,
	}
	for module, md := range c.DB.Modules {
		named[moduleDatabasePrefix+strings.ToUpper(module)] = md.DSN
		named[moduleDatabasePrefix+strings.ToUpper(module)+"_JOBS"] = md.JobsDSN
	}
	var problems []string
	for name, dsn := range named {
		if dsn != "" && !verifiedTLS(sslMode(dsn)) {
			problems = append(problems, name)
		}
	}
	return problems
}
