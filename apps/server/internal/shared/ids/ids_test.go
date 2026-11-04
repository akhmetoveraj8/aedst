package ids_test

import (
	"encoding/json"
	"testing"

	"github.com/aedst/server/internal/shared/ids"
)

func TestNewIsTimeOrderedAndNonNil(t *testing.T) {
	a, b := ids.New(), ids.New()
	if a.IsNil() || a == b {
		t.Fatalf("New() returned %s and %s", a, b)
	}
	if a.String() >= b.String() {
		t.Errorf("UUIDv7 ids must sort in creation order: %s !< %s", a, b)
	}
}

func TestParseAndTextRoundTrip(t *testing.T) {
	id := ids.New()
	parsed, err := ids.Parse(id.String())
	if err != nil || parsed != id {
		t.Fatalf("Parse(String()) = %s, %v", parsed, err)
	}
	if _, err := ids.Parse("not-a-uuid"); err == nil {
		t.Fatal("Parse accepted garbage")
	}

	raw, err := json.Marshal(struct{ ID ids.ID }{id})
	if err != nil {
		t.Fatal(err)
	}
	var back struct{ ID ids.ID }
	if err := json.Unmarshal(raw, &back); err != nil || back.ID != id {
		t.Fatalf("JSON round trip = %v, %v", back.ID, err)
	}
	if err := json.Unmarshal([]byte(`{"ID":"nope"}`), &back); err == nil {
		t.Fatal("UnmarshalText accepted garbage")
	}
}

func TestScanAcceptsStringAndBytes(t *testing.T) {
	id := ids.New()
	for name, src := range map[string]any{"string": id.String(), "bytes": []byte(id.String())} {
		var got ids.ID
		if err := got.Scan(src); err != nil || got != id {
			t.Errorf("Scan(%s) = %s, %v", name, got, err)
		}
	}
	var got ids.ID
	if err := got.Scan(42); err == nil {
		t.Error("Scan accepted an int")
	}
	if v, err := id.Value(); err != nil || v != id.String() {
		t.Errorf("Value() = %v, %v", v, err)
	}
}

func TestFromExternalIsStableAndCollisionSafe(t *testing.T) {
	uuidSubject := ids.New()
	if got := ids.FromExternal("https://idp", uuidSubject.String()); got != uuidSubject {
		t.Errorf("a UUID subject must be used as-is, got %s", got)
	}
	a := ids.FromExternal("https://idp-a", "auth0|abc")
	if a != ids.FromExternal("https://idp-a", "auth0|abc") {
		t.Error("the same principal must map to the same id")
	}
	if a == ids.FromExternal("https://idp-b", "auth0|abc") {
		t.Error("the same subject at another issuer must map to a different id")
	}
	if a[6]>>4 != 8 {
		t.Errorf("hashed ids must carry the version-8 nibble, got %x", a[6])
	}
}
