package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Gameye/nakama-fleetmanager/gameye"
	"github.com/heroiclabs/nakama-common/runtime"
)

// --- fakes: only what the plugin calls ---------------------------------------

type outcome struct {
	status runtime.FmCreateStatus
	err    error
}

type createCall struct {
	userIds  []string
	metadata map[string]any
}

// fakeFleet answers each Create with the next outcome (success once they run
// out), from another goroutine, the way the Gameye fleet manager does.
type fakeFleet struct {
	mu       sync.Mutex
	creates  []createCall
	deletes  []string
	outcomes []outcome
	// hold, when set, keeps every callback waiting until it is closed.
	hold chan struct{}
}

func (f *fakeFleet) Create(_ context.Context, _ int, userIds []string, _ []runtime.FleetUserLatencies, metadata map[string]any, callback runtime.FmCreateCallbackFn) (map[string]string, error) {
	f.mu.Lock()
	f.creates = append(f.creates, createCall{userIds: append([]string(nil), userIds...), metadata: metadata})
	id := fmt.Sprintf("session-%d", len(f.creates))
	result := outcome{status: runtime.CreateSuccess}
	if len(f.outcomes) > 0 {
		result, f.outcomes = f.outcomes[0], f.outcomes[1:]
	}
	hold := f.hold
	f.mu.Unlock()

	go func() {
		if hold != nil {
			<-hold
		}
		if result.status != runtime.CreateSuccess {
			callback(result.status, nil, nil, nil, result.err)
			return
		}
		instance := &runtime.InstanceInfo{
			Id:             id,
			ConnectionInfo: &runtime.ConnectionInfo{IpAddress: "203.0.113.7", Port: 21000},
		}
		callback(runtime.CreateSuccess, instance, nil, nil, nil)
	}()
	return map[string]string{"session_id": id}, nil
}

func (f *fakeFleet) Delete(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deletes = append(f.deletes, id)
	return nil
}

func (f *fakeFleet) createCalls() []createCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]createCall(nil), f.creates...)
}

func (f *fakeFleet) deleteCalls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.deletes...)
}

type fakeNk struct {
	runtime.NakamaModule
	sent chan *runtime.NotificationSend
	// failMatch makes sending gameye_match notifications fail.
	failMatch bool
}

func newFakeNk() *fakeNk {
	return &fakeNk{sent: make(chan *runtime.NotificationSend, 64)}
}

func (n *fakeNk) NotificationsSend(_ context.Context, notifications []*runtime.NotificationSend) error {
	if n.failMatch && len(notifications) > 0 && notifications[0].Subject == matchSubject {
		return fmt.Errorf("database is down")
	}
	for _, notification := range notifications {
		n.sent <- notification
	}
	return nil
}

// next waits for the next notification sent.
func (n *fakeNk) next(t *testing.T) *runtime.NotificationSend {
	t.Helper()
	select {
	case notification := <-n.sent:
		return notification
	case <-time.After(2 * time.Second):
		t.Fatal("no notification sent")
		return nil
	}
}

// none checks that nothing more is sent for a while.
func (n *fakeNk) none(t *testing.T) {
	t.Helper()
	select {
	case notification := <-n.sent:
		t.Fatalf("unexpected notification %v to %v", notification.Subject, notification.UserID)
	case <-time.After(50 * time.Millisecond):
	}
}

type fakeLogger struct {
	mu    sync.Mutex
	lines []string
}

func (l *fakeLogger) log(format string, v ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lines = append(l.lines, fmt.Sprintf(format, v...))
}

func (l *fakeLogger) Debug(format string, v ...any)            { l.log(format, v...) }
func (l *fakeLogger) Info(format string, v ...any)             { l.log(format, v...) }
func (l *fakeLogger) Warn(format string, v ...any)             { l.log(format, v...) }
func (l *fakeLogger) Error(format string, v ...any)            { l.log(format, v...) }
func (l *fakeLogger) WithField(string, any) runtime.Logger     { return l }
func (l *fakeLogger) WithFields(map[string]any) runtime.Logger { return l }
func (l *fakeLogger) Fields() map[string]any                   { return nil }
func (l *fakeLogger) all() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Join(l.lines, "\n")
}

type fakeEntry struct {
	userId     string
	ticket     string
	properties map[string]any
}

type fakePresence struct {
	runtime.Presence
	userId string
}

func (p fakePresence) GetUserId() string { return p.userId }

func (e fakeEntry) GetPresence() runtime.Presence { return fakePresence{userId: e.userId} }
func (e fakeEntry) GetTicket() string             { return e.ticket }
func (e fakeEntry) GetProperties() map[string]any { return e.properties }
func (e fakeEntry) GetPartyId() string            { return "" }
func (e fakeEntry) GetCreateTime() int64          { return 0 }

func gameyeEntry(userId string) runtime.MatchmakerEntry {
	return fakeEntry{userId: userId, ticket: "ticket-" + userId, properties: map[string]any{"mode": "gameye"}}
}

// --- helpers ------------------------------------------------------------------

const testRelayUrl = "wss://relay.test"

// testClock starts at testIssued; tests move it while callbacks read it.
type testClock struct{ offset atomic.Int64 }

func (c *testClock) now() time.Time      { return testIssued.Add(time.Duration(c.offset.Load())) }
func (c *testClock) set(d time.Duration) { c.offset.Store(int64(d)) }

func newTestMatches(fleet *fakeFleet, nk *fakeNk) (*gameyeMatches, *fakeLogger) {
	logger := &fakeLogger{}
	m := newGameyeMatches(fleet, nk, logger, testRelaySecret, testRelayUrl)
	m.now = func() time.Time { return testIssued }
	m.backoff = []time.Duration{time.Millisecond, 2 * time.Millisecond}
	return m, logger
}

func seatSecretOf(t *testing.T, call createCall) string {
	t.Helper()
	env, ok := call.metadata["gameye.env"].(map[string]string)
	if !ok {
		t.Fatalf("Create metadata has no gameye.env map: %#v", call.metadata)
	}
	secret := env[envSeatSecret]
	if len(secret) < 32 {
		t.Fatalf("%v = %d characters, want a random secret of at least 32", envSeatSecret, len(secret))
	}
	return secret
}

func soloCtx(userId string) context.Context {
	return context.WithValue(context.Background(), runtime.RUNTIME_CTX_USER_ID, userId)
}

func apiError(status int) error {
	// The client returns *gameye.ApiError, and the fleet manager wraps it.
	var err error = &gameye.ApiError{StatusCode: status}
	return fmt.Errorf("error starting gameye session: %w", err)
}

// --- the matchmaker hook ----------------------------------------------------

func TestMatchedPairStartsOneSessionAndNotifiesBoth(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	matchId, err := m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})
	if err != nil || matchId != "" {
		t.Fatalf("hook = (%q, %v), want (\"\", nil)", matchId, err)
	}

	first, second := nk.next(t), nk.next(t)
	calls := fleet.createCalls()
	if len(calls) != 1 {
		t.Fatalf("%d Create calls, want 1", len(calls))
	}
	if got := strings.Join(calls[0].userIds, ","); got != "user-a,user-b" {
		t.Errorf("Create users = %v, want user-a,user-b", got)
	}
	if got := calls[0].metadata["gameye.external_id"]; got != "ticket-user-a" {
		t.Errorf("external id = %v, want the first ticket", got)
	}
	secret := seatSecretOf(t, calls[0])

	seen := map[string]bool{}
	for _, n := range []*runtime.NotificationSend{first, second} {
		seen[n.UserID] = true
		if n.Subject != "gameye_match" || n.Code != 7300 || !n.Persistent {
			t.Errorf("notification = %v/%v persistent %v, want gameye_match/7300 persistent", n.Subject, n.Code, n.Persistent)
		}
		if n.Content["relay_url"] != testRelayUrl {
			t.Errorf("relay_url = %v", n.Content["relay_url"])
		}
		if n.Content["exp"] != testIssued.Add(tokenTtl).Unix() {
			t.Errorf("exp = %v, want issue + 120 s", n.Content["exp"])
		}

		relay, err := verifyRelayToken(testRelaySecret, n.Content["relay_token"].(string), testIssued)
		if err != nil {
			t.Fatalf("relay token for %v: %v", n.UserID, err)
		}
		if relay.SessionId != "session-1" || relay.Host != "203.0.113.7" || relay.Port != 21000 {
			t.Errorf("relay token = %+v", relay)
		}

		seat, err := verifySeatToken([]byte(secret), n.Content["seat_token"].(string), testIssued)
		if err != nil {
			t.Fatalf("seat token for %v: %v", n.UserID, err)
		}
		if seat.UserId != n.UserID || seat.SessionId != "session-1" {
			t.Errorf("seat token for %v = %+v", n.UserID, seat)
		}

		for key, value := range n.Content {
			if value == secret {
				t.Errorf("notification content %q carries the seat secret", key)
			}
		}
	}
	if !seen["user-a"] || !seen["user-b"] {
		t.Errorf("notified %v, want user-a and user-b", seen)
	}

	logs := logger.all()
	if strings.Contains(logs, secret) || strings.Contains(logs, first.Content["seat_token"].(string)) || strings.Contains(logs, first.Content["relay_token"].(string)) {
		t.Error("the logs carry a secret or a token")
	}
}

func TestEachMatchGetsItsOwnSeatSecret(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})
	nk.next(t)
	nk.next(t)
	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-c"), gameyeEntry("user-d")})
	nk.next(t)
	nk.next(t)

	calls := fleet.createCalls()
	if seatSecretOf(t, calls[0]) == seatSecretOf(t, calls[1]) {
		t.Error("two matches share a seat secret")
	}
}

func TestTicketsWithoutGameyeModeAreIgnored(t *testing.T) {
	for name, entries := range map[string][]runtime.MatchmakerEntry{
		"no mode":    {fakeEntry{userId: "user-a"}, fakeEntry{userId: "user-b"}},
		"other mode": {fakeEntry{userId: "user-a", properties: map[string]any{"mode": "classic"}}, fakeEntry{userId: "user-b", properties: map[string]any{"mode": "classic"}}},
		"mixed":      {gameyeEntry("user-a"), fakeEntry{userId: "user-b"}},
	} {
		t.Run(name, func(t *testing.T) {
			fleet, nk := &fakeFleet{}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			matchId, err := m.matched(context.Background(), logger, nil, nk, entries)
			if err != nil || matchId != "" {
				t.Fatalf("hook = (%q, %v), want (\"\", nil)", matchId, err)
			}
			nk.none(t)
			if calls := fleet.createCalls(); len(calls) != 0 {
				t.Errorf("%d Create calls, want 0", len(calls))
			}
		})
	}
}

func TestStartFailures(t *testing.T) {
	for _, tc := range []struct {
		name     string
		outcomes []outcome
		reason   string
		creates  int
	}{
		{"404 does not retry", []outcome{{runtime.CreateError, apiError(404)}}, "misconfigured", 1},
		{"403 does not retry", []outcome{{runtime.CreateError, apiError(403)}}, "misconfigured", 1},
		{"402 does not retry", []outcome{{runtime.CreateError, apiError(402)}}, "quota_exceeded", 1},
		{"420 retries twice", []outcome{{runtime.CreateError, apiError(420)}, {runtime.CreateError, apiError(420)}, {runtime.CreateError, apiError(420)}}, "no_capacity", 3},
		{"5xx retries twice", []outcome{{runtime.CreateError, apiError(503)}, {runtime.CreateError, apiError(500)}, {runtime.CreateError, apiError(502)}}, "unavailable", 3},
		{"timeout does not retry", []outcome{{runtime.CreateTimeout, fmt.Errorf("timed out")}}, "timeout", 1},
		{"other error", []outcome{{runtime.CreateError, fmt.Errorf("no port matching 7360/tcp")}}, "error", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fleet, nk := &fakeFleet{outcomes: tc.outcomes}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})

			for range 2 {
				n := nk.next(t)
				if n.Subject != "gameye_failed" || n.Code != 7301 || n.Persistent {
					t.Errorf("notification = %v/%v persistent %v, want gameye_failed/7301 not persistent", n.Subject, n.Code, n.Persistent)
				}
				if n.Content["reason"] != tc.reason {
					t.Errorf("reason = %v, want %v", n.Content["reason"], tc.reason)
				}
			}
			nk.none(t)
			if calls := fleet.createCalls(); len(calls) != tc.creates {
				t.Errorf("%d Create calls, want %d", len(calls), tc.creates)
			}
		})
	}
}

func TestRetryAfterNoCapacityCanSucceed(t *testing.T) {
	fleet, nk := &fakeFleet{outcomes: []outcome{{runtime.CreateError, apiError(420)}}}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})

	n := nk.next(t)
	if n.Subject != "gameye_match" || n.Content["session_id"] != "session-2" {
		t.Errorf("notification = %v for %v, want gameye_match for session-2", n.Subject, n.Content["session_id"])
	}
	calls := fleet.createCalls()
	if len(calls) != 2 {
		t.Fatalf("%d Create calls, want 2", len(calls))
	}
	if _, err := verifySeatToken([]byte(seatSecretOf(t, calls[1])), n.Content["seat_token"].(string), testIssued); err != nil {
		t.Errorf("seat token isn't signed with the started session's secret: %v", err)
	}
}

func TestUnannouncedSessionIsStopped(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	nk.failMatch = true
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})

	n := nk.next(t)
	if n.Subject != "gameye_failed" || n.Content["reason"] != "error" {
		t.Errorf("notification = %v %v, want gameye_failed error", n.Subject, n.Content["reason"])
	}
	if deletes := fleet.deleteCalls(); len(deletes) != 1 || deletes[0] != "session-1" {
		t.Errorf("deleted %v, want session-1", deletes)
	}
}

// --- the solo RPC -------------------------------------------------------------

func TestSoloMatchStartsASessionForTheCaller(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	reply, err := m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if err != nil {
		t.Fatal(err)
	}
	if reply != `{"status":"starting"}` {
		t.Errorf("reply = %s, want starting", reply)
	}

	n := nk.next(t)
	nk.none(t)
	if n.UserID != "user-a" || n.Subject != "gameye_match" {
		t.Errorf("notification = %v to %v, want gameye_match to user-a", n.Subject, n.UserID)
	}
	calls := fleet.createCalls()
	if len(calls) != 1 || len(calls[0].userIds) != 1 || calls[0].userIds[0] != "user-a" {
		t.Fatalf("Create calls = %+v, want one for user-a", calls)
	}
	seat, err := verifySeatToken([]byte(seatSecretOf(t, calls[0])), n.Content["seat_token"].(string), testIssued)
	if err != nil || seat.UserId != "user-a" {
		t.Errorf("seat token = %+v, %v", seat, err)
	}
}

func TestSoloMatchReturnsTheLiveAssignment(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	sent := nk.next(t)

	reply, err := m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Status string         `json:"status"`
		Match  map[string]any `json:"match"`
	}
	if err := json.Unmarshal([]byte(reply), &got); err != nil {
		t.Fatalf("reply %s: %v", reply, err)
	}
	if got.Status != "matched" || got.Match["seat_token"] != sent.Content["seat_token"] || got.Match["relay_token"] != sent.Content["relay_token"] {
		t.Errorf("reply = %s, want the notified assignment", reply)
	}
	nk.none(t)
	if calls := fleet.createCalls(); len(calls) != 1 {
		t.Errorf("%d Create calls, want 1", len(calls))
	}
}

func TestSoloMatchAfterExpiryStartsAgain(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)
	clock := &testClock{}
	m.now = clock.now

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	nk.next(t)

	clock.set(tokenTtl + time.Second)
	reply, _ := m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if reply != `{"status":"starting"}` {
		t.Errorf("reply = %s, want starting", reply)
	}
	nk.next(t)
	if calls := fleet.createCalls(); len(calls) != 2 {
		t.Errorf("%d Create calls, want 2", len(calls))
	}
}

func TestSoloMatchWhileStartingStartsNothingMore(t *testing.T) {
	fleet, nk := &fakeFleet{hold: make(chan struct{})}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	reply, _ := m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if reply != `{"status":"starting"}` {
		t.Errorf("reply = %s, want starting", reply)
	}
	close(fleet.hold)
	nk.next(t)
	nk.none(t)
	if calls := fleet.createCalls(); len(calls) != 1 {
		t.Errorf("%d Create calls, want 1", len(calls))
	}
}

func TestSoloMatchFailureLetsTheCallerTryAgain(t *testing.T) {
	fleet, nk := &fakeFleet{outcomes: []outcome{{runtime.CreateError, apiError(404)}}}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if n := nk.next(t); n.Subject != "gameye_failed" {
		t.Fatalf("notification = %v, want gameye_failed", n.Subject)
	}

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, "")
	if n := nk.next(t); n.Subject != "gameye_match" {
		t.Errorf("notification = %v, want gameye_match", n.Subject)
	}
	if calls := fleet.createCalls(); len(calls) != 2 {
		t.Errorf("%d Create calls, want 2", len(calls))
	}
}

func TestSoloMatchNeedsAUser(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	if _, err := m.soloMatch(context.Background(), logger, nil, nk, ""); err == nil {
		t.Error("a call without a user (the HTTP key) was accepted")
	}
	if calls := fleet.createCalls(); len(calls) != 0 {
		t.Errorf("%d Create calls, want 0", len(calls))
	}
}

// --- config -------------------------------------------------------------------

func TestReadConfig(t *testing.T) {
	valid := map[string]string{
		"GAMEYE_API_TOKEN":         "token",
		"GAMEYE_API_IMAGE":         "scrapyard",
		"GAMEYE_API_IMAGE_VERSION": "v1",
		"GAMEYE_API_REGION":        "europe",
		"RELAY_SECRET":             strings.Repeat("r", 32),
		"RELAY_URL":                "wss://relay.test",
	}

	cfg, err := readConfig(valid)
	if err != nil {
		t.Fatalf("valid env: %v", err)
	}
	if cfg.fleet.Port != "7360/tcp" {
		t.Errorf("port = %q, want the default 7360/tcp", cfg.fleet.Port)
	}
	if cfg.fleet.BaseUrl != "" {
		t.Errorf("base url = %q, want empty (the package default)", cfg.fleet.BaseUrl)
	}

	for key, value := range map[string]string{
		"GAMEYE_API_TOKEN": "",
		"RELAY_SECRET":     strings.Repeat("r", 31),
		"RELAY_URL":        "",
	} {
		env := map[string]string{}
		for k, v := range valid {
			env[k] = v
		}
		env[key] = value
		_, err := readConfig(env)
		if err == nil {
			t.Errorf("%v = %q was accepted", key, value)
		} else if value != "" && strings.Contains(err.Error(), value) {
			t.Errorf("the error for %v quotes its value", key)
		}
	}
}
