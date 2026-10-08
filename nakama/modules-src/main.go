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
	"time"

	"github.com/Gameye/nakama-fleetmanager/fleetmanager"
	"github.com/heroiclabs/nakama-common/runtime"
)

// Nakama runtime.env keys. The GAMEYE_API_* names are the fleet manager's
// own; RELAY_SECRET is shared with the relay. TTL, PORT and URL may be left
// out.
const (
	envUrl          = "GAMEYE_API_URL"
	envToken        = "GAMEYE_API_TOKEN"
	envImage        = "GAMEYE_API_IMAGE"
	envImageVersion = "GAMEYE_API_IMAGE_VERSION"
	envRegion       = "GAMEYE_API_REGION"
	envTtl          = "GAMEYE_API_TTL"
	envPort         = "GAMEYE_API_PORT"
	envRelaySecret  = "RELAY_SECRET"
	envRelayUrl     = "RELAY_URL"
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
)

type config struct {
	fleet       fleetmanager.GameyeConfig
	relaySecret []byte
	relayUrl    string
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
	}, nil
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

	matches := newGameyeMatches(fm, nk, logger, cfg.relaySecret, cfg.relayUrl)
	if err := initializer.RegisterMatchmakerMatched(matches.matched); err != nil {
		return err
	}
	if err := initializer.RegisterRpc(soloRpc, matches.soloMatch); err != nil {
		return err
	}

	logger.Info("Successfully registered the Gameye fleet manager, the matchmaker hook for mode=%v tickets and the %v RPC, which took %v", modeGameye, soloRpc, time.Since(start))
	return nil
}
