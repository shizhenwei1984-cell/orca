import type { CursorOnDemandSpend } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { formatCurrencyAmount } from '../../../../../shared/agent-usage/display/currency-format'
import { useTranslate } from '@/i18n/use-translate'

export function CursorSpendRows({
  spend,
  mutedClass
}: {
  spend: CursorOnDemandSpend
  mutedClass: string
}): React.JSX.Element {
  const t = useTranslate()
  const rows = [
    [
      t('auto.components.status.bar.tooltip.cursor.personalSpend', 'Personal on-demand spend'),
      spend.personalUsedCents
    ],
    [
      t('auto.components.status.bar.tooltip.cursor.teamSpend', 'Team on-demand spend'),
      spend.teamUsedCents
    ],
    [
      t('auto.components.status.bar.tooltip.cursor.teamLimit', 'Team spend limit'),
      spend.teamLimitCents
    ]
  ] as const
  return (
    <div className="space-y-1">
      {rows.map(([label, cents]) =>
        cents === undefined ? null : (
          <div key={label} className={`flex justify-between gap-2 ${mutedClass}`}>
            <span>{label}</span>
            <span className="tabular-nums">
              {cents === 'unlimited'
                ? t('auto.components.status.bar.tooltip.56c0d70577', 'Unlimited')
                : formatCurrencyAmount(cents / 100, 'USD')}
            </span>
          </div>
        )
      )}
    </div>
  )
}
