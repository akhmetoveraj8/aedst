package domain_test

import (
	"encoding/base64"
	"slices"
	"testing"

	"github.com/aedst/server/internal/modules/appattest/domain"
)

func FuzzParseAttestationAuthData(f *testing.F) {
	rp := domain.RPIDHash("A.b")
	f.Add(rp[:])
	f.Add(append(append(slices.Clone(rp[:]), 0x40, 0, 0, 0, 1), make([]byte, 16+2+4)...))
	f.Fuzz(func(t *testing.T, b []byte) {
		ad, err := domain.ParseAttestationAuthData(b)
		if err != nil {
			return
		}
		if !ad.HasCredential || len(ad.CredentialID) == 0 || len(ad.CredentialID) > len(b) {
			t.Fatalf("accepted inconsistent auth data: %+v", ad)
		}
		short, err := domain.ParseAssertionAuthData(b)
		if err != nil || short.Counter != ad.Counter || short.RPIDHash != ad.RPIDHash {
			t.Fatalf("assertion parse disagrees: %+v vs %+v (%v)", short, ad, err)
		}
	})
}

func FuzzDecodeKeyID(f *testing.F) {
	f.Add("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	f.Add("")
	f.Fuzz(func(t *testing.T, s string) {
		b, err := domain.DecodeKeyID(s)
		if err != nil {
			return
		}
		if len(b) != 32 || base64.StdEncoding.EncodeToString(b) != s {
			t.Fatalf("accepted %q as a non-canonical or wrong-size key id (%d bytes)", s, len(b))
		}
	})
}
