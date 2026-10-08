package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// The relay and seat tokens, as the root AGENTS.md (Contracts) lays them out:
// "v1.<payload>.<signature>", the payload unpadded base64url JSON, the
// signature unpadded base64url HMAC-SHA256 of "v1.<payload>" keyed with the
// secret's bytes. The game server and the relay check them in TypeScript;
// change all three together.
const (
	tokenVersion = "v1"

	// tokenTtl is how long a token is good for after it is issued: long
	// enough for the page to reach the relay while the container comes up.
	tokenTtl = 120 * time.Second

	// maxTokenLength bounds what a verifier reads.
	maxTokenLength = 1024

	tokenRelay = "relay"
	tokenSeat  = "seat"
)

// relayClaims tell the relay which container to open a socket to. Signed with
// RELAY_SECRET, which the plugin and the relay share.
type relayClaims struct {
	Type      string `json:"t"`
	SessionId string `json:"sid"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Exp       int64  `json:"exp"`
}

// seatClaims tell the game server which matched player is taking a seat.
// Signed with the match's own secret, which only its container gets.
type seatClaims struct {
	Type      string `json:"t"`
	SessionId string `json:"sid"`
	UserId    string `json:"uid"`
	Exp       int64  `json:"exp"`
}

var errBadToken = errors.New("bad token")

// newSeatSecret returns a fresh secret for one match: 32 random bytes,
// base64url, so it travels as container env as is.
func newSeatSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func signRelayToken(secret []byte, sessionId, host string, port int, issued time.Time) (string, error) {
	return sign(secret, relayClaims{
		Type:      tokenRelay,
		SessionId: sessionId,
		Host:      host,
		Port:      port,
		Exp:       issued.Add(tokenTtl).Unix(),
	})
}

func signSeatToken(secret []byte, sessionId, userId string, issued time.Time) (string, error) {
	return sign(secret, seatClaims{
		Type:      tokenSeat,
		SessionId: sessionId,
		UserId:    userId,
		Exp:       issued.Add(tokenTtl).Unix(),
	})
}

// verifyRelayToken is the relay's check, here as the reference the
// TypeScript one follows.
func verifyRelayToken(secret []byte, token string, now time.Time) (relayClaims, error) {
	var claims relayClaims
	if err := verify(secret, token, &claims); err != nil {
		return relayClaims{}, err
	}
	if claims.Type != tokenRelay || claims.SessionId == "" || claims.Host == "" || claims.Port < 1 || claims.Port > 65535 {
		return relayClaims{}, errBadToken
	}
	if now.Unix() > claims.Exp {
		return relayClaims{}, fmt.Errorf("%w: expired", errBadToken)
	}
	return claims, nil
}

// verifySeatToken is the game server's check, here as the reference the
// TypeScript one follows. The game server also checks sid against its own
// GAMEYE_SESSION_ID.
func verifySeatToken(secret []byte, token string, now time.Time) (seatClaims, error) {
	var claims seatClaims
	if err := verify(secret, token, &claims); err != nil {
		return seatClaims{}, err
	}
	if claims.Type != tokenSeat || claims.SessionId == "" || claims.UserId == "" {
		return seatClaims{}, errBadToken
	}
	if now.Unix() > claims.Exp {
		return seatClaims{}, fmt.Errorf("%w: expired", errBadToken)
	}
	return claims, nil
}

func sign(secret []byte, claims any) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signed := tokenVersion + "." + base64.RawURLEncoding.EncodeToString(payload)
	return signed + "." + base64.RawURLEncoding.EncodeToString(mac(secret, signed)), nil
}

// verify checks the signature, then decodes the payload into claims.
func verify(secret []byte, token string, claims any) error {
	if len(token) > maxTokenLength {
		return errBadToken
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != tokenVersion || parts[1] == "" {
		return errBadToken
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, mac(secret, parts[0]+"."+parts[1])) {
		return errBadToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, claims) != nil {
		return errBadToken
	}
	return nil
}

func mac(secret []byte, signed string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(signed))
	return h.Sum(nil)
}
