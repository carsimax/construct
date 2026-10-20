// The state contract of the Construct mod: the panel's value (hooks/panel/state.js)
// kept under a shape tag, so a reload whose schema version differs reads it as absent.

export type ConstructPanel = {
  v: number
  agents: readonly Record<string, unknown>[]
  inline: { count: number; last: string | null }
  gate: {
    cells: readonly string[]
    counts: Record<string, number>
    denied: number
    lastDenied: { tool: string; detail: string } | null
    verdicts: { rule: number; ask: number; cleared: number; deny: number }
    buckets: Record<'file' | 'shell' | 'other', { rule: number; ask: number; cleared: number; deny: number }>
  }
  receipt: Record<string, unknown> | null
  compactions: number
  main: { steps: number; model: string | null; effort: string | null; mode: string | null }
}

declare module 'claude-code' {
  interface PluginState {
    construct: { panel: Shaped<ConstructPanel> }
  }
}
