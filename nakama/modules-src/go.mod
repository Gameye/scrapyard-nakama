module github.com/Gameye/scrapyard-nakama/nakama/modules-src

go 1.27.1

require (
	github.com/Gameye/nakama-fleetmanager v0.0.0-00010101000000-000000000000
	// Must match the versions Nakama 3.41.0 is built with.
	github.com/heroiclabs/nakama-common v1.48.0
)

require (
	github.com/apapsch/go-jsonmerge/v2 v2.0.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/oapi-codegen/oapi-codegen/v2 v2.4.1 // indirect
	github.com/oapi-codegen/runtime v1.1.1 // indirect
	// Nakama 3.41.0's own version too: keep it when upgrading anything.
	google.golang.org/protobuf v1.36.12 // indirect
)

// TODO: switch to github.com/Gameye/nakama-fleetmanager v0.1.0 once it is
// published, and drop this replace (and the mount in build.sh).
replace github.com/Gameye/nakama-fleetmanager => ../../../nakama-fleetmanager
