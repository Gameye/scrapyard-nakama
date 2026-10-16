// The arena screen's server picker, Classic's: one game server, nothing to
// pick. A Gameye build gets gameye-match.ts's in its place (matchmaker.ts),
// which offers the regions the plugin has enabled (gameye-queue.ts).

export const AUTO = 'auto' // the nearest region, the plugin's choice

// The picker's options, in the plugin's order, and the pick: AUTO or one of
// their ids (a remembered region no longer enabled is AUTO).
export interface Servers {
  regions: ReadonlyArray<{ id: string; name: string }>
  choice: string
}

const NONE: Servers = { regions: [], choice: AUTO }

export const currentServers = () => NONE
export const onServers = (_listener: () => void) => () => {}
export const chooseServer = (_choice: string) => {}
