import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CandlestickSeries,
  CrosshairMode,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickSeriesOptions,
  LineSeriesOptions,
  HistogramSeriesOptions,
  Time,
  CandlestickData,
  LineData,
  HistogramData,
  MouseEventParams,
  LineStyle,
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

type Interval = '1h' | '2h' | '4h' | '6h' | '12h' | 'd1' | 'w1'
type ApiInterval = 'h1' | 'h2' | 'h4' | 'h6' | 'h12' | 'd1' | 'w1'

type Candle = CandlestickData & { volume: number }

type BollingerBands = {
  basis: LineData<Time>[]
  upper: LineData<Time>[]
  lower: LineData<Time>[]
}

// Drawing tool types
type DrawingTool = 'none' | 'trendline' | 'horizontal' | 'fibonacci' | 'ruler'

// Fibonacci constants
const FIBONACCI_LEVELS = [
  { value: 0, label: '0' },
  { value: 0.382, label: '0.382' },
  { value: 0.5, label: '0.5' },
  { value: 0.618, label: '0.618' },
  { value: 1, label: '1' },
  { value: 1.618, label: '1.618' },
  { value: 2, label: '2' },
  { value: 2.618, label: '2.618' }
]

const FIBONACCI_COLORS = ['#ef4444', '#fbbf24', '#22c55e', '#06b6d4', '#ef4444', '#8b5cf6', '#ec4899', '#f97316']

// Utility functions
function formatValue(value?: number, decimals: number = 2): string {
  return value != null ? value.toFixed(decimals) : '-'
}

function formatVolume(value?: number): string {
  if (value == null) return '-'
  if (value >= 1e9) return (value / 1e9).toFixed(2) + 'B'
  if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M'
  if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K'
  return value.toFixed(0)
}

function extendTimeRange(startTime: number, endTime: number, percentage: number = 0.2): number {
  const timeRange = endTime - startTime
  return endTime + (timeRange * percentage)
}

function getClickTime(param: MouseEventParams<Time>, chart: IChartApi): Time | null {
  if (param.time) return param.time
  
  const timeFromCoord = chart.timeScale().coordinateToTime(param.point!.x)
  if (timeFromCoord === null) return null
  
  return timeFromCoord as Time
}

function sortDrawingPoints(time1: Time, price1: number, time2: Time, price2: number): [Time, number, Time, number] {
  return time1 < time2 
    ? [time1, price1, time2, price2]
    : [time2, price2, time1, price1]
}

function createReferenceLine(data: Candle[], value: number): LineData<Time>[] {
  return data.map((candle) => ({
    time: candle.time,
    value: value,
  }))
}

type DrawingLine = {
  id: string
  type: 'trendline' | 'horizontal'
  time1: Time
  price1: number
  time2?: Time
  price2?: number
  series: ISeriesApi<'Line'>
}

type DrawingRuler = {
  id: string
  type: 'ruler'
  time1: Time
  price1: number
  time2?: Time
  price2?: number
  percentChange: number
  series: ISeriesApi<'Line'>
}

type DrawingFibonacci = {
  id: string
  type: 'fibonacci'
  time1: Time
  price1: number
  time2?: Time
  price2?: number
  series: ISeriesApi<'Line'>[]
}

type Drawing = DrawingLine | DrawingRuler | DrawingFibonacci

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

function computeRsi(candles: Candle[], period = 14): LineData<Time>[] {
  if (candles.length < period + 1) return []

  const result: LineData<Time>[] = []
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period

  for (let i = period; i < candles.length; i++) {
    if (avgLoss === 0) {
      result.push({ time: candles[i].time, value: 100 })
    } else {
      const rs = avgGain / avgLoss
      const rsi = 100 - 100 / (1 + rs)
      result.push({ time: candles[i].time, value: rsi })
    }

    if (i < candles.length - 1) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period
    }
  }

  return result
}

type StochasticData = {
  k: LineData<Time>[]
  d: LineData<Time>[]
}

function computeStochastic(candles: Candle[], kPeriod = 12, dPeriod = 3): StochasticData {
  if (candles.length < kPeriod) return { k: [], d: [] }

  const kValues: LineData<Time>[] = []

  // Calculate %K
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1)
    const high = Math.max(...window.map(c => c.high))
    const low = Math.min(...window.map(c => c.low))
    const close = candles[i].close

    const k = high === low ? 50 : ((close - low) / (high - low)) * 100
    kValues.push({ time: candles[i].time, value: k })
  }

  // Calculate %D (moving average of %K)
  const dValues: LineData<Time>[] = []
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const window = kValues.slice(i - dPeriod + 1, i + 1)
    const avg = window.reduce((sum, val) => sum + val.value, 0) / dPeriod
    dValues.push({ time: kValues[i].time, value: avg })
  }

  return { k: kValues, d: dValues }
}

function detectLowPattern(candles: Candle[]): Set<number> {
  const patternIndices = new Set<number>()
  
  for (let i = 2; i < candles.length; i++) {
    const candleA = candles[i - 2]
    const candleB = candles[i - 1]
    const candleC = candles[i]
    
    // Check if: B.low < A.low AND C.low > B.low
    if (candleB.low < candleA.low && candleC.low > candleB.low) {
      patternIndices.add(i)
    }
  }
  
  return patternIndices
}

function mapIntervalToApi(interval: Interval): ApiInterval {
  const mapping: Record<Interval, ApiInterval> = {
    '1h': 'h1',
    '2h': 'h2',
    '4h': 'h4',
    '6h': 'h6',
    '12h': 'h12',
    'd1': 'd1',
    'w1': 'w1',
  }
  return mapping[interval]
}

// Cache structure
type CacheEntry = {
  data: Candle[]
  timestamp: number
}

// Cache expiration time in milliseconds
const CACHE_EXPIRATION = {
  '1h': 2 * 60 * 1000,      // 2 minutes for 1h data
  '2h': 3 * 60 * 1000,      // 3 minutes for 2h data
  '4h': 5 * 60 * 1000,      // 5 minutes for 4h data
  '6h': 7 * 60 * 1000,      // 7 minutes for 6h data
  '12h': 10 * 60 * 1000,    // 10 minutes for 12h data
  'd1': 30 * 60 * 1000,     // 30 minutes for daily data
  'w1': 60 * 60 * 1000,     // 1 hour for weekly data
}

function getCacheKey(ticker: string, interval: Interval): string {
  return `ohlc_${ticker}_${interval}`
}

function getCachedData(ticker: string, interval: Interval): Candle[] | null {
  try {
    const key = getCacheKey(ticker, interval)
    const cached = localStorage.getItem(key)
    
    if (!cached) return null

    const entry: CacheEntry = JSON.parse(cached)
    const now = Date.now()
    const expirationTime = CACHE_EXPIRATION[interval]

    // Check if cache is still valid
    if (now - entry.timestamp < expirationTime) {
      return entry.data
    } else {
      // Cache expired, remove
      localStorage.removeItem(key)
      return null
    }
  } catch (error) {
    console.error('Error reading cache:', error)
    return null
  }
}

function setCachedData(ticker: string, interval: Interval, data: Candle[]): void {
  try {
    const key = getCacheKey(ticker, interval)
    const entry: CacheEntry = {
      data,
      timestamp: Date.now()
    }
    localStorage.setItem(key, JSON.stringify(entry))
  } catch (error) {
    console.error('Error saving cache:', error)
    // If localStorage is full, clear old entries
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      clearOldCache()
      // Try to save again
      try {
        const key = getCacheKey(ticker, interval)
        const entry: CacheEntry = { data, timestamp: Date.now() }
        localStorage.setItem(key, JSON.stringify(entry))
      } catch {
        // If it still fails, ignore
      }
    }
  }
}

function clearOldCache(): void {
  try {
    const now = Date.now()
    const keysToRemove: string[] = []

    // Loop through all localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('ohlc_')) {
        try {
          const cached = localStorage.getItem(key)
          if (cached) {
            const entry: CacheEntry = JSON.parse(cached)
            // Remove if older than 2 hours
            if (now - entry.timestamp > 2 * 60 * 60 * 1000) {
              keysToRemove.push(key)
            }
          }
        } catch {
          // If error parsing, mark for removal
          keysToRemove.push(key)
        }
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key))
  } catch (error) {
    console.error('Error clearing cache:', error)
  }
}

async function fetchOhlc(ticker: string, interval: Interval): Promise<Candle[]> {
  // Try to fetch from cache first
  const cached = getCachedData(ticker, interval)
  if (cached) {
    return cached
  }

  // If no valid cache, fetch from API
  const apiInterval = mapIntervalToApi(interval)
  const url = `https://tornsy.com/api/${ticker}?interval=${apiInterval}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Error fetching data: ${res.status}`)
  }

  const json = (await res.json()) as ApiResponse

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('API response in unexpected format')
  }

  const candles = json.data.map((item) => {
    const [ts, open, high, low, close, volume] = item
    return {
      time: ts as Time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: volume
    }
  })

  // Save to cache
  setCachedData(ticker, interval, candles)

  return candles
}

// Settings button component
function SettingsButton({ settingsOpen, setSettingsOpen, handleClearCache }: {
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  handleClearCache: () => void
}) {
  return (
    <div className="settings-container">
      <button 
        type="button" 
        className="btn-settings"
        onClick={() => setSettingsOpen(!settingsOpen)}
        title="Settings"
      >
        ⚙️
      </button>
      {settingsOpen && (
        <div className="settings-menu">
          <button onClick={handleClearCache}>
            🗑️ Clear Cache
          </button>
        </div>
      )}
    </div>
  )
}

type ChartProps = {
  data: Candle[]
  ticker: string
  interval: Interval
}

function CandleChart({ data, ticker, interval }: ChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ema9Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsi70Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const rsi30Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const stochKRef = useRef<ISeriesApi<'Line'> | null>(null)
  const stochDRef = useRef<ISeriesApi<'Line'> | null>(null)

  const [legend, setLegend] = useState<{
    open?: number
    high?: number
    low?: number
    close?: number
    ema9?: number
    ema20?: number
    ema50?: number
    ema200?: number
    bbUpper?: number
    bbLower?: number
    volume?: number
    rsi?: number
    stochK?: number
    stochD?: number
    percentL9?: number
  } | null>(null)

  const [visibleEmas, setVisibleEmas] = useState({
    ema9: true,
    ema20: true,
    ema50: true,
    ema200: true,
  })

  const [visibleBB, setVisibleBB] = useState(true)
  const [visibleVolume, setVisibleVolume] = useState(false)
  const [visibleRsi, setVisibleRsi] = useState(true)
  const [visibleStochastic, setVisibleStochastic] = useState(true)
  const [visibleLowPattern, setVisibleLowPattern] = useState(false)

  // Estados para ferramentas de desenho
  const [activeTool, setActiveTool] = useState<DrawingTool>('none')
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [drawingInProgress, setDrawingInProgress] = useState<{
    time1?: Time
    price1?: number
  } | null>(null)
  const [shiftPressed, setShiftPressed] = useState(false)

  // Clear drawings when ticker or interval changes
  useEffect(() => {
    if (chartRef.current && drawings.length > 0) {
      drawings.forEach(drawing => {
        if (drawing.type === 'trendline' || drawing.type === 'horizontal' || drawing.type === 'ruler') {
          chartRef.current?.removeSeries(drawing.series)
        } else if (drawing.type === 'fibonacci') {
          drawing.series.forEach(s => chartRef.current?.removeSeries(s))
        }
      })
    }
    setDrawings([])
    setDrawingInProgress(null)
    setActiveTool('none')
  }, [ticker, interval])

  // Track Shift key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

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

    // Adicionar série de volume
    const volumeOptions: Partial<HistogramSeriesOptions> = {
      color: '#26a69a',
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
    }
    const volumeSeries = chart.addSeries(HistogramSeries, volumeOptions)
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    })
    volumeSeriesRef.current = volumeSeries

    // Adicionar série RSI
    const rsiOptions: Partial<LineSeriesOptions> = {
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'rsi',
    }
    const rsiSeries = chart.addSeries(LineSeries, rsiOptions)
    rsiSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
    })
    rsiSeriesRef.current = rsiSeries

    // Adicionar linhas de referência RSI 70 e 30
    const rsiLevelOptions: Partial<LineSeriesOptions> = {
      color: '#6b7280',
      lineWidth: 1,
      lineStyle: 2 as LineStyle, // Dashed
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'rsi',
      crosshairMarkerVisible: false,
    }
    const rsi70Series = chart.addSeries(LineSeries, rsiLevelOptions)
    const rsi30Series = chart.addSeries(LineSeries, rsiLevelOptions)
    rsi70Ref.current = rsi70Series
    rsi30Ref.current = rsi30Series

    // Add Stochastic %K and %D series
    const stochKOptions: Partial<LineSeriesOptions> = {
      color: '#3b82f6', // blue
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'rsi', // Use same scale as RSI
    }
    const stochDOptions: Partial<LineSeriesOptions> = {
      color: '#ef4444', // red
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: 'rsi',
    }
    const stochKSeries = chart.addSeries(LineSeries, stochKOptions)
    const stochDSeries = chart.addSeries(LineSeries, stochDOptions)
    stochKRef.current = stochKSeries
    stochDRef.current = stochDSeries

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

      const getVolumeValue = () => {
        if (!volumeSeriesRef.current) return undefined
        const data = param.seriesData.get(volumeSeriesRef.current as unknown as ISeriesApi<'Histogram'>) as
          | HistogramData<Time>
          | undefined
        return data?.value
      }

      const getCandleData = () => {
        if (!seriesRef.current) return { open: undefined, high: undefined, low: undefined, close: undefined }
        const data = param.seriesData.get(seriesRef.current as unknown as ISeriesApi<'Candlestick'>) as
          | CandlestickData
          | undefined
        return {
          open: data?.open,
          high: data?.high,
          low: data?.low,
          close: data?.close,
        }
      }

      const candleData = getCandleData()
      const ema9Value = getValue(ema9Ref)
      const percentL9 = candleData.low && ema9Value ? (candleData.low / ema9Value) * 100 : undefined

      setLegend({
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        ema9: ema9Value,
        ema20: getValue(ema20Ref),
        ema50: getValue(ema50Ref),
        ema200: getValue(ema200Ref),
        bbUpper: getValue(bbUpperRef),
        bbLower: getValue(bbLowerRef),
        volume: getVolumeValue(),
        rsi: getValue(rsiSeriesRef),
        stochK: getValue(stochKRef),
        stochD: getValue(stochDRef),
        percentL9: percentL9,
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
      volumeSeriesRef.current = null
      rsiSeriesRef.current = null
      rsi70Ref.current = null
      rsi30Ref.current = null
      stochKRef.current = null
      stochDRef.current = null
    }
  }, [options])

  // Separate handler for chart clicks (drawing tools)
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return

    const handleChartClick = (param: MouseEventParams<Time>) => {
      if (!seriesRef.current) return
      
      // Shift+click activates ruler temporarily
      const effectiveTool = shiftPressed && activeTool === 'none' ? 'ruler' : activeTool
      
      if (effectiveTool === 'none') return
      
      // Need valid coordinates
      if (!param.point) return

      // Get exact price where user clicked using priceScale
      const series = seriesRef.current
      const clickPrice = series.coordinateToPrice(param.point.y)
      
      if (clickPrice === null || clickPrice === undefined) return
      
      // Get time at clicked point (even if no candle)
      const chart = chartRef.current
      if (!chart) return
      
      const clickTime = getClickTime(param, chart)
      
      if (!clickTime) return

      // Linha horizontal precisa apenas de 1 clique
      if (effectiveTool === 'horizontal') {
        const chart = chartRef.current
        if (!chart) return
        
        const id = `horizontal_${Date.now()}`
        
        // Use full data extent and extend beyond last candle
        const firstTime = data[0]?.time
        const lastTime = data[data.length - 1]?.time
        
        if (!firstTime || !lastTime) return
        
        // Calculate future time to extend line to right edge
        const extendedTime = extendTimeRange(firstTime as number, lastTime as number)
        
        const lineSeries = chart.addSeries(LineSeries, {
          color: '#06b6d4',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        lineSeries.setData([
          { time: firstTime, value: clickPrice },
          { time: extendedTime as Time, value: clickPrice }
        ])
        
        setDrawings(prev => [...prev, {
          id,
          type: 'horizontal',
          time1: clickTime,
          price1: clickPrice,
          time2: lastTime,
          price2: clickPrice,
          series: lineSeries
        }])
        
        setActiveTool('none')
        return
      }

      if (!drawingInProgress) {
        // First click - start drawing
        setDrawingInProgress({ time1: clickTime, price1: clickPrice })
      } else {
        // Second click - finish drawing
        const { time1, price1 } = drawingInProgress
        if (!time1 || !price1 || !chartRef.current) return

        const chart = chartRef.current
        const id = `${effectiveTool}_${Date.now()}`

        // Sort points by time (left to right)
        const [startTime, startPrice, endTime, endPrice] = sortDrawingPoints(time1, price1, clickTime, clickPrice)

        if (effectiveTool === 'trendline') {
          const lineSeries = chart.addSeries(LineSeries, {
            color: '#fbbf24',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
          })
          lineSeries.setData([
            { time: startTime, value: startPrice },
            { time: endTime, value: endPrice }
          ])
          
          setDrawings(prev => [...prev, {
            id,
            type: 'trendline',
            time1,
            price1,
            time2: clickTime,
            price2: clickPrice,
            series: lineSeries
          }])
        } else if (effectiveTool === 'ruler') {
          // Calculate percentage change
          const percentChange = ((clickPrice - price1) / price1) * 100
          const sign = percentChange >= 0 ? '+' : ''
          const label = `${sign}${percentChange.toFixed(2)}%`
          
          const lineSeries = chart.addSeries(LineSeries, {
            color: '#a855f7', // purple
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            title: label,
          })
          lineSeries.setData([
            { time: startTime, value: startPrice },
            { time: endTime, value: endPrice }
          ])
          
          setDrawings(prev => [...prev, {
            id,
            type: 'ruler',
            time1,
            price1,
            time2: clickTime,
            price2: clickPrice,
            percentChange,
            series: lineSeries
          }])
        } else if (effectiveTool === 'fibonacci') {
          const seriesArray: ISeriesApi<'Line'>[] = []
          
          // Sort times so lines always go left to right
          const sortedTime1 = time1 < clickTime ? time1 : clickTime
          const sortedTime2 = time1 < clickTime ? clickTime : time1
          
          FIBONACCI_LEVELS.forEach((level, index) => {
            // Use prices in clicked order, not sorted
            const fibPrice = price1 + (clickPrice - price1) * level.value
            const fibLine = chart.addSeries(LineSeries, {
              color: FIBONACCI_COLORS[index],
              lineWidth: level.value === 0 || level.value === 1 ? 2 : 1,
              lineStyle: 2 as LineStyle,
              priceLineVisible: true,
              lastValueVisible: true,
              title: level.label,
            })
            fibLine.setData([
              { time: sortedTime1, value: fibPrice },
              { time: sortedTime2, value: fibPrice }
            ])
            seriesArray.push(fibLine)
          })
          
          setDrawings(prev => [...prev, {
            id,
            type: 'fibonacci',
            time1,
            price1,
            time2: clickTime,
            price2: clickPrice,
            series: seriesArray
          }])
        }

        setDrawingInProgress(null)
        // If using Shift shortcut, don't change activeTool
        if (activeTool !== 'none') {
          setActiveTool('none')
        }
      }
    }

    const chart = chartRef.current
    chart.subscribeClick(handleChartClick)

    return () => {
      chart.unsubscribeClick(handleChartClick)
    }
  }, [activeTool, drawingInProgress, data, drawings, shiftPressed])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return

    const timeScale = chartRef.current.timeScale()
    const previousRange = timeScale.getVisibleLogicalRange()

    // Apply custom pattern colors if indicator is visible
    let candleData = data
    if (visibleLowPattern) {
      const patternIndices = detectLowPattern(data)
      candleData = data.map((candle, index) => {
        if (patternIndices.has(index)) {
          return {
            ...candle,
            color: '#fbbf24' // yellow
          }
        }
        return candle
      })
    }

    seriesRef.current.setData(candleData)

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

    // Add volume data
    if (volumeSeriesRef.current) {
      const volumeData: HistogramData<Time>[] = data.map((candle) => ({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? '#26a69a' : '#ef5350',
      }))
      volumeSeriesRef.current.setData(volumeData)
    }

    // Add RSI data
    const rsi = computeRsi(data)
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(rsi)
    }

    // Add RSI reference lines 70 and 30
    if (rsi70Ref.current && data.length > 0) {
      rsi70Ref.current.setData(createReferenceLine(data, 70))
    }
    if (rsi30Ref.current && data.length > 0) {
      rsi30Ref.current.setData(createReferenceLine(data, 30))
    }

    // Add Stochastic data
    const stochastic = computeStochastic(data, 12, 3)
    if (stochKRef.current) {
      stochKRef.current.setData(stochastic.k)
    }
    if (stochDRef.current) {
      stochDRef.current.setData(stochastic.d)
    }

    // Apply EMA visibility
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

    // Apply Bollinger Bands visibility
    if (bbUpperRef.current) {
      bbUpperRef.current.applyOptions({ visible: visibleBB })
    }
    if (bbLowerRef.current) {
      bbLowerRef.current.applyOptions({ visible: visibleBB })
    }

    // Apply volume visibility
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.applyOptions({ visible: visibleVolume })
    }

    // Apply RSI visibility
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.applyOptions({ visible: visibleRsi })
    }
    if (rsi70Ref.current) {
      rsi70Ref.current.applyOptions({ visible: visibleRsi })
    }
    if (rsi30Ref.current) {
      rsi30Ref.current.applyOptions({ visible: visibleRsi })
    }

    // Apply Stochastic visibility
    if (stochKRef.current) {
      stochKRef.current.applyOptions({ visible: visibleStochastic })
    }
    if (stochDRef.current) {
      stochDRef.current.applyOptions({ visible: visibleStochastic })
    }

    if (previousRange != null) {
      timeScale.setVisibleLogicalRange(previousRange)
    } else {
      timeScale.fitContent()
    }
  }, [data, visibleEmas, visibleBB, visibleVolume, visibleRsi, visibleStochastic, visibleLowPattern])

  const toggleEma = (ema: keyof typeof visibleEmas) => {
    setVisibleEmas((prev) => ({ ...prev, [ema]: !prev[ema] }))
  }

  const toggleIndicator = (indicator: 'volume' | 'rsi' | 'stochastic') => {
    const mutuallyExclusive = {
      volume: { set: setVisibleVolume, current: visibleVolume, disables: [setVisibleRsi, setVisibleStochastic] },
      rsi: { set: setVisibleRsi, current: visibleRsi, disables: [setVisibleVolume] },
      stochastic: { set: setVisibleStochastic, current: visibleStochastic, disables: [setVisibleVolume] }
    }
    
    const config = mutuallyExclusive[indicator]
    if (!config.current) {
      config.set(true)
      config.disables.forEach(setter => setter(false))
    } else {
      config.set(false)
    }
  }

  const clearAllDrawings = () => {
    if (!chartRef.current) return
    
    drawings.forEach(drawing => {
      if (drawing.type === 'trendline' || drawing.type === 'horizontal' || drawing.type === 'ruler') {
        chartRef.current?.removeSeries(drawing.series)
      } else if (drawing.type === 'fibonacci') {
        drawing.series.forEach(s => chartRef.current?.removeSeries(s))
      }
    })
    
    setDrawings([])
    setDrawingInProgress(null)
    setActiveTool('none')
  }

  return (
    <div className="chart-inner">
      <div className="legend-and-tools">
        <div className="chart-legend">
          <div>
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
          <span
            className={`legend-item ${!visibleLowPattern ? 'disabled' : ''}`}
            onClick={() => setVisibleLowPattern(!visibleLowPattern)}
            style={{ color: '#fbbf24' }}
          >
            123 Pattern
          </span>
        </div>
        <div>
          <span
            className={`legend-item volume ${!visibleVolume ? 'disabled' : ''}`}
            onClick={() => toggleIndicator('volume')}
          >
            Volume: {formatVolume(legend?.volume)}
          </span>
          <span
            className={`legend-item rsi ${!visibleRsi ? 'disabled' : ''}`}
            onClick={() => toggleIndicator('rsi')}
          >
            RSI: {formatValue(legend?.rsi)}
          </span>
          <span
            className={`legend-item stoch ${!visibleStochastic ? 'disabled' : ''}`}
            onClick={() => toggleIndicator('stochastic')}
          >
            Stoch: {formatValue(legend?.stochK)} / {formatValue(legend?.stochD)}
          </span>
          <span className="legend-item">
            O: <span style={{ color: '#16a34a' }}>{formatValue(legend?.open)}</span> H: <span style={{ color: '#16a34a' }}>{formatValue(legend?.high)}</span> L: <span style={{ color: '#16a34a' }}>{formatValue(legend?.low)}</span> C: <span style={{ color: '#16a34a' }}>{formatValue(legend?.close)}</span> %L9: <span style={{ color: '#16a34a' }}>{formatValue(legend?.percentL9)}</span>
          </span>
        </div>
        </div>
        <div className="drawing-tools-inline">
          {drawingInProgress && (
            <span className="drawing-hint-inline">
              ✏️ Click again to finish
            </span>
          )}
          <button
            className={`tool-btn ${activeTool === 'trendline' ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === 'trendline' ? 'none' : 'trendline')}
            title="Trendline"
          >
            📈
          </button>
          <button
            className={`tool-btn ${activeTool === 'horizontal' ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === 'horizontal' ? 'none' : 'horizontal')}
            title="Support/Resistance"
          >
            ➡️
          </button>
          <button
            className={`tool-btn ${activeTool === 'fibonacci' ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === 'fibonacci' ? 'none' : 'fibonacci')}
            title="Fibonacci"
          >
            φ
          </button>
          <button
            className={`tool-btn ${activeTool === 'ruler' ? 'active' : ''}`}
            onClick={() => setActiveTool(activeTool === 'ruler' ? 'none' : 'ruler')}
            title="Ruler (% Change)"
          >
            📏
          </button>
          {drawings.length > 0 && (
            <button
              className="tool-btn clear-btn"
              onClick={clearAllDrawings}
              title="Clear Drawings"
            >
              🗑️ ({drawings.length})
            </button>
          )}
        </div>
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
  const [interval, setInterval] = useState<Interval>('d1')
  const [data, setData] = useState<Candle[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('torn-favorites')
    return saved ? new Set(JSON.parse(saved)) : new Set()
  })

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (settingsOpen && !target.closest('.settings-container')) {
        setSettingsOpen(false)
      }
    }

    if (settingsOpen) {
      document.addEventListener('click', handleClickOutside)
    }

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [settingsOpen])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const candles = await fetchOhlc(ticker, interval)
        if (!cancelled) {
          setData(candles)
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Error loading data:', e instanceof Error ? e.message : 'Unknown error')
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

  const allTickers = useMemo(
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
    ],
    []
  )

  const watchlist = useMemo(() => {
    const favs = allTickers.filter(t => favorites.has(t)).sort()
    const nonFavs = allTickers.filter(t => !favorites.has(t)).sort()
    return [...favs, ...nonFavs]
  }, [allTickers, favorites])

  const handleSelectFromList = (symbol: string) => {
    const value = symbol.toLowerCase()
    setTicker(value)
    setInputTicker(value)
  }

  const toggleFavorite = (symbol: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const newFavorites = new Set(prev)
      if (newFavorites.has(symbol)) {
        newFavorites.delete(symbol)
      } else {
        newFavorites.add(symbol)
      }
      localStorage.setItem('torn-favorites', JSON.stringify([...newFavorites]))
      return newFavorites
    })
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    const upper = ticker.toUpperCase()
    const index = watchlist.indexOf(upper)
    const currentIndex = index === -1 ? 0 : index
    const newIndex = direction === 'prev' 
      ? (currentIndex - 1 + watchlist.length) % watchlist.length
      : (currentIndex + 1) % watchlist.length
    handleSelectFromList(watchlist[newIndex])
  }

  const handleClearCache = () => {
    setSettingsOpen(false)
    if (confirm('Clear all cache? This will reload data from the API.')) {
      try {
        let cleared = 0
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i)
          if (key && key.startsWith('ohlc_')) {
            localStorage.removeItem(key)
            cleared++
          }
        }
        alert(`✅ Cache cleared! ${cleared} entry(ies) removed.`)
        // Reload current data
        window.location.reload()
      } catch (error) {
        alert('❌ Error clearing cache')
        console.error(error)
      }
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleNavigate('next')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleNavigate('prev')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [ticker, watchlist])

  return (
    <div className="app-root">
      <div className="app-left">
        <header className="app-header">
          <div className="header-left">
            <h1>Torn Chart</h1>
            <div className="mobile-controls">
              <select
                value={ticker}
                onChange={(e) => handleSelectFromList(e.target.value)}
                className="mobile-dropdown"
              >
                {watchlist.map((symbol) => (
                  <option key={symbol} value={symbol.toLowerCase()}>
                    {symbol}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-previous" onClick={() => handleNavigate('prev')}>
                Previous
              </button>
              <button type="button" className="btn-next" onClick={() => handleNavigate('next')}>
                Next
              </button>
              <SettingsButton 
                settingsOpen={settingsOpen}
                setSettingsOpen={setSettingsOpen}
                handleClearCache={handleClearCache}
              />
            </div>
            <div className="interval-group">
              <button
                type="button"
                className={`interval-btn ${interval === '1h' ? 'active' : ''}`}
                onClick={() => setInterval('1h')}
              >
                1H
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === '2h' ? 'active' : ''}`}
                onClick={() => setInterval('2h')}
              >
                2H
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === '4h' ? 'active' : ''}`}
                onClick={() => setInterval('4h')}
              >
                4H
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === '6h' ? 'active' : ''}`}
                onClick={() => setInterval('6h')}
              >
                6H
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === '12h' ? 'active' : ''}`}
                onClick={() => setInterval('12h')}
              >
                12H
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === 'd1' ? 'active' : ''}`}
                onClick={() => setInterval('d1')}
              >
                D
              </button>
              <button
                type="button"
                className={`interval-btn ${interval === 'w1' ? 'active' : ''}`}
                onClick={() => setInterval('w1')}
              >
                W
              </button>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="controls desktop-only">
            <label>
              Ticker
            </label>
            <input
              name="ticker"
              value={inputTicker}
              onChange={(e) => setInputTicker(e.target.value)}
              placeholder="fhg"
            />
            <button type="submit">Load</button>
            <button type="button" className="btn-previous" onClick={() => handleNavigate('prev')}>
              Previous
            </button>
            <button type="button" className="btn-next" onClick={() => handleNavigate('next')}>
              Next
            </button>
            <SettingsButton 
              settingsOpen={settingsOpen}
              setSettingsOpen={setSettingsOpen}
              handleClearCache={handleClearCache}
            />
          </form>
        </header>

        <main className="app-main">
          {data.length > 0 && (
            <div className="chart-container">
              <CandleChart data={data} ticker={ticker} interval={interval} />
            </div>
          )}
        </main>
      </div>

      <aside className="watchlist">
        <div className="watchlist-header">
          <span>Acronym</span>
        </div>
        <ul>
          {watchlist.map((symbol) => (
            <li key={symbol}>
              <button
                type="button"
                className="favorite-btn"
                onClick={(e) => toggleFavorite(symbol, e)}
                title={favorites.has(symbol) ? 'Remove from favorites' : 'Add to favorites'}
              >
                {favorites.has(symbol) ? '★' : '☆'}
              </button>
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
