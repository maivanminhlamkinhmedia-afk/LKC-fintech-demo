'use client'

import { useEffect, useRef } from 'react'

type OpenAlgoModule = typeof import('openalgo-charts')
type OpenAlgoChart = ReturnType<OpenAlgoModule['createChart']>

export function TradingTerminal() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = ref.current
    if (!container) return

    let destroyed = false
    let chart: OpenAlgoChart | undefined

    ;(async () => {
      const core = await import('openalgo-charts')
      await import('openalgo-charts/indicators')

      if (destroyed) return

      const instance = core.createChart(container, {
        timezone: 'Asia/Ho_Chi_Minh',
      })

      const candles = instance.addSeries('candlestick')

      candles.setData(
        core.generateBars(
          Math.floor(Date.now() / 1000) - 3600 * 240,
          240,
          3600,
        ),
      )

      instance.addIndicator('ema', { period: 20 })
      instance.addIndicator('rsi', { period: 14 })

      chart = instance
    })()

    return () => {
      destroyed = true
      chart?.destroy()
      container.replaceChildren()
    }
  }, [])

  return (
    <div
      ref={ref}
      className="h-[680px] w-full overflow-hidden rounded-2xl bg-[#071528]"
    />
  )
}