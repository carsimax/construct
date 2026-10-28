// The state contract of the Construct mod: the band's value (hooks/band/state.js)
// kept under a shape tag, so a reload whose schema version differs reads it as absent.

export type ConstructBand = {
  v: number
  agents: readonly Record<string, unknown>[]
  inline: { count: number }
  gate: {
    verdicts: { rule: number; ask: number; cleared: number; deny: number }
    pending: Record<string, string>
  }
  turn: { turnId: string | null } | null
  blocked: boolean
}

declare module 'claude-code' {
  interface PluginState {
    construct: { band: Shaped<ConstructBand> }
  }
}
