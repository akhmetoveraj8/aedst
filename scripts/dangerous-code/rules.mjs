// Rules of the dangerous-code gate (scripts/check-dangerous-code.mjs). Each rule is a regular
// expression applied to every line and to the whole file (scripts/dangerous-code/scan.mjs), so `\s*`
// also crosses line breaks; use `.` or `[^\n]` for "same line only". A rule names the CWE it prevents and the
// safe replacement, because the message is what an AI agent reads when the edit is refused.
//
// Keep rules narrow: a rule that fires on safe code pushes people to add waivers. A waiver is a
// `security-ignore: <rule-id> -- <reason>` comment on the same or the previous line, added by a human.

const JS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

export const RULES = [
  // ---- Code and command injection (CWE-94, CWE-78) ----
  { id: 'js-eval', exts: JS, re: /\beval\s*\(|\bnew\s+Function\s*\(|(?<![\w.])Function\s*\(\s*['"`]|[=:,(]\s*(?:globalThis\.|window\.|self\.)?eval\b(?!\s*\()|\[\s*['"`]eval['"`]\s*\]|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/, why: 'eval, an alias of eval, Function or a string timer runs strings as code (CWE-94)', fix: 'parse data with JSON.parse or a typed parser; never execute strings' },
  { id: 'js-shell-exec', exts: JS, re: /(?:(?<![\w.])|\b(?:cp|child_process|childProcess)\.)(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|[^)'"`]*\+)/, why: 'shell command built from a string (CWE-78)', fix: 'use execFile / spawn with an argument array and no shell' },
  { id: 'js-shell-true', exts: JS, re: /\bshell\s*:\s*true\b/, why: 'spawn with shell: true re-parses arguments (CWE-78)', fix: 'pass arguments as an array without a shell' },
  { id: 'go-shell-exec', exts: ['go'], re: /exec\.Command(?:Context)?\([^)]*"(?:sh|bash|cmd|powershell)"\s*,\s*"(?:-c|\/c|-Command)"/, why: 'shell -c with a command string (CWE-78)', fix: 'call the program directly with separate arguments' },
  { id: 'py-shell', exts: ['py'], re: /\bos\.system\(|subprocess\.[a-z_]+\([^)]*shell\s*=\s*True|\bpickle\.loads?\(/, why: 'shell string or pickle of untrusted data (CWE-78, CWE-502)', fix: 'argument list without a shell; JSON instead of pickle' },

  // ---- Cross-site scripting (CWE-79) ----
  { id: 'web-inner-html', exts: JS, re: /\.(?:inner|outer)HTML\s*=(?!=)|\.insertAdjacentHTML\(|\bdocument\.write(?:ln)?\(/, why: 'raw HTML sink (CWE-79)', fix: 'render through React or use textContent; sanitize with DOMPurify only with a recorded reason' },
  { id: 'react-dangerous-html', exts: ['tsx', 'jsx'], re: /dangerouslySetInnerHTML/, why: 'raw HTML sink (CWE-79)', fix: 'render elements; for JSON-LD use the existing json-ld component' },

  { id: 'go-template-unescaped', exts: ['go'], re: /\btemplate\.(?:HTML|HTMLAttr|JS|JSStr|URL|CSS|Srcset)\(/, why: 'html/template escaping bypassed (CWE-79)', fix: 'pass plain strings and let html/template escape them' },

  // ---- Injection into queries (CWE-89) ----
  { id: 'go-sql-concat', exts: ['go'], re: /(?:Sprintf|Sprint|Sprintln)\(\s*(?:`|")\s*(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i, why: 'SQL built with string formatting (CWE-89)', fix: 'write the query in apps/server/sql and generate it with sqlc' },
  { id: 'js-sql-template', exts: JS, re: /(?:\.query|\.execute|\.raw|\$queryRawUnsafe|\$executeRawUnsafe)\(\s*`[^`]*\$\{/, why: 'SQL built from a template string (CWE-89)', fix: 'parameterized query' },

  // ---- Broken TLS and crypto (CWE-295, CWE-327, CWE-330) ----
  { id: 'tls-verify-off', exts: [...JS, 'go', 'rs', 'kt', 'java', 'swift', 'py'], re: /InsecureSkipVerify\s*:\s*true|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|danger_accept_invalid_(?:certs|hostnames)\(\s*true|verify\s*=\s*False/, why: 'TLS certificate verification disabled (CWE-295)', fix: 'trust the real chain; for a private CA add the CA to the trust store' },
  { id: 'android-trust-all', exts: ['kt', 'java'], re: /X509TrustManager\s*\{|HostnameVerifier\s*\{\s*_\s*,\s*_\s*->\s*true|ALLOW_ALL_HOSTNAME_VERIFIER|usesCleartextTraffic\s*=\s*['"]?true|setJavaScriptEnabled\(\s*true|MODE_WORLD_(?:READABLE|WRITEABLE)/, why: 'trust-all TLS, cleartext traffic, world-readable file or WebView JavaScript (CWE-295, CWE-319)', fix: 'default trust manager, HTTPS only, app-private storage' },
  { id: 'apple-ats-off', exts: ['swift', 'plist'], re: /NSAllowsArbitraryLoads\b/, why: 'App Transport Security disabled (CWE-319)', fix: 'HTTPS only; a single reviewed exception domain at most' },
  { id: 'weak-hash', exts: [...JS, 'go', 'kt', 'java', 'py'], re: /createHash\(\s*['"](?:md5|sha1)['"]|\bcrypto\/(?:md5|sha1|des|rc4)\b|MessageDigest\.getInstance\(\s*"(?:MD5|SHA-?1)"|Cipher\.getInstance\(\s*"(?:DES|RC4|AES\/ECB)/i, why: 'broken hash or cipher (CWE-327)', fix: 'SHA-256 or better; AES-GCM through Tink / the platform; passwords never hashed in AEDST code (IdP)' },
  { id: 'insecure-random', exts: [...JS, 'go'], re: /(?:token|secret|nonce|session|password|apikey|api_key|csrf|salt|otp)\w*\s*(?::=|=)[^\n]*(?:Math\.random\(\)|\brand\.(?:Int|Intn|Int63|Uint32|Uint64|Read)\()/i, why: 'predictable random value used for a secret (CWE-330)', fix: 'crypto.randomUUID / crypto.getRandomValues, or crypto/rand in Go' },
  { id: 'jwt-unsafe', exts: [...JS, 'go'], re: /algorithms\s*:\s*\[[^\]]*['"]none['"]|jwt\.Parse(?:Unverified)\(|jws\.WithInsecureNoSignature|\bjwtDecode\(/i, why: 'unsigned or unverified JWT (CWE-347)', fix: 'verify only in httpserver.AuthInterceptor / the BFF with jose or jwx and the IdP JWKS' },

  // ---- Secrets (CWE-798, CWE-312) ----
  { id: 'secret-literal', exts: ['*'], re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bsk-(?:live|proj|ant)-[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{35}\b/, why: 'credential or private key committed to source (CWE-798)', fix: 'read it from an environment variable or the secret store; rotate it if it was ever pushed' },
  { id: 'secret-assign', exts: [...JS, 'go', 'kt', 'swift', 'rs', 'py'], re: /\b(?:password|passwd|secret|api_?key|access_?token|private_?key)\w*\s*(?::=|=|:)\s*["'`](?![a-z_.-]+["'`])[^"'`\s${}]{12,}["'`]/i, why: 'hard-coded secret (CWE-798)', fix: 'environment variable documented in the config reference' },
  { id: 'web-token-storage', exts: JS, re: /(?:local|session)Storage\.setItem\(\s*['"`][^'"`]*(?:token|jwt|secret|password|session)[^'"`]*['"`]/i, why: 'token in script-readable storage (CWE-922)', fix: 'httpOnly Secure SameSite cookie through the BFF' },
  { id: 'cookie-flags-off', exts: JS, re: /\b(?:httpOnly|secure)\s*:\s*false\b/, why: 'cookie without HttpOnly or Secure (CWE-1004, CWE-614)', fix: 'httpOnly: true, secure: true, sameSite: "lax" or "strict"' },

  // ---- Network exposure (CWE-942, CWE-918) ----
  { id: 'cors-wildcard-credentials', exts: [...JS, 'go'], re: /(?:AllowedOrigins|allowedOrigins|origin)\s*:?=?\s*(?:\[\s*)?(?:\[\]string\{\s*)?["']\*["'][^\n]*|Access-Control-Allow-Origin["'`]?\s*[,:]\s*["'`]\*["'`]/, why: 'CORS wildcard origin (CWE-942)', fix: 'explicit origin list from configuration; never with credentials' },
  { id: 'go-default-client', exts: ['go'], re: /\bhttp\.(?:DefaultClient|Get|Post|PostForm|Head)\(/, why: 'outbound HTTP without timeout or allowlist (CWE-918)', fix: 'a configured client with a timeout and a host allowlist' },
  { id: 'bind-all-interfaces', exts: ['go', 'rs', ...JS], re: /(?:ListenAndServe\(\s*"|listen\(\s*[0-9]+\s*,\s*['"]|bind\(\s*"|TcpListener::bind\(\s*")0\.0\.0\.0/, why: 'debug or admin listener on all interfaces (CWE-1327)', fix: 'bind 127.0.0.1 or the configured address; the ingress exposes it' },

  // ---- Unsafe memory and types (Rust, TypeScript) ----
  { id: 'rust-unsafe', exts: ['rs'], re: /\bunsafe\s*(?:\{|fn\b|impl\b|trait\b)/, why: 'unsafe is forbidden in AEDST Rust (ADR-0001)', fix: 'a safe crate or API' },
  { id: 'ts-ignore', inComment: true, exts: ['ts', 'tsx'], re: /@ts-(?:ignore|nocheck)\b/, why: 'type check silenced, hides injection and null bugs', fix: '@ts-expect-error with a reason, or fix the type' },
];
