import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const NOW = Date.parse('2026-11-20T09:00:00Z')

const CONTEXT = { tokens: 315_500, window: 1_000_000, percent: 32 }

const RATE_LIMITS = [
  { kind: 'seven_day', percentUsed: 71, resetsAt: '2026-11-22T09:00:00Z' },
  { kind: 'five_hour', percentUsed: 79, resetsAt: '2026-11-20T11:30:00Z' },
]

const BREAKDOWN = {
  categories: [
    { name: 'Messages', tokens: 258_700, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 19_400, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 600_000, color: 'subtle', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 278_100,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 28,
}

test('the band draws the context and both limits, on every surface', async ($, on, mock) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      context: e.breakdown ? { ...CONTEXT, breakdown: BREAKDOWN } : CONTEXT,
      rateLimits: RATE_LIMITS,
    },
  }))
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: CONTEXT,
    rateLimits: RATE_LIMITS,
    changed: ['context', 'rateLimits'],
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect(await ui.find({ type: 'Text', text: 'Context' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^32%$/ }))?.text).toBe('32%')
    expect((await ui.find({ type: 'Text', text: /316K/ }))?.text).toBe('316K/1M')
    expect((await ui.find({ type: 'Text', text: /^79%$/ }))?.text).toBe('79%')
    expect((await ui.find({ type: 'Text', text: /2h 30m/ }))?.text).toBe('↻ 2h 30m')
    expect((await ui.find({ type: 'Text', text: /^71%$/ }))?.text).toBe('71%')
    expect((await ui.find({ type: 'Text', text: /2d 0h/ }))?.text).toBe('↻ 2d 0h')
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(svg).toBeDefined()
    }
    await ui.unmount()
  }
})

test('with no figures the band yields to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
