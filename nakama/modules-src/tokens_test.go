package main

import (
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"
)

var (
	testRelaySecret = []byte("relay-secret-relay-secret-relay-secret")
	testIssued      = time.Unix(1_800_000_000, 0)
)

func TestSeatTokenVerifiesWithItsMatchSecret(t *testing.T) {
	secret, err := newSeatSecret()
	if err != nil {
		t.Fatal(err)
	}
	token, err := signSeatToken([]byte(secret), "session-1", "user-a", testIssued)
	if err != nil {
		t.Fatal(err)
	}

	seat, err := verifySeatToken([]byte(secret), token, testIssued.Add(time.Minute))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if seat.SessionId != "session-1" || seat.UserId != "user-a" {
		t.Errorf("seat = %+v, want session-1 / user-a", seat)
	}
	if want := testIssued.Add(tokenTtl).Unix(); seat.Exp != want {
		t.Errorf("exp = %v, want %v", seat.Exp, want)
	}
}

func TestSeatTokenFailsWithAnotherSecret(t *testing.T) {
	secret, _ := newSeatSecret()
	other, _ := newSeatSecret()
	if secret == other {
		t.Fatal("two match secrets are equal")
	}
	token, _ := signSeatToken([]byte(secret), "session-1", "user-a", testIssued)

	if _, err := verifySeatToken([]byte(other), token, testIssued); err == nil {
		t.Error("a seat token verified with another match's secret")
	}
}

func TestSeatTokenFailsForAnotherUser(t *testing.T) {
	secret, _ := newSeatSecret()
	token, _ := signSeatToken([]byte(secret), "session-1", "user-a", testIssued)

	// Swap the payload for one naming user-b and keep user-a's signature.
	parts := strings.Split(token, ".")
	forged := parts[0] + "." + base64.RawURLEncoding.EncodeToString(
		[]byte(`{"t":"seat","sid":"session-1","uid":"user-b","exp":`+itoa(testIssued.Add(tokenTtl).Unix())+`}`),
	) + "." + parts[2]

	if _, err := verifySeatToken([]byte(secret), forged, testIssued); err == nil {
		t.Error("a seat token verified for a user it wasn't signed for")
	}

	seat, err := verifySeatToken([]byte(secret), token, testIssued)
	if err != nil {
		t.Fatal(err)
	}
	if seat.UserId == "user-b" {
		t.Error("user-a's token names user-b")
	}
}

func TestSeatTokenExpiresAfterTtl(t *testing.T) {
	secret, _ := newSeatSecret()
	token, _ := signSeatToken([]byte(secret), "session-1", "user-a", testIssued)

	if _, err := verifySeatToken([]byte(secret), token, testIssued.Add(tokenTtl+time.Second)); err == nil {
		t.Error("an expired seat token verified")
	}
}

func TestRelayTokenCarriesHostAndPort(t *testing.T) {
	token, err := signRelayToken(testRelaySecret, "session-1", "203.0.113.7", 21000, testIssued)
	if err != nil {
		t.Fatal(err)
	}

	relay, err := verifyRelayToken(testRelaySecret, token, testIssued.Add(tokenTtl-time.Second))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if relay.SessionId != "session-1" || relay.Host != "203.0.113.7" || relay.Port != 21000 {
		t.Errorf("relay = %+v, want session-1 at 203.0.113.7:21000", relay)
	}
	if want := testIssued.Add(120 * time.Second).Unix(); relay.Exp != want {
		t.Errorf("exp = %v, want issue + 120 s (%v)", relay.Exp, want)
	}
}

func TestRelayTokenExpiresAfter120Seconds(t *testing.T) {
	token, _ := signRelayToken(testRelaySecret, "session-1", "203.0.113.7", 21000, testIssued)

	if _, err := verifyRelayToken(testRelaySecret, token, testIssued.Add(120*time.Second)); err != nil {
		t.Errorf("relay token refused at its expiry second: %v", err)
	}
	if _, err := verifyRelayToken(testRelaySecret, token, testIssued.Add(121*time.Second)); err == nil {
		t.Error("relay token verified after 120 s")
	}
}

func TestRelayTokenFailsWithAnotherSecret(t *testing.T) {
	token, _ := signRelayToken(testRelaySecret, "session-1", "203.0.113.7", 21000, testIssued)

	if _, err := verifyRelayToken([]byte("another-secret-another-secret-another"), token, testIssued); err == nil {
		t.Error("a relay token verified with another secret")
	}
}

func TestTokenKindsDontCross(t *testing.T) {
	secret := []byte("one-secret-for-both-one-secret-for-both")
	seat, _ := signSeatToken(secret, "session-1", "user-a", testIssued)
	relay, _ := signRelayToken(secret, "session-1", "203.0.113.7", 21000, testIssued)

	if _, err := verifyRelayToken(secret, seat, testIssued); err == nil {
		t.Error("a seat token verified as a relay token")
	}
	if _, err := verifySeatToken(secret, relay, testIssued); err == nil {
		t.Error("a relay token verified as a seat token")
	}
}

func TestTokenFormat(t *testing.T) {
	token, _ := signRelayToken(testRelaySecret, "session-1", "203.0.113.7", 21000, testIssued)

	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		t.Fatalf("token = %q, want v1.<payload>.<signature>", token)
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("payload isn't unpadded base64url: %v", err)
	}
	want := `{"t":"relay","sid":"session-1","host":"203.0.113.7","port":21000,"exp":` + itoa(testIssued.Add(tokenTtl).Unix()) + `}`
	if string(payload) != want {
		t.Errorf("payload = %s, want %s", payload, want)
	}
	if sig, err := base64.RawURLEncoding.DecodeString(parts[2]); err != nil || len(sig) != 32 {
		t.Errorf("signature isn't a base64url HMAC-SHA256 (%d bytes, %v)", len(sig), err)
	}
}

func TestMalformedTokensFail(t *testing.T) {
	for _, token := range []string{
		"",
		"v1",
		"v1..",
		"v2.e30.AAAA",
		"v1.!!!.AAAA",
		strings.Repeat("a", maxTokenLength+1),
	} {
		if _, err := verifySeatToken([]byte("secret"), token, testIssued); err == nil {
			t.Errorf("malformed token %q verified", token)
		}
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
