// The state contract of the Construct mod: the panel's value (hooks/panel/state.js)
// kept under a shape tag, so a reload whose schema version differs reads it as absent.

export type ConstructPanel = {
  v: number
  agents: readonly Record<string, unknown>[]
  inline: { count: number; last: string | null }
  gate: Record<string, unknown>
  receipt: Record<string, unknown> | null
  compactions: number
}

declare module 'claude-code' {
  interface PluginState {
    construct: { panel: Shaped<ConstructPanel> }
  }
}
