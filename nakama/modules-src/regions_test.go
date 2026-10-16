package main

import (
	"context"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

var (
	fortWorth  = point{32.75, -97.33}
	frankfurt  = point{50.11, 8.68}
	washington = point{38.91, -77.04}
	singapore  = point{1.35, 103.82}
	sydney     = point{-33.87, 151.21}
)

func TestEstimatesMatchThePingsFromFortWorth(t *testing.T) {
	// U1's minimum pings from the Mac in Fort Worth, 2026-10-16.
	for region, pinged := range map[string]float32{"us-east-1": 46, "eu-central-1": 144, "ap-southeast-1": 206} {
		got := estimateMs(fortWorth, regionSites[region])
		if math.Abs(float64(got-pinged)) > 20 {
			t.Errorf("%v: estimate %.0f ms, pinged %.0f ms", region, got, pinged)
		}
	}
	if got := estimateMs(frankfurt, frankfurt); got != baseMs {
		t.Errorf("estimate in place = %v, want the %v ms base", got, baseMs)
	}
}

func TestNearest(t *testing.T) {
	for _, tc := range []struct {
		from    string
		at      point
		enabled []string
		want    string
	}{
		{"Frankfurt", frankfurt, testRegions, "eu-central-1"},
		{"Washington DC", washington, testRegions, "us-east-1"},
		{"Singapore", singapore, testRegions, "ap-southeast-1"},
		{"Sydney", sydney, testRegions, "ap-southeast-1"},
		{"Fort Worth", fortWorth, testRegions, "us-east-1"},
		{"Sydney, Europe only", sydney, []string{"eu-central-1"}, "eu-central-1"},
		{"Singapore, no Asia", singapore, []string{"us-east-1", "eu-central-1"}, "eu-central-1"},
	} {
		if got := nearest(tc.enabled, tc.at); got != tc.want {
			t.Errorf("from %v: %v, want %v", tc.from, got, tc.want)
		}
	}
}

func lat(user, region string, ms float32) runtime.FleetUserLatencies {
	return runtime.FleetUserLatencies{UserId: user, RegionIdentifier: region, LatencyInMilliseconds: ms}
}

// The cases v0.2.0's own tests hold regionFromLatencies to
// (fleetmanager/gameye_test.go, TestCreateLatency* and
// TestCreatePicksRegionWithLowestWorstLatency), with "europe" its configured
// region: expected must agree on every one.
func TestExpectedAgreesWithTheFleetManagersCases(t *testing.T) {
	nan, inf := float32(math.NaN()), float32(math.Inf(1))
	for _, tc := range []struct {
		name      string
		userIds   []string
		latencies []runtime.FleetUserLatencies
		want      string
	}{
		{"lowest worst case", []string{"u1", "u2"}, []runtime.FleetUserLatencies{
			lat("u1", "eu-central-1", 5), lat("u2", "eu-central-1", 90),
			lat("u1", "eu-south-1", 40), lat("u2", "eu-south-1", 45),
		}, "eu-south-1"},
		{"tie goes to the lower mean", []string{"u1", "u2"}, []runtime.FleetUserLatencies{
			lat("u1", "b", 50), lat("u2", "b", 50),
			lat("u1", "a", 50), lat("u2", "a", 50),
			lat("u1", "c", 50), lat("u2", "c", 10),
		}, "c"},
		{"full tie goes to the name", []string{"u1"}, []runtime.FleetUserLatencies{lat("u1", "b", 20), lat("u1", "a", 20)}, "a"},
		{"only regions every user reported", []string{"u1", "u2"}, []runtime.FleetUserLatencies{
			lat("u1", "eu-central-1", 5),
			lat("u1", "eu-west-1", 30), lat("u2", "eu-west-1", 35),
		}, "eu-west-1"},
		{"a user reported nothing", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "eu-west-1", 30)}, "europe"},
		{"NaN ignored", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "a", 40), lat("u2", "a", nan), lat("u1", "b", 40), lat("u2", "b", 45)}, "b"},
		{"negative ignored", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "a", 40), lat("u2", "a", -500), lat("u1", "b", 40), lat("u2", "b", 45)}, "b"},
		{"infinite ignored", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "a", 40), lat("u2", "a", inf), lat("u1", "b", 40), lat("u2", "b", 45)}, "b"},
		{"lowest of repeated entries", []string{"u1"}, []runtime.FleetUserLatencies{lat("u1", "a", 90), lat("u1", "a", 10), lat("u1", "b", 20)}, "a"},
		{"no user ids: every reporter", nil, []runtime.FleetUserLatencies{lat("u1", "a", 10), lat("u2", "a", 80), lat("u1", "b", 30), lat("u2", "b", 30)}, "b"},
		{"other users ignored", []string{"u1"}, []runtime.FleetUserLatencies{lat("u1", "eu-west-1", 30), lat("u1", "eu-central-1", 20), lat("stranger", "eu-central-1", 500)}, "eu-central-1"},
		{"no latencies", []string{"u1", "u2"}, nil, "europe"},
		{"no common region", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "eu-west-1", 30), lat("u2", "eu-central-1", 30)}, "europe"},
		{"empty region ids", []string{"u1", "u2"}, []runtime.FleetUserLatencies{lat("u1", "", 30), lat("u2", "", 30)}, "europe"},
	} {
		for range 20 { // map order: a rule that leans on it fails some runs
			if got := expected(tc.userIds, tc.latencies, "europe"); got != tc.want {
				t.Errorf("%v: %v, want %v", tc.name, got, tc.want)
				break
			}
		}
	}
}

func TestExpectedFromGeoEstimates(t *testing.T) {
	both := func(a, b point) []runtime.FleetUserLatencies {
		return append(estimates("a", a, testRegions), estimates("b", b, testRegions)...)
	}
	for _, tc := range []struct {
		name      string
		userIds   []string
		latencies []runtime.FleetUserLatencies
		want      string
	}{
		{"one player in Sydney", []string{"a"}, estimates("a", sydney, testRegions), "ap-southeast-1"},
		{"two in Frankfurt", []string{"a", "b"}, both(frankfurt, point{48.86, 2.35}), "eu-central-1"},
		// Fort Worth to Frankfurt ~144 ms beats Singapore to Virginia ~216 ms.
		{"Fort Worth and Singapore", []string{"a", "b"}, both(fortWorth, singapore), "eu-central-1"},
		{"two in one place", []string{"a", "b"}, both(washington, washington), "us-east-1"},
		{"one player without a token", []string{"a", "b"}, estimates("a", sydney, testRegions), "eu-central-1"},
	} {
		if got := expected(tc.userIds, tc.latencies, "eu-central-1"); got != tc.want {
			t.Errorf("%v: %v, want %v", tc.name, got, tc.want)
		}
	}

	// nearest is expected for one player, wherever they are.
	for lat := -80.0; lat <= 80; lat += 20 {
		for lon := -170.0; lon <= 170; lon += 20 {
			at := point{lat, lon}
			if n, e := nearest(testRegions, at), expected([]string{"u"}, estimates("u", at, testRegions), "eu-central-1"); n != e {
				t.Errorf("at %v: nearest %v, expected %v", at, n, e)
			}
		}
	}
}

// --- the gameye_region RPC ----------------------------------------------------

func TestRegionRpc(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)
	expired, _ := sign(testRelaySecret, map[string]any{"t": "geo", "lat": 1.35, "lon": 103.82, "exp": testIssued.Unix() - 1})
	forged, _ := sign([]byte("another-secret-another-secret-another"), map[string]any{"t": "geo", "lat": 1.35, "lon": 103.82, "exp": testIssued.Unix() + 600})

	const enabled = `,"regions":["eu-central-1","us-east-1","ap-southeast-1"]}`
	for name, tc := range map[string]struct{ payload, want string }{
		"Singapore":        {`{"geo":"` + geoAt(singapore) + `"}`, `{"region":"ap-southeast-1"`},
		"Washington DC":    {`{"geo":"` + geoAt(washington) + `"}`, `{"region":"us-east-1"`},
		"expired":          {`{"geo":"` + expired + `"}`, `{"region":"eu-central-1"`},
		"another secret":   {`{"geo":"` + forged + `"}`, `{"region":"eu-central-1"`},
		"not a token":      {`{"geo":"v1.x.y"}`, `{"region":"eu-central-1"`},
		"geo not a string": {`{"geo":7}`, `{"region":"eu-central-1"`},
		"empty object":     {`{}`, `{"region":"eu-central-1"`},
		"empty":            {``, `{"region":"eu-central-1"`},
		"not json":         {`not json`, `{"region":"eu-central-1"`},

		"picked, from Singapore":      {`{"geo":"` + geoAt(singapore) + `","region":"us-east-1"}`, `{"region":"us-east-1"`},
		"picked, without a token":     {`{"region":"ap-southeast-1"}`, `{"region":"ap-southeast-1"`},
		"picked, an expired token":    {`{"geo":"` + expired + `","region":"us-east-1"}`, `{"region":"us-east-1"`},
		"picked, not enabled":         {`{"geo":"` + geoAt(singapore) + `","region":"sa-east-1"}`, `{"region":"ap-southeast-1"`},
		"picked, unknown, no token":   {`{"region":"nowhere"}`, `{"region":"eu-central-1"`},
		"picked, empty":               {`{"geo":"` + geoAt(washington) + `","region":""}`, `{"region":"us-east-1"`},
		"picked, region not a string": {`{"region":7}`, `{"region":"eu-central-1"`},
	} {
		reply, err := m.region(soloCtx("user-a"), logger, nil, nk, tc.payload)
		if want := tc.want + enabled; err != nil || reply != want {
			t.Errorf("%v: (%s, %v), want %s", name, reply, err, want)
		}
	}
	if logs := logger.all(); strings.Contains(logs, "103.82") || strings.Contains(logs, "v1.") {
		t.Errorf("the logs carry a coordinate or a token: %v", logs)
	}
	if calls := fleet.createCalls(); len(calls) != 0 {
		t.Errorf("%d Create calls, want 0", len(calls))
	}
}

// The enabled list keeps GAMEYE_API_REGIONS' order, whatever it is.
func TestRegionRpcListsTheEnabledRegionsInOrder(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	logger := &fakeLogger{}
	m := newGameyeMatches(fleet, nk, logger, testRelaySecret, testRelayUrl, []string{"us-east-1", "eu-central-1"}, "us-east-1")
	m.now = func() time.Time { return testIssued }
	reply, err := m.region(soloCtx("user-a"), logger, nil, nk, `{"region":"ap-southeast-1"}`)
	if want := `{"region":"us-east-1","regions":["us-east-1","eu-central-1"]}`; err != nil || reply != want {
		t.Errorf("(%s, %v), want %s: a region not enabled here is not picked", reply, err, want)
	}
}

// --- a picked region -----------------------------------------------------------

func TestPickedRegion(t *testing.T) {
	for _, tc := range []struct {
		name    string
		regions []string
		chosen  bool
		want    string
		forced  bool
	}{
		{"one picked", []string{"us-east-1"}, true, "us-east-1", true},
		{"all agree", []string{"eu-central-1", "eu-central-1", "eu-central-1"}, true, "eu-central-1", true},
		{"nobody picked", []string{"eu-central-1", "eu-central-1"}, false, "", false},
		{"not enabled", []string{"sa-east-1", "sa-east-1"}, true, "", false},
		{"empty", []string{""}, true, "", false},
		{"no tickets", nil, true, "", false},
		{"tickets disagree", []string{"eu-central-1", "us-east-1"}, true, "", false},
		{"one ticket without a region", []string{"eu-central-1", ""}, true, "", false},
	} {
		if got, forced := pickedRegion(tc.regions, tc.chosen, testRegions); got != tc.want || forced != tc.forced {
			t.Errorf("%v: (%q, %v), want (%q, %v)", tc.name, got, forced, tc.want, tc.forced)
		}
	}
}

// queued is a Gameye ticket as the page queues it: in region, picked or not.
func queued(userId, geo, region string, pick bool) runtime.MatchmakerEntry {
	properties := map[string]any{"mode": "gameye", "build": "b1", "region": region, "geo": geo}
	if pick {
		properties["pick"] = "1"
	}
	return fakeEntry{userId: userId, ticket: "ticket-" + userId, properties: properties}
}

// One player in Fort Worth picked Frankfurt; two in Frankfurt queued there as
// their nearest. By the estimates alone Virginia wins (worst case ~110 ms,
// against ~129 ms in Frankfurt), so only the override starts it where they
// all queued.
func TestMatchedStartsInThePickedRegion(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)
	entries := []runtime.MatchmakerEntry{
		queued("user-a", geoAt(fortWorth), "eu-central-1", true),
		queued("user-b", geoAt(frankfurt), "eu-central-1", false),
		queued("user-c", geoAt(frankfurt), "eu-central-1", false),
	}
	if by := expected([]string{"user-a", "user-b", "user-c"}, fleetLatencies(m, entries), "eu-central-1"); by != "us-east-1" {
		t.Fatalf("the estimates alone pick %v, want us-east-1 for this case to mean anything", by)
	}

	_, _ = m.matched(context.Background(), logger, nil, nk, entries)
	for range 3 {
		if n := nk.next(t); n.Content["region"] != "eu-central-1" {
			t.Errorf("%v's region = %v, want the picked eu-central-1", n.UserID, n.Content["region"])
		}
	}
	calls := fleet.createCalls()
	if len(calls) != 1 || calls[0].metadata["gameye.region"] != "eu-central-1" {
		t.Fatalf("Create calls = %+v, want one with gameye.region eu-central-1", calls)
	}
	if len(calls[0].latencies) != 9 {
		t.Errorf("%d latencies, want the nine estimates still passed", len(calls[0].latencies))
	}
}

func fleetLatencies(m *gameyeMatches, entries []runtime.MatchmakerEntry) []runtime.FleetUserLatencies {
	var latencies []runtime.FleetUserLatencies
	for _, e := range entries {
		geo, _ := e.GetProperties()["geo"].(string)
		latencies = append(latencies, m.estimates(e.GetPresence().GetUserId(), geo)...)
	}
	return latencies
}

func TestMatchedLeavesAnUnusablePickToTheEstimates(t *testing.T) {
	for name, entries := range map[string][]runtime.MatchmakerEntry{
		"nobody picked": {
			queued("user-a", geoAt(fortWorth), "eu-central-1", false),
			queued("user-b", geoAt(frankfurt), "eu-central-1", false),
			queued("user-c", geoAt(frankfurt), "eu-central-1", false),
		},
		"a region not enabled": {
			queued("user-a", geoAt(fortWorth), "sa-east-1", true),
			queued("user-b", geoAt(frankfurt), "sa-east-1", false),
			queued("user-c", geoAt(frankfurt), "sa-east-1", false),
		},
		"tickets that disagree": {
			queued("user-a", geoAt(fortWorth), "eu-central-1", true),
			queued("user-b", geoAt(frankfurt), "us-east-1", false),
			queued("user-c", geoAt(frankfurt), "eu-central-1", false),
		},
	} {
		t.Run(name, func(t *testing.T) {
			fleet, nk := &fakeFleet{}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			_, _ = m.matched(context.Background(), logger, nil, nk, entries)
			for range 3 {
				if n := nk.next(t); n.Content["region"] != "us-east-1" {
					t.Errorf("%v's region = %v, want us-east-1, by the estimates", n.UserID, n.Content["region"])
				}
			}
			calls := fleet.createCalls()
			if _, ok := calls[0].metadata["gameye.region"]; ok || len(calls[0].latencies) != 9 {
				t.Errorf("Create = %+v, want the nine estimates and no gameye.region", calls[0])
			}
		})
	}
}

func TestRetriesKeepThePickedRegion(t *testing.T) {
	fleet, nk := &fakeFleet{outcomes: []outcome{{runtime.CreateError, apiError(420)}}}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{queued("user-a", geoAt(washington), "ap-southeast-1", true), queued("user-b", geoAt(washington), "ap-southeast-1", true)})
	nk.next(t)
	nk.next(t)
	calls := fleet.createCalls()
	if len(calls) != 2 || calls[0].metadata["gameye.region"] != "ap-southeast-1" || calls[1].metadata["gameye.region"] != "ap-southeast-1" {
		t.Errorf("Create calls = %+v, want the retry in the picked region too", calls)
	}
}

func TestSoloMatchStartsInThePickedRegion(t *testing.T) {
	for name, tc := range map[string]struct {
		payload, want string
		forced        bool
	}{
		"picked":                  {`{"geo":"` + geoAt(sydney) + `","region":"us-east-1"}`, "us-east-1", true},
		"picked, resumed":         {`{"resume":true,"geo":"` + geoAt(sydney) + `","region":"us-east-1"}`, "us-east-1", true},
		"picked, without a token": {`{"region":"ap-southeast-1"}`, "ap-southeast-1", true},
		"not enabled":             {`{"geo":"` + geoAt(sydney) + `","region":"sa-east-1"}`, "ap-southeast-1", false},
	} {
		t.Run(name, func(t *testing.T) {
			fleet, nk := &fakeFleet{}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			if reply, err := m.soloMatch(soloCtx("user-a"), logger, nil, nk, tc.payload); err != nil || reply != `{"status":"starting"}` {
				t.Fatalf("solo = (%s, %v), want starting", reply, err)
			}
			if n := nk.next(t); n.Content["region"] != tc.want {
				t.Errorf("region = %v, want %v", n.Content["region"], tc.want)
			}
			region, ok := fleet.createCalls()[0].metadata["gameye.region"]
			if ok != tc.forced || (ok && region != tc.want) {
				t.Errorf("gameye.region = %v (set: %v), want %v (set: %v)", region, ok, tc.want, tc.forced)
			}
		})
	}
}

// --- latencies into the fleet manager, the region into the notification ------

func TestMatchedPassesEstimatesAndNotifiesTheRegion(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)
	geoA, geoB := geoAt(singapore), geoAt(sydney)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{geoEntry("user-a", geoA), geoEntry("user-b", geoB)})
	first, second := nk.next(t), nk.next(t)

	calls := fleet.createCalls()
	if len(calls) != 1 {
		t.Fatalf("%d Create calls, want 1", len(calls))
	}
	got := map[string]float32{}
	for _, l := range calls[0].latencies {
		got[l.UserId+" "+l.RegionIdentifier] = l.LatencyInMilliseconds
	}
	if len(calls[0].latencies) != 6 || len(got) != 6 {
		t.Fatalf("latencies = %+v, want one per player per enabled region", calls[0].latencies)
	}
	for _, region := range testRegions {
		if want := estimateMs(singapore, regionSites[region]); got["user-a "+region] != want {
			t.Errorf("user-a to %v = %v, want %v", region, got["user-a "+region], want)
		}
		if want := estimateMs(sydney, regionSites[region]); got["user-b "+region] != want {
			t.Errorf("user-b to %v = %v, want %v", region, got["user-b "+region], want)
		}
	}
	for _, n := range []*runtime.NotificationSend{first, second} {
		if n.Content["region"] != "ap-southeast-1" {
			t.Errorf("%v's region = %v, want ap-southeast-1", n.UserID, n.Content["region"])
		}
	}

	logs := logger.all()
	if !strings.Contains(logs, "ap-southeast-1") {
		t.Errorf("the chosen region isn't logged: %v", logs)
	}
	if strings.Contains(logs, geoA) || strings.Contains(logs, "103.82") || strings.Contains(logs, "151.21") {
		t.Error("the logs carry a geo token or a coordinate")
	}
}

func TestMatchedWithAPlayerWithoutAGoodTokenFallsBack(t *testing.T) {
	expired, _ := sign(testRelaySecret, map[string]any{"t": "geo", "lat": 1.35, "lon": 103.82, "exp": testIssued.Unix() - 1})
	for name, other := range map[string]runtime.MatchmakerEntry{
		"no geo property":  gameyeEntry("user-b"),
		"an expired token": geoEntry("user-b", expired),
		"a forged token":   geoEntry("user-b", "v1.eyJ0IjoiZ2VvIn0.AAAA"),
	} {
		t.Run(name, func(t *testing.T) {
			fleet, nk := &fakeFleet{}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{geoEntry("user-a", geoAt(singapore)), other})
			for range 2 {
				if n := nk.next(t); n.Content["region"] != "eu-central-1" {
					t.Errorf("%v's region = %v, want the fallback eu-central-1", n.UserID, n.Content["region"])
				}
			}
			for _, l := range fleet.createCalls()[0].latencies {
				if l.UserId != "user-a" {
					t.Errorf("a latency for %v, who has no good token", l.UserId)
				}
			}
		})
	}
}

func TestMatchedWithoutAnyTokenPassesNoLatencies(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{gameyeEntry("user-a"), gameyeEntry("user-b")})
	if n := nk.next(t); n.Content["region"] != "eu-central-1" {
		t.Errorf("region = %v, want eu-central-1", n.Content["region"])
	}
	nk.next(t)
	call := fleet.createCalls()[0]
	if len(call.latencies) != 0 {
		t.Errorf("latencies = %+v, want none", call.latencies)
	}
	if _, ok := call.metadata["gameye.region"]; ok {
		t.Error("gameye.region is set, but nobody picked a region")
	}
}

func TestRetriesKeepTheLatencies(t *testing.T) {
	fleet, nk := &fakeFleet{outcomes: []outcome{{runtime.CreateError, apiError(420)}}}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)

	_, _ = m.matched(context.Background(), logger, nil, nk, []runtime.MatchmakerEntry{geoEntry("user-a", geoAt(washington)), geoEntry("user-b", geoAt(washington))})
	if n := nk.next(t); n.Content["region"] != "us-east-1" {
		t.Errorf("region = %v, want us-east-1", n.Content["region"])
	}
	nk.next(t)
	calls := fleet.createCalls()
	if len(calls) != 2 || len(calls[1].latencies) != 6 || fmt.Sprint(calls[0].latencies) != fmt.Sprint(calls[1].latencies) {
		t.Errorf("Create calls = %+v, want the retry with the same six latencies", calls)
	}
}

func TestSoloMatchTakesTheGeoToken(t *testing.T) {
	for name, payload := range map[string]string{
		"fresh":  `{"geo":"` + geoAt(sydney) + `"}`,
		"resume": `{"resume":true,"geo":"` + geoAt(sydney) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			fleet, nk := &fakeFleet{}, newFakeNk()
			m, logger := newTestMatches(fleet, nk)

			reply, err := m.soloMatch(soloCtx("user-a"), logger, nil, nk, payload)
			if err != nil || reply != `{"status":"starting"}` {
				t.Fatalf("solo = (%s, %v), want starting", reply, err)
			}
			n := nk.next(t)
			if n.Content["region"] != "ap-southeast-1" {
				t.Errorf("region = %v, want ap-southeast-1", n.Content["region"])
			}
			calls := fleet.createCalls()
			if len(calls) != 1 || len(calls[0].latencies) != 3 {
				t.Fatalf("Create calls = %+v, want one with three latencies", calls)
			}
			for _, l := range calls[0].latencies {
				if l.UserId != "user-a" || l.LatencyInMilliseconds != estimateMs(sydney, regionSites[l.RegionIdentifier]) {
					t.Errorf("latency %+v", l)
				}
			}

			// The resume that hands the match back carries the region too.
			if reply, _ := m.soloMatch(soloCtx("user-a"), logger, nil, nk, `{"resume":true,"geo":"`+geoAt(sydney)+`"}`); !strings.Contains(reply, `"region":"ap-southeast-1"`) {
				t.Errorf("resume = %s, want the match with its region", reply)
			}
		})
	}
}

func TestSoloMatchWithABadTokenStartsInTheFallback(t *testing.T) {
	fleet, nk := &fakeFleet{}, newFakeNk()
	m, logger := newTestMatches(fleet, nk)
	m.now = func() time.Time { return testIssued.Add(601 * time.Second) } // the token has expired

	_, _ = m.soloMatch(soloCtx("user-a"), logger, nil, nk, `{"geo":"`+geoAt(sydney)+`"}`)
	if n := nk.next(t); n.Content["region"] != "eu-central-1" {
		t.Errorf("region = %v, want eu-central-1", n.Content["region"])
	}
	if l := fleet.createCalls()[0].latencies; len(l) != 0 {
		t.Errorf("latencies = %+v, want none", l)
	}
}

// --- GAMEYE_API_REGIONS ---------------------------------------------------------

func TestReadConfigRegions(t *testing.T) {
	env := func(region, regions string) map[string]string {
		e := map[string]string{
			"GAMEYE_API_TOKEN":         "token",
			"GAMEYE_API_IMAGE":         "scrapyard",
			"GAMEYE_API_IMAGE_VERSION": "v1",
			"GAMEYE_API_REGION":        region,
			"RELAY_SECRET":             strings.Repeat("r", 32),
			"RELAY_URL":                "wss://relay.test",
		}
		if regions != "" {
			e["GAMEYE_API_REGIONS"] = regions
		}
		return e
	}

	for _, tc := range []struct{ region, regions, want string }{
		{"eu-central-1", "", "eu-central-1"},
		{"eu-central-1", "eu-central-1,us-east-1,ap-southeast-1", "eu-central-1 us-east-1 ap-southeast-1"},
		{"us-east-1", " eu-central-1 , us-east-1 ", "eu-central-1 us-east-1"},
		{"eu-west-1", "", "eu-west-1"}, // one region needs no location
	} {
		cfg, err := readConfig(env(tc.region, tc.regions))
		if err != nil {
			t.Errorf("%q / %q: %v", tc.region, tc.regions, err)
			continue
		}
		if got := strings.Join(cfg.regions, " "); got != tc.want || cfg.fleet.Region != tc.region {
			t.Errorf("%q / %q: regions %q fallback %q, want %q fallback %q", tc.region, tc.regions, got, cfg.fleet.Region, tc.want, tc.region)
		}
	}

	for _, tc := range []struct{ name, region, regions, key string }{
		{"fallback not listed", "eu-central-1", "us-east-1,ap-southeast-1", "GAMEYE_API_REGIONS"},
		{"listed twice", "eu-central-1", "eu-central-1,us-east-1,eu-central-1", "GAMEYE_API_REGIONS"},
		{"an empty entry", "eu-central-1", "eu-central-1,,us-east-1", "GAMEYE_API_REGIONS"},
		{"a trailing comma", "eu-central-1", "eu-central-1,", "GAMEYE_API_REGIONS"},
		{"listed region with no location", "eu-central-1", "eu-central-1,sa-east-1", "GAMEYE_API_REGIONS"},
	} {
		_, err := readConfig(env(tc.region, tc.regions))
		if err == nil {
			t.Errorf("%v: accepted", tc.name)
			continue
		}
		if !strings.Contains(err.Error(), tc.key) {
			t.Errorf("%v: %q doesn't name %v", tc.name, err, tc.key)
		}
		if strings.Contains(err.Error(), "sa-east-1") || strings.Contains(err.Error(), "europe") {
			t.Errorf("%v: %q quotes a value", tc.name, err)
		}
	}
}

func TestOneRegionWithoutASite(t *testing.T) {
	at := point{50.1155, 8.6842}
	if got := estimates("u1", at, []string{"eu-west-1"}); len(got) != 0 {
		t.Fatalf("estimates for a region with no site: %v, want none", got)
	}
	if got := nearest([]string{"eu-west-1"}, at); got != "eu-west-1" {
		t.Fatalf("nearest = %q, want the one region", got)
	}
}
