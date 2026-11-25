import { defineFixture } from '../../../component-fixtures/component-fixture'
import { ProviderPanel } from './provider-usage-panel'

export const cursorSpend = defineFixture({
  width: 440,
  render: () => (
    <div className="bg-popover p-3 text-popover-foreground">
      <ProviderPanel
        p={{
          provider: 'cursor',
          session: null,
          weekly: null,
          updatedAt: Date.now(),
          error: null,
          status: 'ok',
          monthly: {
            usedPercent: 42,
            windowMinutes: 43_200,
            resetsAt: null,
            resetDescription: null
          },
          cursorOnDemandSpend: { personalUsedCents: 0, teamUsedCents: 2345, teamLimitCents: 10000 }
        }}
      />
    </div>
  )
})
