// Command main is Scrapyard's Nakama plugin for Gameye: every match the
// matchmaker forms from mode=gameye tickets, and every gameye_solo_match
// call, runs in a Gameye session of its own, and its players are told how
// to reach it. The formats it shares with the page, the relay and the game
// server are in the root AGENTS.md (Contracts).
package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/Gameye/nakama-fleetmanager/fleetmanager"
	"github.com/heroiclabs/nakama-common/runtime"
)

// Nakama runtime.env keys. The GAMEYE_API_* names are the fleet manager's
// own; RELAY_SECRET is shared with the relay. TTL, PORT, URL, REGIONS and
// MAX_SESSIONS may be left out.
const (
	envUrl          = "GAMEYE_API_URL"
	envToken        = "GAMEYE_API_TOKEN"
	envImage        = "GAMEYE_API_IMAGE"
	envImageVersion = "GAMEYE_API_IMAGE_VERSION"
	envRegion       = "GAMEYE_API_REGION"
	envRegions      = "GAMEYE_API_REGIONS"
	envTtl          = "GAMEYE_API_TTL"
	envPort         = "GAMEYE_API_PORT"
	envRelaySecret  = "RELAY_SECRET"
	envRelayUrl     = "RELAY_URL"
	envMaxSessions  = "GAMEYE_MAX_SESSIONS"
)

const (
	// defaultPort is the game server's port (game/server/main.ts).
	defaultPort = "7360/tcp"

	// minRelaySecret is the shortest RELAY_SECRET taken: 32 bytes, as long
	// as the HMAC-SHA256 it keys.
	minRelaySecret = 32

	// createTimeout bounds a session start, so a player who waits hears of a
	// failure well within the page's 60 s search.
	createTimeout = 20 * time.Second

	// defaultMaxSessions caps sessions live or starting: one under the
	// self-serve sandbox's 5 containers, so the cap answers before Gameye's
	// 429 does.
	defaultMaxSessions = 4
)

type config struct {
	fleet       fleetmanager.GameyeConfig
	relaySecret []byte
	relayUrl    string
	// regions are the enabled Gameye regions, the fallback (fleet.Region)
	// among them.
	regions []string
	// maxSessions: 0 is no cap.
	maxSessions int
}

// readConfig reads the plugin's runtime.env. Its errors name keys, never
// values.
func readConfig(env map[string]string) (config, error) {
	var problems []error
	for _, key := range []string{envToken, envImage, envImageVersion, envRegion, envRelayUrl} {
		if env[key] == "" {
			problems = append(problems, fmt.Errorf("runtime env %v is missing", key))
		}
	}
	if len(env[envRelaySecret]) < minRelaySecret {
		problems = append(problems, fmt.Errorf("runtime env %v must be at least %d bytes", envRelaySecret, minRelaySecret))
	}
	regions, err := readRegions(env[envRegions], env[envRegion])
	if err != nil {
		problems = append(problems, err)
	}
	maxSessions := defaultMaxSessions
	if v := env[envMaxSessions]; v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			problems = append(problems, fmt.Errorf("runtime env %v must be a whole number, 0 for no cap", envMaxSessions))
		}
		maxSessions = n
	}
	if err := errors.Join(problems...); err != nil {
		return config{}, err
	}

	port := env[envPort]
	if port == "" {
		port = defaultPort
	}
	return config{
		fleet: fleetmanager.GameyeConfig{
			BaseUrl:       env[envUrl], // empty: the package's default, Gameye's self-serve API
			ApiToken:      env[envToken],
			Image:         env[envImage],
			Version:       env[envImageVersion],
			Region:        env[envRegion],
			Ttl:           env[envTtl],
			Port:          port,
			CreateTimeout: createTimeout,
		},
		relaySecret: []byte(env[envRelaySecret]),
		relayUrl:    env[envRelayUrl],
		regions:     regions,
		maxSessions: maxSessions,
	}, nil
}

// readRegions reads GAMEYE_API_REGIONS, a comma list; unset, the enabled
// regions are GAMEYE_API_REGION alone, which needs no location: with one
// region there is nothing to choose. A listed region must be in regionSites,
// and the fallback among them. Its errors name keys, never values.
func readRegions(list, fallback string) ([]string, error) {
	if fallback == "" {
		return nil, nil // reported as missing already
	}
	if list == "" {
		return []string{fallback}, nil
	}
	var regions []string
	for _, region := range strings.Split(list, ",") {
		region = strings.TrimSpace(region)
		if region == "" {
			return nil, fmt.Errorf("runtime env %v has an empty entry", envRegions)
		}
		if slices.Contains(regions, region) {
			return nil, fmt.Errorf("runtime env %v lists a region twice", envRegions)
		}
		if _, ok := regionSites[region]; !ok {
			return nil, fmt.Errorf("runtime env %v names a region the plugin has no location for (regions.go)", envRegions)
		}
		regions = append(regions, region)
	}
	if !slices.Contains(regions, fallback) {
		return nil, fmt.Errorf("runtime env %v must list %v", envRegions, envRegion)
	}
	return regions, nil
}

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	start := time.Now()

	env, _ := ctx.Value(runtime.RUNTIME_CTX_ENV).(map[string]string)
	cfg, err := readConfig(env)
	if err != nil {
		return err
	}

	// The InitModule context: the fleet manager's reaper runs on it.
	fm, err := fleetmanager.NewGameyeFleetManager(ctx, cfg.fleet, logger, db, initializer, nk)
	if err != nil {
		return err
	}
	if err := initializer.RegisterFleetManager(fm); err != nil {
		return err
	}

	matches := newGameyeMatches(fm, nk, logger, cfg.relaySecret, cfg.relayUrl, cfg.regions, cfg.fleet.Region, cfg.maxSessions)
	if err := initializer.RegisterMatchmakerMatched(matches.matched); err != nil {
		return err
	}
	if err := initializer.RegisterRpc(soloRpc, matches.soloMatch); err != nil {
		return err
	}
	if err := initializer.RegisterRpc(regionRpc, matches.region); err != nil {
		return err
	}

	logger.Info("Successfully registered the Gameye fleet manager for regions %v, the matchmaker hook for mode=%v tickets and the %v and %v RPCs, which took %v", cfg.regions, modeGameye, soloRpc, regionRpc, time.Since(start))
	return nil
}
