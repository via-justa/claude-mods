import { expect, test } from 'claude-code/testing'

const BAND = { plugin: 'usage-band', component: 'AbovePrompt', props: { hasSurvey: false } } as const
const CONTEXT = { tokens: 315_500, window: 1_000_000, percent: 32 }
const RATE_LIMITS = [
  { kind: 'five_hour', percentUsed: 79, resetsAt: '2026-11-20T11:30:00Z' },
  { kind: 'seven_day', percentUsed: 71, resetsAt: '2026-11-22T09:00:00Z' },
]
const row = (name: string, tokens: number, color: string, kind = 'used') =>
  ({ name, tokens, color, isDeferred: kind === 'deferred', kind })
const BREAKDOWN = {
  categories: [
    row('System prompt', 9_200, 'promptBorder'),
    row('System tools', 19_400, 'inactive'),
    row('MCP tools', 13_900, 'cyan_FOR_SUBAGENTS_ONLY'),
    row('Custom agents', 1_400, 'permission'),
    row('Memory files', 1_500, 'claude'),
    row('Skills', 10_000, 'warning'),
    row('MCP server instructions', 1_400, 'inactive'),
    row('Messages', 258_700, 'purple_FOR_SUBAGENTS_ONLY'),
    row('Free space', 600_000, 'promptBorder', 'free'),
    row('Autocompact buffer', 33_000, 'inactive', 'buffer'),
  ],
  totalTokens: 315_500, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, percentage: 32,
}

test('a realistic breakdown draws', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-11-20T09:00:00Z') }))
  on('session.usage', (_, e) => ({
    value: { startedAt: 0, context: e.breakdown ? { ...CONTEXT, breakdown: BREAKDOWN } : CONTEXT, rateLimits: RATE_LIMITS },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({ context: CONTEXT, rateLimits: RATE_LIMITS, changed: ['context', 'rateLimits'] })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /^32%$/ }))?.text).toBe('32%')
    await ui.unmount()
  }
})
