import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickSeriesOptions,
  LineSeriesOptions,
  Time,
  CandlestickData,
  LineData,
  MouseEventParams,
} from 'lightweight-charts'
import './App.css'

type RawCandle = [
  number, // timestamp (seconds)
  string, // open
  string, // high
  string, // low
  string, // close
  number // volume
]

type ApiResponse = {
  data: RawCandle[]
}

type Interval = 'd1'

type Candle = CandlestickData

type BollingerBands = {
  basis: LineData<Time>[]
  upper: LineData<Time>[]
  lower: LineData<Time>[]
}

function computeBollingerBands(
  candles: Candle[],
  period = 20,
  multiplier = 2
): BollingerBands {
  if (candles.length < period) {
    return { basis: [], upper: [], lower: [] }
  }

  const closes = candles.map((c) => c.close)
  const basis: LineData<Time>[] = []
  const upper: LineData<Time>[] = []
  const lower: LineData<Time>[] = []

  for (let i = period - 1; i < closes.length; i++) {
    const windowCloses = closes.slice(i - period + 1, i + 1)
    const mean =
      windowCloses.reduce((sum, value) => sum + value, 0) / period
    const variance =
      windowCloses.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) /
      period
    const std = Math.sqrt(variance)
    const time = candles[i].time

    basis.push({ time, value: mean })
    upper.push({ time, value: mean + multiplier * std })
    lower.push({ time, value: mean - multiplier * std })
  }

  return { basis, upper, lower }
}

function computeEma(candles: Candle[], period: number): LineData<Time>[] {
  if (candles.length === 0) return []

  const k = 2 / (period + 1)
  const result: LineData<Time>[] = []

  let prevEma = candles[0].close
  result.push({ time: candles[0].time, value: prevEma })

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close
    const ema = price * k + prevEma * (1 - k)
    prevEma = ema
    result.push({ time: candles[i].time, value: ema })
  }

  return result
}

async function fetchOhlc(ticker: string, interval: Interval): Promise<Candle[]> {
  const url = `https://tornsy.com/api/${ticker}?interval=${interval}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Erro ao buscar dados: ${res.status}`)
  }

  const json = (await res.json()) as ApiResponse

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('Resposta da API em formato inesperado')
  }

  return json.data.map((item) => {
    const [ts, open, high, low, close] = item
    return {
      time: ts as Time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close)
    }
  })
}

type ChartProps = {
  data: Candle[]
}

function CandleChart({ data }: ChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ema9Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null)

  const [legend, setLegend] = useState<{
    ema9?: number
    ema20?: number
    ema50?: number
    ema200?: number
    bbUpper?: number
    bbLower?: number
  } | null>(null)

  const [visibleEmas, setVisibleEmas] = useState({
    ema9: true,
    ema20: true,
    ema50: true,
    ema200: true,
  })

  const [visibleBB, setVisibleBB] = useState(true)

  const options: CandlestickSeriesOptions = useMemo(
    () => ({
      upColor: '#26a69a',
      borderUpColor: '#26a69a',
      wickUpColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      wickDownColor: '#ef5350',
    } as CandlestickSeriesOptions),
    []
  )

  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const rect = container.getBoundingClientRect()
    const initialWidth = rect.width || container.clientWidth || 800
    const initialHeight = rect.height || container.clientHeight || 400

    const chart = createChart(container, {
      width: initialWidth,
      height: Math.max(300, initialHeight),
      layout: {
        background: { type: ColorType.Solid, color: '#0b1120' },
        textColor: '#e5e7eb',
      },
      grid: {
        vertLines: { color: 'rgba(0,0,0,0)' },
        horzLines: { color: 'rgba(0,0,0,0)' },
      },
      timeScale: { borderColor: '#1f2933' },
      rightPriceScale: { borderColor: '#1f2933' },
      crosshair: { mode: CrosshairMode.Normal },
    })

    const series = chart.addSeries(CandlestickSeries, options)
    chartRef.current = chart
    seriesRef.current = series

    const bbBandOptions: Partial<LineSeriesOptions> = {
      color: '#ffffff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    }

    const upperSeries = chart.addSeries(LineSeries, bbBandOptions)
    const lowerSeries = chart.addSeries(LineSeries, bbBandOptions)

    bbUpperRef.current = upperSeries
    bbLowerRef.current = lowerSeries

    const ema9Options: Partial<LineSeriesOptions> = {
      color: '#22c55e', // verde
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }

    const ema20Options: Partial<LineSeriesOptions> = {
      color: '#a855f7', // lilás
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }

    const ema50Options: Partial<LineSeriesOptions> = {
      color: '#facc15', // amarela
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }

    const ema200Options: Partial<LineSeriesOptions> = {
      color: '#38bdf8', // azul claro
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }

    ema9Ref.current = chart.addSeries(LineSeries, ema9Options)
    ema20Ref.current = chart.addSeries(LineSeries, ema20Options)
    ema50Ref.current = chart.addSeries(LineSeries, ema50Options)
    ema200Ref.current = chart.addSeries(LineSeries, ema200Options)

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (!param.point || !param.time) {
        setLegend(null)
        return
      }

      const getValue = (ref: React.MutableRefObject<ISeriesApi<'Line'> | null>) => {
        if (!ref.current) return undefined
        const data = param.seriesData.get(ref.current as unknown as ISeriesApi<'Line'>) as
          | LineData<Time>
          | undefined
        return data?.value
      }

      setLegend({
        ema9: getValue(ema9Ref),
        ema20: getValue(ema20Ref),
        ema50: getValue(ema50Ref),
        ema200: getValue(ema200Ref),
        bbUpper: getValue(bbUpperRef),
        bbLower: getValue(bbLowerRef),
      })
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      chart.applyOptions({
        width,
        height: Math.max(300, height),
      })
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      bbUpperRef.current = null
      bbLowerRef.current = null
      ema9Ref.current = null
      ema20Ref.current = null
      ema50Ref.current = null
      ema200Ref.current = null
    }
  }, [options])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return

    const timeScale = chartRef.current.timeScale()
    const previousRange = timeScale.getVisibleLogicalRange()

    seriesRef.current.setData(data)

    const bands = computeBollingerBands(data)

    if (bbUpperRef.current) {
      bbUpperRef.current.setData(bands.upper)
    }
    if (bbLowerRef.current) {
      bbLowerRef.current.setData(bands.lower)
    }

    const ema9 = computeEma(data, 9)
    const ema20 = computeEma(data, 20)
    const ema50 = computeEma(data, 50)
    const ema200 = computeEma(data, 200)

    if (ema9Ref.current) {
      ema9Ref.current.setData(ema9)
    }
    if (ema20Ref.current) {
      ema20Ref.current.setData(ema20)
    }
    if (ema50Ref.current) {
      ema50Ref.current.setData(ema50)
    }
    if (ema200Ref.current) {
      ema200Ref.current.setData(ema200)
    }

    // Aplicar visibilidade das EMAs
    if (ema9Ref.current) {
      ema9Ref.current.applyOptions({ visible: visibleEmas.ema9 })
    }
    if (ema20Ref.current) {
      ema20Ref.current.applyOptions({ visible: visibleEmas.ema20 })
    }
    if (ema50Ref.current) {
      ema50Ref.current.applyOptions({ visible: visibleEmas.ema50 })
    }
    if (ema200Ref.current) {
      ema200Ref.current.applyOptions({ visible: visibleEmas.ema200 })
    }

    // Aplicar visibilidade das Bandas de Bollinger
    if (bbUpperRef.current) {
      bbUpperRef.current.applyOptions({ visible: visibleBB })
    }
    if (bbLowerRef.current) {
      bbLowerRef.current.applyOptions({ visible: visibleBB })
    }

    if (previousRange != null) {
      timeScale.setVisibleLogicalRange(previousRange)
    } else {
      timeScale.fitContent()
    }
  }, [data, visibleEmas, visibleBB])

  const formatValue = (v?: number) => (v != null ? v.toFixed(2) : '-')

  const toggleEma = (ema: keyof typeof visibleEmas) => {
    setVisibleEmas((prev) => ({ ...prev, [ema]: !prev[ema] }))
  }

  return (
    <div className="chart-inner">
      <div className="chart-legend">
        <span
          className={`legend-item ema9 ${!visibleEmas.ema9 ? 'disabled' : ''}`}
          onClick={() => toggleEma('ema9')}
        >
          EMA 9: {formatValue(legend?.ema9)}
        </span>
        <span
          className={`legend-item ema20 ${!visibleEmas.ema20 ? 'disabled' : ''}`}
          onClick={() => toggleEma('ema20')}
        >
          EMA 20: {formatValue(legend?.ema20)}
        </span>
        <span
          className={`legend-item ema50 ${!visibleEmas.ema50 ? 'disabled' : ''}`}
          onClick={() => toggleEma('ema50')}
        >
          EMA 50: {formatValue(legend?.ema50)}
        </span>
        <span
          className={`legend-item ema200 ${!visibleEmas.ema200 ? 'disabled' : ''}`}
          onClick={() => toggleEma('ema200')}
        >
          EMA 200: {formatValue(legend?.ema200)}
        </span>
        <span
          className={`legend-item bb ${!visibleBB ? 'disabled' : ''}`}
          onClick={() => setVisibleBB(!visibleBB)}
        >
          BB: {formatValue(legend?.bbUpper)} / {formatValue(legend?.bbLower)}
        </span>
      </div>
      <div
        ref={containerRef}
        className="chart-canvas"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}

function App() {
  const [ticker, setTicker] = useState('fhg')
  const [inputTicker, setInputTicker] = useState('fhg')
  const [interval] = useState<Interval>('d1')
  const [data, setData] = useState<Candle[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const candles = await fetchOhlc(ticker, interval)
        if (!cancelled) {
          // Apenas para debug: ver no console quantos candles vieram
          console.log('Candles carregados:', candles.length)
          setData(candles)
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Erro ao carregar dados:', e instanceof Error ? e.message : 'Erro desconhecido')
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [ticker, interval])

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault()
    const value = inputTicker.trim().toLowerCase()
    if (value) {
      setTicker(value)
    }
  }

  const watchlist = useMemo(
    () => [
      'ASS',
      'BAG',
      'CBD',
      'CNC',
      'ELT',
      'EVL',
      'EWM',
      'FHG',
      'GRN',
      'HRG',
      'IIL',
      'IOU',
      'IST',
      'LAG',
      'LOS',
      'LSC',
      'MCS',
      'MSG',
      'MUN',
      'PRN',
      'PTS',
      'SYS',
      'TCC',
      'TCI',
      'TCM',
      'TCP',
      'TCT',
      'TGP',
      'THS',
      'TMI',
      'TSB',
      'WLT',
      'WSU',
      'YAZ',
      'SYM',
    ].sort(),
    []
  )

  const handleSelectFromList = (symbol: string) => {
    const value = symbol.toLowerCase()
    setTicker(value)
    setInputTicker(value)
  }

  const handlePrevious = () => {
    const upper = ticker.toUpperCase()
    const index = watchlist.indexOf(upper)
    const currentIndex = index === -1 ? 0 : index
    const prevIndex = (currentIndex - 1 + watchlist.length) % watchlist.length
    handleSelectFromList(watchlist[prevIndex])
  }

  const handleNext = () => {
    const upper = ticker.toUpperCase()
    const index = watchlist.indexOf(upper)
    const currentIndex = index === -1 ? 0 : index
    const nextIndex = (currentIndex + 1) % watchlist.length
    handleSelectFromList(watchlist[nextIndex])
  }

  return (
    <div className="app-root">
      <div className="app-left">
        <header className="app-header">
          <div className="header-left">
            <h1>Torn Chart</h1>
            <span className="interval">Intervalo: {interval}</span>
          </div>
          <form onSubmit={handleSubmit} className="controls">
            <label>
              Ticker
            </label>
            <input
              name="ticker"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value)}
              placeholder="fhg"
            />
            <button type="submit">Carregar</button>
          </form>
        </header>

        <main className="app-main">
          {data.length > 0 && (
            <div className="chart-container">
              <CandleChart data={data} />
            </div>
          )}
        </main>
      </div>

      <aside className="watchlist">
        <div className="watchlist-header">
          <span>Ativos</span>
          <div className="watchlist-nav">
            <button type="button" onClick={handlePrevious}>
              Previous
            </button>
            <button type="button" onClick={handleNext}>
              Next
            </button>
          </div>
        </div>
        <ul>
          {watchlist.map((symbol) => (
            <li key={symbol}>
              <button
                type="button"
                className={
                  ticker.toUpperCase() === symbol ? 'active' : undefined
                }
                onClick={() => handleSelectFromList(symbol)}
              >
                {symbol}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

export default App
