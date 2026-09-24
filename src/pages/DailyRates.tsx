import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowDownRight, ArrowUpRight, Copy, History, Save } from 'lucide-react'
import Modal from '../components/Modal'
import { btnPrimary, btnSecondary, cardCls, EmptyState, iconBtn, inputCls, LoadingBlock, PageHeader, Spinner, tdCls, thCls } from '../components/ui'
import { listProducts } from '../services/masterService'
import { getRateHistory, getRatesForDate, saveRates } from '../services/rateService'
import { formatINR, round2 } from '../lib/calculator'
import { addDaysISO, formatDisplayDate, todayISO } from '../lib/date'
import { errorMessage } from '../lib/utils'
import type { DailyRate, Product } from '../types'

interface RowInput {
  rate: string
  purchase: string
}

export default function DailyRates() {
  const [date, setDate] = useState(todayISO())
  const [products, setProducts] = useState<Product[]>([])
  const [rates, setRates] = useState<Map<string, DailyRate>>(new Map())
  const [prevRates, setPrevRates] = useState<Map<string, DailyRate>>(new Map())
  const [inputs, setInputs] = useState<Record<string, RowInput>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [historyFor, setHistoryFor] = useState<Product | null>(null)
  const [history, setHistory] = useState<DailyRate[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const isToday = date === todayISO()

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const [prods, current, previous] = await Promise.all([
        listProducts({ activeOnly: true }),
        getRatesForDate(d),
        getRatesForDate(addDaysISO(d, -1)),
      ])
      setProducts(prods)
      setRates(current)
      setPrevRates(previous)
      const next: Record<string, RowInput> = {}
      for (const p of prods) {
        const r = current.get(p.id)
        next[p.id] = {
          rate: r ? String(r.ratePerKg) : '',
          purchase: r?.purchaseRatePerKg ? String(r.purchaseRatePerKg) : '',
        }
      }
      setInputs(next)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load rates'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const dirtyCount = useMemo(
    () =>
      products.filter((p) => {
        const input = inputs[p.id]
        if (!input || !input.rate) return false
        const saved = rates.get(p.id)
        return (
          !saved ||
          Number(input.rate) !== saved.ratePerKg ||
          (Number(input.purchase) || 0) !== (saved.purchaseRatePerKg ?? 0)
        )
      }).length,
    [products, inputs, rates],
  )

  const missingCount = products.filter((p) => !inputs[p.id]?.rate).length

  const setInput = (id: string, patch: Partial<RowInput>) =>
    setInputs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const copyPrevious = () => {
    let copied = 0
    const next = { ...inputs }
    for (const p of products) {
      const prevRate = prevRates.get(p.id)
      if (prevRate && !next[p.id]?.rate) {
        next[p.id] = {
          rate: String(prevRate.ratePerKg),
          purchase: prevRate.purchaseRatePerKg ? String(prevRate.purchaseRatePerKg) : (next[p.id]?.purchase ?? ''),
        }
        copied++
      }
    }
    setInputs(next)
    if (copied) toast.success(`Copied ${copied} rate(s). Review, then Save All`)
    else toast('Nothing to copy')
  }

  const handleSaveAll = async () => {
    if (saving) return
    const rows = []
    for (const p of products) {
      const input = inputs[p.id]
      if (!input?.rate) continue
      const rate = Number(input.rate)
      const purchase = input.purchase ? Number(input.purchase) : undefined
      if (!Number.isFinite(rate) || rate <= 0) return toast.error(`Invalid rate for ${p.name}`)
      if (purchase !== undefined && (!Number.isFinite(purchase) || purchase < 0)) return toast.error(`Invalid purchase rate for ${p.name}`)
      rows.push({ productId: p.id, productName: p.name, ratePerKg: rate, purchaseRatePerKg: purchase })
    }
    setSaving(true)
    try {
      const n = await saveRates(date, rows)
      toast.success(`Saved ${n} rate(s) for ${formatDisplayDate(date)}`)
      await load(date)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save rates'))
    } finally {
      setSaving(false)
    }
  }

  const openHistory = async (p: Product) => {
    setHistoryFor(p)
    setHistory([])
    setHistoryLoading(true)
    try {
      setHistory(await getRateHistory(p.id))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load history'))
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Daily Rates"
        subtitle={isToday ? "Today's selling rates are used when you create bills." : `Editing rates for ${formatDisplayDate(date)}`}
        actions={
          <>
            <input type="date" className={`${inputCls} w-auto`} value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button className={btnSecondary} onClick={copyPrevious} disabled={loading || prevRates.size === 0}>
              <Copy className="h-4 w-4" /> Copy previous day
            </button>
            <button className={btnPrimary} onClick={handleSaveAll} disabled={saving || loading || dirtyCount === 0}>
              {saving ? <Spinner /> : <Save className="h-4 w-4" />} Save All{dirtyCount ? ` (${dirtyCount})` : ''}
            </button>
          </>
        }
      />

      {!loading && isToday && missingCount > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {missingCount} product(s) have no rate for today.
        </div>
      )}

      <div className={cardCls}>
        {loading ? (
          <LoadingBlock />
        ) : products.length === 0 ? (
          <EmptyState
            title="No active products"
            subtitle="Add products first."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={thCls}>Product</th>
                  <th className={`${thCls} text-right`}>Previous day</th>
                  <th className={thCls}>Selling rate / kg</th>
                  <th className={thCls}>Purchase rate / kg</th>
                  <th className={`${thCls} text-right`}>Margin</th>
                  <th className={thCls}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => {
                  const input = inputs[p.id] ?? { rate: '', purchase: '' }
                  const prev = prevRates.get(p.id)
                  const rate = Number(input.rate) || 0
                  const purchase = Number(input.purchase) || 0
                  const diff = prev && rate ? round2(rate - prev.ratePerKg) : 0
                  const margin = rate && purchase ? round2(((rate - purchase) / rate) * 100) : null
                  return (
                    <tr key={p.id}>
                      <td className={tdCls}>
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.category}</p>
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {prev ? formatINR(prev.ratePerKg) : <span className="text-slate-400">—</span>}
                        {diff !== 0 && (
                          <span className={`ml-1 inline-flex items-center text-xs ${diff > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(diff)}
                          </span>
                        )}
                      </td>
                      <td className={tdCls}>
                        <div className="relative w-36">
                          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">₹</span>
                          <input
                            className={`${inputCls} pl-7 ${!input.rate ? 'border-amber-300' : ''}`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={input.rate}
                            onChange={(e) => setInput(p.id, { rate: e.target.value })}
                            placeholder={prev ? String(prev.ratePerKg) : '0'}
                          />
                        </div>
                      </td>
                      <td className={tdCls}>
                        <div className="relative w-36">
                          <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">₹</span>
                          <input
                            className={`${inputCls} pl-7`}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={input.purchase}
                            onChange={(e) => setInput(p.id, { purchase: e.target.value })}
                            placeholder="optional"
                          />
                        </div>
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {margin === null ? '—' : <span className={margin < 0 ? 'text-red-600' : 'text-emerald-700'}>{margin}%</span>}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <button className={iconBtn} onClick={() => openHistory(p)} title="Rate history">
                          <History className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && products.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Need a new product? <Link to="/products" className="text-blue-600 hover:underline">Add it on the Products page</Link>.
        </p>
      )}

      <Modal open={!!historyFor} title={`Rate history — ${historyFor?.name ?? ''}`} onClose={() => setHistoryFor(null)} variant="drawer">
        {historyLoading ? (
          <LoadingBlock />
        ) : history.length === 0 ? (
          <EmptyState title="No rates recorded yet" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={thCls}>Date</th>
                <th className={`${thCls} text-right`}>Selling</th>
                <th className={`${thCls} text-right`}>Purchase</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className={tdCls}>{formatDisplayDate(h.date)}</td>
                  <td className={`${tdCls} text-right font-medium`}>{formatINR(h.ratePerKg)}</td>
                  <td className={`${tdCls} text-right`}>{h.purchaseRatePerKg ? formatINR(h.purchaseRatePerKg) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </div>
  )
}
