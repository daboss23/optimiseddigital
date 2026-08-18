import Link from 'next/link'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CreativeThumb } from '@/components/reactor/CreativeThumb'
import { InfoTip, NotApplicable, StatusChip } from '@/components/reactor/Explain'
import { StatusExplainer } from '@/components/reactor/StatusExplainer'
import { RESULT_LABELS, thresholdSummary, type StatusThresholds } from '@/lib/creative-status'
import { compactMoney, money, type CreativeTrend, type MetaAd } from '@/lib/meta-data'

/* ----------------------------------------------------------------------------
   The creative table, shared by both dashboards.

   Reactor renders it `compact` — a five-row decision view. Meta renders it
   `full` — the same vocabulary with the account's spend detail and ROAS when
   (and only when) revenue is connected. One component, so the two pages can
   never drift into describing the same creative differently.
---------------------------------------------------------------------------- */

const trendIdentity: Record<CreativeTrend, { cls: string; Icon: typeof TrendingUp }> = {
  Improving: { cls: 'text-success', Icon: TrendingUp },
  Stable: { cls: 'text-white/45', Icon: Minus },
  Declining: { cls: 'text-danger', Icon: TrendingDown },
}

function Th({
  children,
  align = 'right',
  tip,
}: {
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
  tip?: { label: string; body: string }
}) {
  return (
    <th
      className={cn(
        'whitespace-nowrap pb-3 text-[11px] font-semibold uppercase tracking-wider text-white/55',
        align === 'left' && 'text-left',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1',
          align === 'right' && 'justify-end',
          align === 'center' && 'justify-center',
        )}
      >
        {children}
        {tip && (
          <InfoTip label={tip.label} align={align === 'right' ? 'right' : 'left'}>
            {tip.body}
          </InfoTip>
        )}
      </span>
    </th>
  )
}

export function CreativeLeaderboard({
  ads,
  thresholds,
  revenueConnected = false,
  variant = 'compact',
  hrefFor,
  interactiveStatus = false,
}: {
  ads: MetaAd[]
  thresholds: StatusThresholds
  revenueConnected?: boolean
  variant?: 'compact' | 'full'
  /** Where a creative row links to. Reactor → Meta evidence; Meta → ad detail. */
  hrefFor?: (ad: MetaAd) => string
  /** Meta Intelligence opens a full explanation drawer on a status click. */
  interactiveStatus?: boolean
}) {
  if (ads.length === 0) {
    // Nothing here means nothing is running (or Meta is not connected) — not
    // that ads were withheld for a weak sample. The thresholds still govern the
    // VERDICT on each row; they never govern whether the row appears.
    return (
      <div className="grid place-items-center px-6 py-12 text-center">
        <p className="max-w-sm text-[14px] text-white/55">
          No creatives to show yet. Connect your Meta ad account and your live ads appear here
          automatically, ranked by spend.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto px-5 pb-5 pt-4">
      <table className={cn('w-full text-[13.5px]', variant === 'full' ? 'min-w-[860px]' : 'min-w-[760px]')}>
        <thead>
          <tr>
            <Th align="left">Creative</Th>
            <Th>Spend</Th>
            <Th
              tip={{
                label: 'Primary result',
                body: 'The result this creative’s campaign optimises for. Leads, registrations, applications and booked calls are counted separately and never blended.',
              }}
            >
              Primary result
            </Th>
            <Th
              tip={{
                label: 'Cost per result',
                body: 'Spend divided by the primary result, labelled with the result type it belongs to.',
              }}
            >
              Cost/result
            </Th>
            {revenueConnected && <Th>ROAS</Th>}
            <Th
              align="center"
              tip={{
                label: 'Hook rate',
                body: '3-second views over impressions. Video only, and never proof of a commercial winner on its own.',
              }}
            >
              Hook
            </Th>
            <Th tip={{ label: 'Outbound CTR', body: 'Clicks that leave Meta, over impressions.' }}>
              CTR
            </Th>
            <Th
              tip={{
                label: 'Frequency',
                body: `Average impressions per person. At or above ${thresholds.fatigueFrequency}, rising frequency counts as a fatigue signal.`,
              }}
            >
              Freq
            </Th>
            <Th align="center">Trend</Th>
            <Th
              align="right"
              tip={{
                label: 'Status thresholds',
                body: `No Winner or Loser is assigned until ${thresholdSummary(thresholds)} is cleared. Hover any status for the evidence behind it.`,
              }}
            >
              Status
            </Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {ads.map((ad) => {
            const trend = trendIdentity[ad.trend]
            const TrendIcon = trend.Icon
            const href = hrefFor?.(ad)
            const label = RESULT_LABELS[ad.resultType]
            return (
              <tr key={ad.id} className="text-white/80">
                <td className="py-3.5 pr-3">
                  <div className="flex items-center gap-3">
                    <CreativeThumb
                      format={ad.format}
                      name={ad.name}
                      src={ad.thumbnailUrl}
                      size={variant === 'compact' ? 'sm' : 'md'}
                    />
                    <div className="min-w-0">
                      {href ? (
                        <Link
                          href={href}
                          className="truncate text-[14.5px] font-semibold text-white transition-colors hover:text-glow"
                        >
                          {ad.name}
                        </Link>
                      ) : (
                        <p className="truncate text-[14.5px] font-semibold text-white">{ad.name}</p>
                      )}
                      <p className="text-[12px] text-white/50">
                        {ad.format} · {ad.daysLive}d live
                      </p>
                    </div>
                  </div>
                </td>
                <td className="whitespace-nowrap py-3.5 text-right tabular">
                  {variant === 'full' ? money(ad.spend) : compactMoney(ad.spend)}
                </td>
                <td className="whitespace-nowrap py-3.5 text-right tabular">
                  {ad.primaryResults.toLocaleString()}{' '}
                  <span className="text-[12px] text-white/55">
                    {ad.primaryResults === 1 ? label.one.toLowerCase() : label.many}
                  </span>
                </td>
                <td className="whitespace-nowrap py-3.5 text-right font-display font-bold tabular text-glow">
                  ${ad.costPerResult.toFixed(0)}{' '}
                  <span
                    title={label.cost}
                    className="font-sans text-[11px] font-medium uppercase tracking-wider text-white/55"
                  >
                    {label.short}
                  </span>
                </td>
                {revenueConnected && (
                  <td className="whitespace-nowrap py-3.5 text-right tabular">
                    {ad.roas === null ? (
                      <NotApplicable why="No revenue or conversion value is connected to this campaign." />
                    ) : (
                      `${ad.roas.toFixed(1)}x`
                    )}
                  </td>
                )}
                <td className="py-3.5 text-center tabular text-cyan">
                  {ad.hookRate === null ? (
                    <NotApplicable why={`Hook rate is a video metric. ${ad.format} creatives have no 3-second view.`} />
                  ) : (
                    `${ad.hookRate}%`
                  )}
                </td>
                <td className="py-3.5 text-right tabular">{ad.ctr.toFixed(1)}%</td>
                <td className="py-3.5 text-right tabular">{ad.frequency.toFixed(1)}</td>
                <td className="py-3.5 text-center">
                  <span className={cn('inline-flex items-center gap-1 text-[12.5px] font-medium', trend.cls)}>
                    <TrendIcon size={12} />
                    {ad.trend}
                  </span>
                </td>
                <td className="py-3.5 text-right">
                  {interactiveStatus ? (
                    <StatusExplainer
                      status={ad.status}
                      reason={ad.statusReason}
                      thresholds={thresholds}
                      creativeName={ad.name}
                    />
                  ) : (
                    <StatusChip status={ad.status} reason={ad.statusReason} align="right" />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
