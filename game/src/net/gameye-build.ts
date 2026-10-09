// Whether this page is a Gameye build (VITE_MATCHMAKER=gameye, matchmaker.ts).
// Its online matches outside custom lobbies are Gameye sessions of one match
// each, which end after the results (server/gameye-server.ts): the results
// offer Play again — a new quick-play search (gameye-match.ts) — and Exit,
// where Classic's count down to the room's next match.
export const GAMEYE_BUILD = import.meta.env.VITE_MATCHMAKER === 'gameye'
