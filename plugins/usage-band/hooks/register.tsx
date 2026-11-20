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

// The colours the desktop app's context sidebar draws each category in.
const CATEGORY_COLORS: Record<string, string> = {
  Messages: '#4A8FE7',
  'System tools': '#E5683A',
  'MCP tools': '#1FA88A',
  Skills: '#E8A33D',
}
const OTHER_CATEGORY_COLOR = '#8E8E8E'
const LIMIT_COLORS = { normal: '#4A8FE7', high: '#E8A33D', full: '#E5484D' }
const TRACK_COLOR = 'rgba(128,128,128,0.28)'

const categoryColor = (name: string): string =>
  CATEGORY_COLORS[name] ?? OTHER_CATEGORY_COLOR

const limitColor = (percentUsed: number): string => {
  if (percentUsed >= 90) {
    return LIMIT_COLORS.full
  }
  if (percentUsed >= 75) {
    return LIMIT_COLORS.high
  }
  return LIMIT_COLORS.normal
}

type Part = { key: string; color: string; percent: number }

const BAR_HEIGHT = 6

// A thin bar with round ends: the track, and the parts laid left to right.
const barSvg = (width: number, parts: Part[]): string => {
  let x = 0
  const rects = parts.map(part => {
    const w = (Math.min(100, Math.max(0, part.percent)) / 100) * width
    const rect = `<rect x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="${BAR_HEIGHT}" fill="${part.color}"/>`
    x += w
    return rect
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BAR_HEIGHT}" viewBox="0 0 ${width} ${BAR_HEIGHT}">` +
    `<defs><clipPath id="r"><rect width="${width}" height="${BAR_HEIGHT}" rx="${BAR_HEIGHT / 2}"/></clipPath></defs>` +
    `<g clip-path="url(#r)"><rect width="${width}" height="${BAR_HEIGHT}" fill="${TRACK_COLOR}"/>${rects.join('')}</g>` +
    `</svg>`
  )
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
    .map(({ name, tokens }) => ({
      name,
      color: categoryColor(name),
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

    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const now = await $.clock.now()
    const { context, limits } = current

    // The desktop and mobile apps draw a thin SVG bar; the terminal, a row of
    // coloured cells.
    const bar = (key: string, width: number, alt: string, parts: Part[]) =>
      Svg ? (
        <Svg key={key} source={barSvg(width, parts)} alt={alt} width={width} height={BAR_HEIGHT} />
      ) : (
        <Box key={key} flexDirection="row" flexGrow={1} minWidth={6} height={1} backgroundColor="subtle">
          {parts.map(part => (
            <Box key={part.key} width={`${Math.round(Math.min(100, part.percent))}%`} height={1} backgroundColor={part.color} />
          ))}
        </Box>
      )

    const contextMeter = context.percent === undefined ? null : (
      <Box key="context" flexDirection="row" alignItems="center" gap={1} flexGrow={4}>
        <Text size="caption" dimColor>Context</Text>
        {bar(
          'context-bar',
          160,
          `Context window ${formatPercent(context.percent)} used`,
          context.segments.length > 0
            ? context.segments.map((s, i) => ({ key: `c${i}`, color: categoryColor(s.name), percent: s.percent }))
            : [{ key: 'c0', color: LIMIT_COLORS.normal, percent: context.percent }],
        )}
        <Text size="caption">{formatPercent(context.percent)}</Text>
        <Text size="caption" dimColor>
          {formatTokens(context.tokens ?? 0)}/{formatTokens(context.window)}
        </Text>
      </Box>
    )

    const limitMeters = limits.map(limit => {
      const resetIn = formatResetIn(limit.resetsAt, now)
      return (
        <Box key={limit.kind} flexDirection="row" alignItems="center" gap={1} flexGrow={3}>
          <Text size="caption" dimColor>{LIMIT_LABELS[limit.kind] ?? limit.kind}</Text>
          {bar(
            `${limit.kind}-bar`,
            110,
            `${LIMIT_LABELS[limit.kind] ?? limit.kind} limit ${formatPercent(limit.percentUsed)} used`,
            [{ key: 'used', color: limitColor(limit.percentUsed), percent: limit.percentUsed }],
          )}
          <Text size="caption">{formatPercent(limit.percentUsed)}</Text>
          {resetIn ? <Text size="caption" dimColor>↻ {resetIn}</Text> : null}
        </Box>
      )
    })

    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={3}>
        {contextMeter}
        {limitMeters}
      </Box>
    )
  })
}
