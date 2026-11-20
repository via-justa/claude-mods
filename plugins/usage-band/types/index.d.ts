/** One category of the context window, as /context colours it. */
export type Segment = {
  name: string
  /** The theme key /context draws the category in. */
  color: string
  tokens: number
  /** The category's share of the whole window, 0 to 100. */
  percent: number
}

/** One rate-limit window. */
export type Limit = {
  kind: string
  percentUsed: number
  /** When the window resets, as an ISO 8601 timestamp. */
  resetsAt?: string
}

/** What the band draws: the last measurement of the session. */
export type Snapshot = {
  context: {
    tokens?: number
    window: number
    percent?: number
    segments: Segment[]
  }
  limits: Limit[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null }
  }
}
