#pragma once

// TEST-ONLY TLS material for exercising ConnectClient's TLS policy against FakeHttpServer's HTTPS mode: a private CA
// (`kTestCaPem`) and a leaf certificate for 127.0.0.1 / localhost signed by it (`kTestLeafPem`, key `kTestLeafKeyPem`).
// Generated once with OpenSSL (ECDSA P-256, valid until 2126). The private key is deliberately public: it protects
// nothing and exists only so a loopback test server can speak TLS. NEVER trust this CA anywhere but in a test; the
// production client trusts it only when a test passes it as ClientConfig::extraCaCertificatesPem.
// (.gitleaks.toml allowlists this exact file.)
//
// Regenerate (and update kTestLeafSpkiSha256Base64 from the last command) with:
//   openssl ecparam -name prime256v1 -genkey -noout -out ca.key
//   openssl req -x509 -new -key ca.key -sha256 -days 36500 -subj "/CN=AEDST test CA" \
//       -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out ca.pem
//   openssl ecparam -name prime256v1 -genkey -noout -out leaf.key
//   openssl req -new -key leaf.key -subj "/CN=localhost" -out leaf.csr
//   (ext.cnf: subjectAltName=IP:127.0.0.1,DNS:localhost / basicConstraints=CA:FALSE / keyUsage=digitalSignature /
//    extendedKeyUsage=serverAuth)
//   openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -sha256 -days 36500 -extfile ext.cnf -out
//   leaf.pem openssl pkcs8 -topk8 -nocrypt -in leaf.key -out leaf.p8.pem openssl x509 -in leaf.pem -noout -pubkey |
//   openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64

namespace aedst::testing {

/// Base64 of SHA-256(SubjectPublicKeyInfo DER) of the leaf: the value ClientConfig::pinnedSpkiSha256 expects.
inline constexpr const char* kTestLeafSpkiSha256Base64 = "bUxT4dTUeJbTH0b2jy9FRvf9flkKFzaZxi81Oi+3Rho=";

inline constexpr const char* kTestCaPem = R"PEM(
-----BEGIN CERTIFICATE-----
MIIBlzCCAT2gAwIBAgIUTuvHi3h01QYkunaJYxO0nZhnxJowCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNQUVEU1QgdGVzdCBDQTAgFw0yNjEwMDgxOTQ4MzZaGA8yMTI2
MDkxNDE5NDgzNlowGDEWMBQGA1UEAwwNQUVEU1QgdGVzdCBDQTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABDgNsv4nuQLygiod0XOvDBncQX1tJqg7KAkJBJ1E0HA2
HAuqEVcN3oEFAuHcrzj/yIEteFZpR9lpc3/iLXVZjAajYzBhMB0GA1UdDgQWBBTr
wI0H0R97wEFT/e7ub6UubX63sTAfBgNVHSMEGDAWgBTrwI0H0R97wEFT/e7ub6Uu
bX63sTAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQD
AgNIADBFAiEAjdRz7nvW3sQ/+ghF4VWgWeM7myhwAsrJ8rj/L92uamUCIHGqY6SM
m2BUWDxmUxDX27Ey/enU8saoo46tkAN52vNW
-----END CERTIFICATE-----
)PEM";

inline constexpr const char* kTestLeafPem = R"PEM(
-----BEGIN CERTIFICATE-----
MIIBvjCCAWOgAwIBAgIURbg/LMgNyu4X8EpGLYzcmNNveVIwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNQUVEU1QgdGVzdCBDQTAgFw0yNjEwMDgxOTQ4MzdaGA8yMTI2
MDkxNDE5NDgzN1owFDESMBAGA1UEAwwJbG9jYWxob3N0MFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEa3RrSPaC0X4/ZBXpJnsNDfYPLsFTqQElbRO5PRuvNse+sfCT
dUmgIQkW9QpSWcKTJ+rGpPCTbdOELEB6Bl5BaaOBjDCBiTAaBgNVHREEEzARhwR/
AAABgglsb2NhbGhvc3QwCQYDVR0TBAIwADALBgNVHQ8EBAMCB4AwEwYDVR0lBAww
CgYIKwYBBQUHAwEwHQYDVR0OBBYEFOBk8NfgyV01QNSPcACL6CysQeEaMB8GA1Ud
IwQYMBaAFOvAjQfRH3vAQVP97u5vpS5tfrexMAoGCCqGSM49BAMCA0kAMEYCIQDi
iDl1QOnQEYwlfKzUZezLvde8GczIN6i9LqIo56qjfAIhAK+X7f5CW8teSnpzlrnY
WPybtRjRKc9kkenpNY35gSpx
-----END CERTIFICATE-----
)PEM";

inline constexpr const char* kTestLeafKeyPem = R"PEM(
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg95xBLyMtV3VgpRoV
6sLuVIuod99T7ti0kWNW613FlqWhRANCAARrdGtI9oLRfj9kFekmew0N9g8uwVOp
ASVtE7k9G682x76x8JN1SaAhCRb1ClJZwpMn6sak8JNt04QsQHoGXkFp
-----END PRIVATE KEY-----
)PEM";

} // namespace aedst::testing
