package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/Gameye/nakama-fleetmanager/fleetmanager"
	"github.com/Gameye/nakama-fleetmanager/gameye"
	"github.com/heroiclabs/nakama-common/runtime"
)

// The page's side of a Gameye match, as the root AGENTS.md (Contracts) lays
// it out: change them together.
const (
	// modeProperty and modeGameye mark a matchmaker ticket as a Gameye one;
	// the hook leaves every other ticket to Nakama.
	modeProperty = "mode"
	modeGameye   = "gameye"

	// soloRpc starts a match for one player, with bots in the empty seats:
	// Nakama's matchmaker won't take a ticket for fewer than two.
	soloRpc = "gameye_solo_match"
	// soloResume is the payload of a solo call that resumes the page's search
	// (its socket dropped and came back): it may be handed the match it
	// missed. A call with no payload is a fresh one.
	soloResume = `{"resume":true}`

	matchSubject  = fleetmanager.NotificationSubject // "gameye_match", code 7300
	failedSubject = "gameye_failed"
	failedCode    = fleetmanager.NotificationCode + 1 // 7301

	// envSeatSecret is the container env that holds the match's seat secret.
	envSeatSecret = "SEAT_SECRET"
)

// Reasons in a gameye_failed notification.
const (
	reasonTimeout       = "timeout"
	reasonNoCapacity    = "no_capacity"
	reasonQuotaExceeded = "quota_exceeded"
	reasonMisconfigured = "misconfigured"
	reasonUnavailable   = "unavailable"
	reasonError         = "error"
)

// notifyTimeout bounds each notification sent after the hook has returned.
const notifyTimeout = 10 * time.Second

// fleet is what the plugin needs of the Gameye fleet manager.
type fleet interface {
	Create(ctx context.Context, maxPlayers int, userIds []string, latencies []runtime.FleetUserLatencies, metadata map[string]any, callback runtime.FmCreateCallbackFn) (map[string]string, error)
	Delete(ctx context.Context, id string) error
}

// gameyeMatches turns a match (the matchmaker's, or one player's) into a
// Gameye session and tells its players how to reach it.
type gameyeMatches struct {
	fm          fleet
	nk          runtime.NakamaModule
	logger      runtime.Logger
	relaySecret []byte
	relayUrl    string

	now func() time.Time
	// backoff holds the wait before each retry of a start that found no
	// capacity or a Gameye error: two retries.
	backoff []time.Duration

	mu sync.Mutex
	// starting holds the players whose session is on its way; assigned, the
	// last notification each player got, until its tokens expire, a resume
	// hands it back, or a fresh solo call starts another.
	starting map[string]bool
	assigned map[string]assignment
}

type assignment struct {
	content map[string]any
	exp     time.Time
}

func newGameyeMatches(fm fleet, nk runtime.NakamaModule, logger runtime.Logger, relaySecret []byte, relayUrl string) *gameyeMatches {
	return &gameyeMatches{
		fm:          fm,
		nk:          nk,
		logger:      logger,
		relaySecret: relaySecret,
		relayUrl:    relayUrl,
		now:         time.Now,
		backoff:     []time.Duration{time.Second, 2 * time.Second},
		starting:    make(map[string]bool),
		assigned:    make(map[string]assignment),
	}
}

// matched is the MatchmakerMatched hook. It takes only matches whose every
// ticket says mode=gameye; for the rest it returns "" as if it weren't there.
// The players get their seat by notification, not by a Nakama match, so it
// always returns "".
func (m *gameyeMatches) matched(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, entries []runtime.MatchmakerEntry) (string, error) {
	if len(entries) == 0 {
		return "", nil
	}
	userIds := make([]string, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if mode, _ := entry.GetProperties()[modeProperty].(string); mode != modeGameye {
			return "", nil
		}
		userId := entry.GetPresence().GetUserId()
		if !seen[userId] {
			seen[userId] = true
			userIds = append(userIds, userId)
		}
	}

	// A player whose session is on its way (the solo RPC, called as the page
	// takes its ticket back) isn't put in a second one. One holding an earlier
	// match has queued again, so that match is no longer theirs to resume.
	m.mu.Lock()
	players := userIds[:0]
	for _, userId := range userIds {
		if m.starting[userId] {
			continue
		}
		delete(m.assigned, userId)
		m.starting[userId] = true
		players = append(players, userId)
	}
	m.mu.Unlock()
	if len(players) == 0 {
		return "", nil
	}

	// The first ticket traces the Gameye session back to the matchmaker.
	m.start(ctx, players, entries[0].GetTicket())
	return "", nil
}

// soloMatch is the gameye_solo_match RPC. A caller whose match is on its way
// gets {"status":"starting"} and nothing more starts. A resume (payload
// soloResume: the page's socket came back mid-search) whose tokens are still
// good gets {"status":"matched","match":<the gameye_match content>}, once. Any
// other call, a fresh one (no payload) above all, gets a session of its own,
// and {"status":"starting"}: an earlier match is never handed back to a new
// search.
func (m *gameyeMatches) soloMatch(ctx context.Context, _ runtime.Logger, _ *sql.DB, _ runtime.NakamaModule, payload string) (string, error) {
	userId, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if userId == "" {
		return "", runtime.NewError("a player's session is required", 16) // UNAUTHENTICATED
	}
	var call struct {
		Resume bool `json:"resume"`
	}
	if payload != "" {
		if err := json.Unmarshal([]byte(payload), &call); err != nil {
			return "", runtime.NewError(`the payload is none or {"resume":true}`, 3) // INVALID_ARGUMENT
		}
	}

	m.mu.Lock()
	if m.starting[userId] {
		m.mu.Unlock()
		return `{"status":"starting"}`, nil
	}
	if call.Resume && m.holds(userId) {
		a := m.assigned[userId]
		delete(m.assigned, userId) // replayed: the page follows it now
		m.mu.Unlock()
		reply, err := json.Marshal(map[string]any{"status": "matched", "match": a.content})
		if err != nil {
			return "", runtime.NewError("error encoding the match", 13) // INTERNAL
		}
		return string(reply), nil
	}
	delete(m.assigned, userId)
	m.starting[userId] = true
	m.mu.Unlock()

	m.start(ctx, []string{userId}, "solo-"+userId)
	return `{"status":"starting"}`, nil
}

// holds: the player has an assignment whose tokens are still good. Call with
// mu held.
func (m *gameyeMatches) holds(userId string) bool {
	a, ok := m.assigned[userId]
	return ok && !m.now().After(a.exp)
}

// start asks the fleet manager for a session, then retries or announces from
// its callback. The players must already be marked starting.
func (m *gameyeMatches) start(ctx context.Context, userIds []string, externalId string) {
	m.attempt(ctx, userIds, externalId, 0)
}

func (m *gameyeMatches) attempt(ctx context.Context, userIds []string, externalId string, retries int) {
	// A new secret each attempt: a session that failed to start never shares
	// one with the session that did.
	secret, err := newSeatSecret()
	if err != nil {
		m.fail(userIds, reasonError, err)
		return
	}

	metadata := map[string]any{
		fleetmanager.MetadataKeyExternalId: externalId,
		fleetmanager.MetadataKeyEnv:        map[string]string{envSeatSecret: secret},
	}

	// The callback runs after the hook or RPC has returned, when Nakama has
	// cancelled ctx: nothing in it uses ctx.
	callback := func(status runtime.FmCreateStatus, instance *runtime.InstanceInfo, _ []*runtime.SessionInfo, _ map[string]any, err error) {
		if status == runtime.CreateSuccess {
			m.announce(userIds, instance, []byte(secret))
			return
		}
		if status == runtime.CreateError && retryable(err) && retries < len(m.backoff) {
			m.logger.Warn("no gameye session for players %v yet, retrying: %v", userIds, err)
			time.AfterFunc(m.backoff[retries], func() {
				m.attempt(context.Background(), userIds, externalId, retries+1)
			})
			return
		}
		m.fail(userIds, failureReason(status, err), err)
	}

	result, err := m.fm.Create(ctx, len(userIds), userIds, nil, metadata, callback)
	if err != nil {
		m.fail(userIds, reasonError, err)
		return
	}
	m.logger.Info("starting gameye session %v for players %v", result[fleetmanager.CreateSessionIdKey], userIds)
}

// announce signs each player's tokens and sends them where to connect. A
// session its players never hear of is stopped.
func (m *gameyeMatches) announce(userIds []string, instance *runtime.InstanceInfo, seatSecret []byte) {
	if instance == nil {
		m.fail(userIds, reasonError, errors.New("the fleet manager reported no session"))
		return
	}
	if instance.ConnectionInfo == nil {
		m.abandon(userIds, instance.Id, errors.New("the session has no address"))
		return
	}
	issued := m.now()
	exp := issued.Add(tokenTtl)

	relayToken, err := signRelayToken(m.relaySecret, instance.Id, instance.ConnectionInfo.IpAddress, instance.ConnectionInfo.Port, issued)
	if err != nil {
		m.abandon(userIds, instance.Id, err)
		return
	}
	contents := make(map[string]map[string]any, len(userIds))
	for _, userId := range userIds {
		seatToken, err := signSeatToken(seatSecret, instance.Id, userId, issued)
		if err != nil {
			m.abandon(userIds, instance.Id, err)
			return
		}
		contents[userId] = map[string]any{
			"relay_url":   m.relayUrl,
			"relay_token": relayToken,
			"seat_token":  seatToken,
			"exp":         exp.Unix(),
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	// Persistent, so a page that reconnects can still find it.
	extras := func(userId string) map[string]any { return contents[userId] }
	if err := fleetmanager.NotifyConnectionInfo(ctx, m.nk, userIds, instance, extras, true); err != nil {
		m.abandon(userIds, instance.Id, err)
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.forgetExpired()
	for _, userId := range userIds {
		content := contents[userId]
		content[fleetmanager.NotificationKeyHost] = instance.ConnectionInfo.IpAddress
		content[fleetmanager.NotificationKeyPort] = instance.ConnectionInfo.Port
		content[fleetmanager.NotificationKeySessionId] = instance.Id
		m.assigned[userId] = assignment{content: content, exp: exp}
		delete(m.starting, userId)
	}
	m.logger.Info("gameye session %v is ready for players %v", instance.Id, userIds)
}

// abandon stops a session whose players couldn't be told about it.
func (m *gameyeMatches) abandon(userIds []string, sessionId string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	if stopErr := m.fm.Delete(ctx, sessionId); stopErr != nil {
		m.logger.Error("stopping unannounced gameye session %v: %v", sessionId, stopErr)
	}
	m.fail(userIds, reasonError, err)
}

// fail tells the players their match won't start, so the page can offer to
// try again. Not persistent: it's only news while they wait.
func (m *gameyeMatches) fail(userIds []string, reason string, err error) {
	m.mu.Lock()
	for _, userId := range userIds {
		delete(m.starting, userId)
	}
	m.mu.Unlock()

	m.logger.Error("no gameye session for players %v (%v): %v", userIds, reason, err)

	notifications := make([]*runtime.NotificationSend, 0, len(userIds))
	for _, userId := range userIds {
		notifications = append(notifications, &runtime.NotificationSend{
			UserID:  userId,
			Subject: failedSubject,
			Content: map[string]any{"reason": reason},
			Code:    failedCode,
		})
	}
	ctx, cancel := context.WithTimeout(context.Background(), notifyTimeout)
	defer cancel()
	if err := m.nk.NotificationsSend(ctx, notifications); err != nil {
		m.logger.Error("notifying players %v of the failed session: %v", userIds, err)
	}
}

// forgetExpired drops assignments whose tokens are spent. Call with mu held.
func (m *gameyeMatches) forgetExpired() {
	now := m.now()
	for userId, a := range m.assigned {
		if now.After(a.exp) {
			delete(m.assigned, userId)
		}
	}
}

// retryable: no capacity in the region (420) or a Gameye error (5xx). A
// spent quota (402), a token without the scope (403) or an unknown
// application, tag or region (404) won't change on a retry.
func retryable(err error) bool {
	return errors.Is(err, gameye.ErrNoCapacity) || gameye.IsRetryable(err)
}

func failureReason(status runtime.FmCreateStatus, err error) string {
	switch {
	case status == runtime.CreateTimeout:
		return reasonTimeout
	case errors.Is(err, gameye.ErrNoCapacity):
		return reasonNoCapacity
	case errors.Is(err, gameye.ErrQuotaExceeded):
		return reasonQuotaExceeded
	case errors.Is(err, gameye.ErrUnauthorized), errors.Is(err, gameye.ErrForbidden), errors.Is(err, gameye.ErrNotFound):
		return reasonMisconfigured
	case gameye.IsRetryable(err):
		return reasonUnavailable
	default:
		return reasonError
	}
}
