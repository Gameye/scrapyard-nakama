package main

import (
	"math"

	"github.com/heroiclabs/nakama-common/runtime"
)

// point is a place on Earth, in degrees.
type point struct{ lat, lon float64 }

// regionSites holds where Gameye's servers for each region are, measured
// (plan U1, 2026-10-16), not where the AWS region of that name is.
var regionSites = map[string]point{
	"eu-central-1":   {50.1155, 8.6842},   // OVH Frankfurt
	"us-east-1":      {38.7135, -77.7953}, // OVH Warrenton, Virginia
	"ap-southeast-1": {1.3371, 103.8946},  // G-Core Singapore
}

const (
	earthRadiusKm = 6371
	// A least-squares fit to U1's pings from Fort Worth (46, 144 and 206 ms):
	// only the order between regions decides a match, not the number.
	kmPerMs = 86
	baseMs  = 33
)

// estimateMs is the estimated round trip, in ms, between two places.
func estimateMs(from, to point) float32 {
	rad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat, dLon := rad(to.lat-from.lat), rad(to.lon-from.lon)
	h := math.Pow(math.Sin(dLat/2), 2) + math.Cos(rad(from.lat))*math.Cos(rad(to.lat))*math.Pow(math.Sin(dLon/2), 2)
	km := 2 * earthRadiusKm * math.Asin(math.Sqrt(h))
	return float32(km/kmPerMs + baseMs)
}

// estimates is one player's estimated round trip to each enabled region, as
// the Fleet Manager takes them. A region with no site (a single configured
// region readConfig lets through) gets none, so the session falls back to it.
func estimates(userId string, at point, enabled []string) []runtime.FleetUserLatencies {
	latencies := make([]runtime.FleetUserLatencies, 0, len(enabled))
	for _, region := range enabled {
		site, ok := regionSites[region]
		if !ok {
			continue
		}
		latencies = append(latencies, runtime.FleetUserLatencies{
			UserId:                userId,
			RegionIdentifier:      region,
			LatencyInMilliseconds: estimateMs(at, site),
		})
	}
	return latencies
}

// nearest is the enabled region with the lowest estimate from at: the region
// expected would pick for one player there.
func nearest(enabled []string, at point) string {
	return expected([]string{""}, estimates("", at, enabled), enabled[0])
}

// expected is the region the Fleet Manager starts a session in for these
// players and latencies, or fallback (its configured region) when it would
// pick none. A copy of v0.2.0's regionFromLatencies (fleetmanager/gameye.go),
// so the region the page is shown is the one the session gets: change both
// together. Among the regions every user reported, the lowest worst-case
// latency wins; ties go to the lower total, then to the region name. A user
// without a valid latency means fallback.
func expected(userIds []string, latencies []runtime.FleetUserLatencies, fallback string) string {
	users := make(map[string]bool, len(userIds))
	for _, id := range userIds {
		users[id] = true
	}

	byRegion := make(map[string]map[string]float32)
	reporting := make(map[string]bool)
	for _, l := range latencies {
		ms := float64(l.LatencyInMilliseconds)
		if l.RegionIdentifier == "" || !(ms >= 0) || math.IsInf(ms, 1) {
			continue
		}
		if len(users) > 0 && !users[l.UserId] {
			continue
		}
		reporting[l.UserId] = true
		byUser := byRegion[l.RegionIdentifier]
		if byUser == nil {
			byUser = make(map[string]float32)
			byRegion[l.RegionIdentifier] = byUser
		}
		if prev, ok := byUser[l.UserId]; !ok || l.LatencyInMilliseconds < prev {
			byUser[l.UserId] = l.LatencyInMilliseconds
		}
	}
	if len(users) > 0 && len(reporting) < len(users) {
		return fallback
	}

	best := ""
	var bestWorst, bestTotal float32
	for region, byUser := range byRegion {
		if len(byUser) != len(reporting) {
			continue
		}
		var worst, total float32
		for _, ms := range byUser {
			worst = max(worst, ms)
			total += ms
		}
		if best == "" ||
			worst < bestWorst ||
			(worst == bestWorst && total < bestTotal) ||
			(worst == bestWorst && total == bestTotal && region < best) {
			best, bestWorst, bestTotal = region, worst, total
		}
	}
	if best == "" {
		return fallback
	}
	return best
}
