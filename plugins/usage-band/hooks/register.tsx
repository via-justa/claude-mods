import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  SessionContextUsage,
  SessionRateLimit,
} from 'claude-code'

import type { Limit, Segment, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'Week',
  spend_limit: 'Spend',
}

const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) {
    return `${Number((n / 1_000_000).toFixed(1))}M`
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}K`
  }
  return String(n)
}

const formatPercent = (n: number): string => `${Math.round(n)}%`

const formatResetIn = (resetsAt: string | undefined, now: number): string => {
  if (!resetsAt) {
    return ''
  }
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) {
    return ''
  }
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const limitColor = (percentUsed: number): string => {
  if (percentUsed >= 90) {
    return 'error'
  }
  if (percentUsed >= 75) {
    return 'warning'
  }
  return 'suggestion'
}

const toLimits = (rateLimits: SessionRateLimit[]): Limit[] =>
  rateLimits
    .map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
    .sort((a, b) => rank(a.kind) - rank(b.kind))

const rank = (kind: string): number => {
  const index = LIMIT_ORDER.indexOf(kind)
  return index === -1 ? LIMIT_ORDER.length : index
}

// The categories /context draws, each scaled so that together they fill the
// bar up to the status line's percentage.
const readSegments = async (
  $: EngineInterface,
  context: SessionContextUsage,
): Promise<Segment[]> => {
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  if (!breakdown || breakdown.totalTokens <= 0) {
    return []
  }
  const filled = context.percent ?? breakdown.percentage
  return breakdown.categories
    .filter(category => category.kind === 'used' && category.tokens > 0)
    .map(({ name, color, tokens }) => ({
      name,
      color,
      tokens,
      percent: (tokens / breakdown.totalTokens) * filled,
    }))
}

const measure = async (
  $: EngineInterface,
  context: SessionContextUsage,
  rateLimits: SessionRateLimit[],
  isContextChanged: boolean,
): Promise<void> => {
  const previous = await read($, snapshot)
  const segments = isContextChanged || !previous
    ? await readSegments($, context).catch(() => previous?.context.segments ?? [])
    : previous.context.segments
  const next: Snapshot = {
    context: {
      tokens: context.tokens,
      window: context.window,
      percent: context.percent,
      segments,
    },
    limits: toLimits(rateLimits),
  }
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const usage = await $.session.usage()
    if (usage.context.percent !== undefined || usage.rateLimits.length > 0) {
      await measure($, usage.context, usage.rateLimits, true)
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e.context, e.rateLimits, e.changed.includes('context'))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, snapshot)
    const hasFigures =
      current !== null &&
      (current.context.percent !== undefined || current.limits.length > 0)

    if (e.props.hasSurvey || !hasFigures) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const { context, limits } = current

    const bar = (key: string, fill: { key: string; color: string; percent: number }[]) => (
      <Box key={key} flexDirection="row" flexGrow={1} minWidth={6} height={1} backgroundColor="subtle">
        {fill.map(part => (
          <Box key={part.key} width={`${Math.round(Math.min(100, part.percent))}%`} height={1} backgroundColor={part.color} />
        ))}
      </Box>
    )

    const contextMeter = context.percent === undefined ? null : (
      <Box key="context" flexDirection="row" alignItems="center" gap={1} flexGrow={4}>
        <Text dimColor>Context</Text>
        {bar(
          'context-bar',
          context.segments.length > 0
            ? context.segments.map((s, i) => ({ key: `c${i}`, color: s.color, percent: s.percent }))
            : [{ key: 'c0', color: 'suggestion', percent: context.percent }],
        )}
        <Text>{formatPercent(context.percent)}</Text>
        <Text dimColor>
          {formatTokens(context.tokens ?? 0)}/{formatTokens(context.window)}
        </Text>
      </Box>
    )

    const limitMeters = limits.map(limit => {
      const resetIn = formatResetIn(limit.resetsAt, now)
      return (
        <Box key={limit.kind} flexDirection="row" alignItems="center" gap={1} flexGrow={3}>
          <Text dimColor>{LIMIT_LABELS[limit.kind] ?? limit.kind}</Text>
          {bar(`${limit.kind}-bar`, [
            { key: 'used', color: limitColor(limit.percentUsed), percent: limit.percentUsed },
          ])}
          <Text>{formatPercent(limit.percentUsed)}</Text>
          {resetIn ? <Text dimColor>↻ {resetIn}</Text> : null}
        </Box>
      )
    })

    const legend = context.segments.map((s, i) => (
      <Box key={`legend-${i}`} flexDirection="row" gap={1}>
        <Text color={s.color}>■</Text>
        <Text dimColor>
          {s.name} {formatTokens(s.tokens)}
        </Text>
      </Box>
    ))

    return (
      <Box key="usage-band" flexDirection="column">
        <Box flexDirection="row" gap={2}>
          {contextMeter}
          {limitMeters}
        </Box>
        {legend.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} display="none" hover={{ display: 'flex' }}>
            {legend}
          </Box>
        ) : null}
      </Box>
    )
  })
}
