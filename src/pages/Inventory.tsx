import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { ArrowDownToLine, CheckCircle2, History, Search, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import Modal from '../components/Modal'
import { Badge, btnPrimary, btnSecondary, cardCls, EmptyState, Field, iconBtn, inputCls, LoadingBlock, PageHeader, Spinner, tdCls, thCls } from '../components/ui'
import { listProducts } from '../services/masterService'
import { addStock, adjustStock, getLedger } from '../services/inventoryService'
import { formatINR, formatKg, formatQty, parseQtyInput, round2 } from '../lib/calculator'
import { formatDisplayDate, todayISO } from '../lib/date'
import { cn, errorMessage } from '../lib/utils'
import type { MovementType, Product, StockMovement } from '../types'

const MOVEMENT_LABEL: Record<MovementType, { label: string; tone: 'green' | 'red' | 'amber' | 'blue' }> = {
  IN: { label: 'Stock In', tone: 'green' },
  SALE: { label: 'Sale', tone: 'blue' },
  SALE_REVERSAL: { label: 'Sale Reversal', tone: 'amber' },
  ADJUSTMENT: { label: 'Adjustment', tone: 'red' },
}

const ADJUST_REASONS = ['Wastage', 'Damaged', 'Physical count correction', 'Sample / free', 'Other']

type AdjustMode = 'remove' | 'add' | 'count'

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [saving, setSaving] = useState(false)

  // Stock In
  const [inOpen, setInOpen] = useState(false)
  const [inForm, setInForm] = useState({ productId: '', qty: '', rate: '', date: todayISO(), note: '' })

  // Adjust
  const [adjOpen, setAdjOpen] = useState(false)
  const [adjForm, setAdjForm] = useState({ productId: '', mode: 'remove' as AdjustMode, qty: '', reason: ADJUST_REASONS[0], note: '' })

  // Ledger
  const [ledgerFor, setLedgerFor] = useState<Product | null>(null)
  const [ledger, setLedger] = useState<StockMovement[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const p = await listProducts({ activeOnly: true })
      setProducts(p)
      return p
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load inventory'))
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(
      (p) => (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) && (!lowOnly || p.stockGrams <= p.lowStockThresholdGrams),
    )
  }, [products, search, lowOnly])

  const totals = useMemo(() => {
    let grams = 0
    let saleValue = 0
    let costValue = 0
    for (const p of products) {
      grams += p.stockGrams
      saleValue += (p.stockGrams / 1000) * p.currentRate
      costValue += (p.stockGrams / 1000) * (p.purchaseRate || 0)
    }
    return { grams, saleValue: round2(saleValue), costValue: round2(costValue), low: products.filter((p) => p.stockGrams <= p.lowStockThresholdGrams).length }
  }, [products])

  const productById = (id: string) => products.find((p) => p.id === id)

  const openStockIn = (p?: Product) => {
    setInForm({ productId: p?.id ?? '', qty: '', rate: p?.purchaseRate ? String(p.purchaseRate) : '', date: todayISO(), note: '' })
    setInOpen(true)
  }

  const openAdjust = (p?: Product) => {
    setAdjForm({ productId: p?.id ?? '', mode: 'remove', qty: '', reason: ADJUST_REASONS[0], note: '' })
    setAdjOpen(true)
  }

  const submitStockIn = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    const product = productById(inForm.productId)
    if (!product) return toast.error('Select a product')
    const grams = parseQtyInput(inForm.qty)
    if (grams === null) return toast.error('Enter a valid quantity')
    const rate = inForm.rate ? Number(inForm.rate) : undefined
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) return toast.error('Enter a valid purchase rate')

    setSaving(true)
    try {
      const balance = await addStock({
        productId: product.id,
        qtyGrams: grams,
        purchaseRatePerKg: rate,
        date: inForm.date,
        note: inForm.note,
      })
      toast.success(`Added ${formatQty(grams)} of ${product.name}. Stock now ${formatKg(balance)} kg`)
      setInOpen(false)
      await load()
    } catch (err) {
      toast.error(errorMessage(err, 'Stock in failed'))
    } finally {
      setSaving(false)
    }
  }

  const adjPreview = useMemo(() => {
    const product = products.find((p) => p.id === adjForm.productId)
    if (!product) return null
    let delta: number | null
    if (adjForm.mode === 'count') {
      // A physical count may legitimately be 0, which parseQtyInput rejects.
      const counted = /^0+(\.0+)?\s*(kg|g)?$/i.test(adjForm.qty.trim()) ? 0 : parseQtyInput(adjForm.qty)
      delta = counted === null ? null : counted - product.stockGrams
    } else {
      const g = parseQtyInput(adjForm.qty)
      delta = g === null ? null : adjForm.mode === 'add' ? g : -g
    }
    return { product, delta, after: delta === null ? null : product.stockGrams + delta }
  }, [adjForm, products])

  const submitAdjust = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!adjPreview) return toast.error('Select a product')
    const { product, delta, after } = adjPreview
    if (delta === null || after === null) return toast.error('Enter a valid quantity')
    if (delta === 0) return toast.error('Stock already matches — nothing to adjust')
    if (after < 0) return toast.error(`Only ${formatKg(product.stockGrams)} kg of ${product.name} in stock`)
    const reason = [adjForm.reason, adjForm.note.trim()].filter(Boolean).join(': ')

    setSaving(true)
    try {
      const balance = await adjustStock({ productId: product.id, deltaGrams: delta, reason })
      toast.success(`${product.name} adjusted. Stock now ${formatKg(balance)} kg`)
      setAdjOpen(false)
      await load()
    } catch (err) {
      toast.error(errorMessage(err, 'Adjustment failed'))
    } finally {
      setSaving(false)
    }
  }

  const openLedger = async (p: Product) => {
    setLedgerFor(p)
    setLedger([])
    setLedgerLoading(true)
    try {
      const [rows, fresh] = await Promise.all([getLedger(p.id), load()])
      setLedger(rows)
      const updated = fresh.find((x) => x.id === p.id)
      if (updated) setLedgerFor(updated)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load ledger'))
    } finally {
      setLedgerLoading(false)
    }
  }

  const ledgerSum = ledger.reduce((s, m) => s + m.qtyGrams, 0)
  const ledgerOk = ledgerFor ? ledgerSum === ledgerFor.stockGrams : true

  return (
    <div>
      <PageHeader
        title="Inventory"
        actions={
          <>
            <button className={btnSecondary} onClick={() => openAdjust()}>
              <SlidersHorizontal className="h-4 w-4" /> Adjust
            </button>
            <button className={btnPrimary} onClick={() => openStockIn()}>
              <ArrowDownToLine className="h-4 w-4" /> Stock In
            </button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total stock" value={`${formatKg(totals.grams)} kg`} />
        <Stat label="Value at today's rate" value={formatINR(totals.saleValue)} />
        <Stat label="Value at purchase rate" value={totals.costValue ? formatINR(totals.costValue) : '—'} />
        <Stat label="Low-stock items" value={String(totals.low)} tone={totals.low ? 'red' : undefined} />
      </div>

      <div className={cardCls}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
          </label>
        </div>
        {loading ? (
          <LoadingBlock />
        ) : filtered.length === 0 ? (
          <EmptyState title="No products" subtitle="Add products on the Products page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={thCls}>Product</th>
                  <th className={`${thCls} text-right`}>Stock (kg)</th>
                  <th className={`${thCls} text-right`}>Alert at</th>
                  <th className={`${thCls} text-right`}>Rate / kg</th>
                  <th className={`${thCls} text-right`}>Value</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const out = p.stockGrams === 0
                  const low = p.stockGrams <= p.lowStockThresholdGrams
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60">
                      <td className={tdCls}>
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.category}</p>
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <span className="mr-2 font-semibold tabular-nums">{formatKg(p.stockGrams)}</span>
                        {out ? <Badge tone="red">Out</Badge> : low ? <Badge tone="amber">Low</Badge> : null}
                      </td>
                      <td className={`${tdCls} text-right text-slate-500 tabular-nums`}>{formatKg(p.lowStockThresholdGrams)}</td>
                      <td className={`${tdCls} text-right`}>{p.currentRate ? formatINR(p.currentRate) : <span className="text-amber-600">Not set</span>}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatINR((p.stockGrams / 1000) * p.currentRate)}</td>
                      <td className={`${tdCls} text-right whitespace-nowrap`}>
                        <button className={iconBtn} onClick={() => openStockIn(p)} title="Stock In">
                          <ArrowDownToLine className="h-4 w-4" />
                        </button>
                        <button className={iconBtn} onClick={() => openAdjust(p)} title="Adjust">
                          <SlidersHorizontal className="h-4 w-4" />
                        </button>
                        <button className={iconBtn} onClick={() => openLedger(p)} title="Ledger">
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

      {/* Stock In */}
      <Modal
        open={inOpen}
        title="Stock In"
        onClose={() => !saving && setInOpen(false)}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setInOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} type="submit" form="stockin-form" disabled={saving}>
              {saving && <Spinner />} Add Stock
            </button>
          </>
        }
      >
        <form id="stockin-form" onSubmit={submitStockIn} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product" className="sm:col-span-2">
            <select className={inputCls} value={inForm.productId} onChange={(e) => {
              const p = productById(e.target.value)
              setInForm({ ...inForm, productId: e.target.value, rate: p?.purchaseRate ? String(p.purchaseRate) : inForm.rate })
            }}>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({formatKg(p.stockGrams)} kg)</option>
              ))}
            </select>
          </Field>
          <Field label="Quantity" hint={(() => { const g = parseQtyInput(inForm.qty); return g ? `= ${formatQty(g)}` : 'kg by default; "25", "1/2" or "500g" work' })()}>
            <input className={inputCls} value={inForm.qty} onChange={(e) => setInForm({ ...inForm, qty: e.target.value })} inputMode="decimal" placeholder="e.g. 25" />
          </Field>
          <Field label="Purchase rate / kg">
            <input className={inputCls} type="number" inputMode="decimal" min="0" step="0.01" value={inForm.rate} onChange={(e) => setInForm({ ...inForm, rate: e.target.value })} placeholder="optional" />
          </Field>
          <Field label="Date">
            <input type="date" className={inputCls} value={inForm.date} max={todayISO()} onChange={(e) => setInForm({ ...inForm, date: e.target.value })} />
          </Field>
          <Field label="Note">
            <input className={inputCls} value={inForm.note} onChange={(e) => setInForm({ ...inForm, note: e.target.value })} placeholder="Purchase invoice no., lot, etc." />
          </Field>
          {(() => {
            const g = parseQtyInput(inForm.qty)
            const r = Number(inForm.rate)
            return g && r ? <p className="text-sm text-slate-600 sm:col-span-2">Purchase value: <b>{formatINR((g / 1000) * r)}</b></p> : null
          })()}
        </form>
      </Modal>

      {/* Adjust */}
      <Modal
        open={adjOpen}
        title="Adjust Stock"
        onClose={() => !saving && setAdjOpen(false)}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setAdjOpen(false)} disabled={saving}>Cancel</button>
            <button className={btnPrimary} type="submit" form="adjust-form" disabled={saving}>
              {saving && <Spinner />} Save Adjustment
            </button>
          </>
        }
      >
        <form id="adjust-form" onSubmit={submitAdjust} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Product" className="sm:col-span-2">
            <select className={inputCls} value={adjForm.productId} onChange={(e) => setAdjForm({ ...adjForm, productId: e.target.value })}>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({formatKg(p.stockGrams)} kg)</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">Type</span>
            <div className="grid grid-cols-3 gap-2">
              {([['remove', 'Remove'], ['add', 'Add'], ['count', 'Set to count']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAdjForm({ ...adjForm, mode: m, reason: m === 'count' ? 'Physical count correction' : adjForm.reason })}
                  className={cn('rounded-lg border px-3 py-2 text-sm font-medium', adjForm.mode === m ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label={adjForm.mode === 'count' ? 'Actual stock counted' : 'Quantity'} hint='kg by default; "1/2" or "500g" work'>
            <input className={inputCls} value={adjForm.qty} onChange={(e) => setAdjForm({ ...adjForm, qty: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Reason">
            <select className={inputCls} value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}>
              {ADJUST_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Details" className="sm:col-span-2">
            <input className={inputCls} value={adjForm.note} onChange={(e) => setAdjForm({ ...adjForm, note: e.target.value })} placeholder="What happened?" />
          </Field>
          {adjPreview && adjPreview.after !== null && (
            <div className={cn('rounded-lg p-3 text-sm sm:col-span-2', adjPreview.after < 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-700')}>
              {formatKg(adjPreview.product.stockGrams)} kg → <b>{formatKg(Math.max(adjPreview.after, 0))} kg</b>
              {adjPreview.delta !== null && adjPreview.delta !== 0 && (
                <span> ({adjPreview.delta > 0 ? '+' : '−'}{formatQty(Math.abs(adjPreview.delta))})</span>
              )}
              {adjPreview.after < 0 && <span className="block">Stock cannot go below 0.</span>}
            </div>
          )}
        </form>
      </Modal>

      {/* Ledger */}
      <Modal open={!!ledgerFor} title={`Stock ledger — ${ledgerFor?.name ?? ''}`} onClose={() => setLedgerFor(null)} variant="drawer" size="lg">
        {ledgerLoading ? (
          <LoadingBlock />
        ) : (
          <>
            {ledgerFor && (
              <div className={cn('mb-4 flex items-start gap-2 rounded-lg p-3 text-sm', ledgerOk ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}>
                {ledgerOk ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  Current stock <b>{formatKg(ledgerFor.stockGrams)} kg</b>. Sum of all movements <b>{formatKg(ledgerSum)} kg</b>.
                  {ledgerOk ? ' The ledger matches.' : ' Mismatch! Check the entries below.'}
                </div>
              </div>
            )}
            {ledger.length === 0 ? (
              <EmptyState title="No movements yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Type</th>
                      <th className={`${thCls} text-right`}>Qty (kg)</th>
                      <th className={`${thCls} text-right`}>Balance</th>
                      <th className={thCls}>Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.map((m) => (
                      <tr key={m.id}>
                        <td className={`${tdCls} whitespace-nowrap`}>{formatDisplayDate(m.date)}</td>
                        <td className={tdCls}><Badge tone={MOVEMENT_LABEL[m.type].tone}>{MOVEMENT_LABEL[m.type].label}</Badge></td>
                        <td className={cn(tdCls, 'text-right font-medium tabular-nums', m.qtyGrams >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                          {m.qtyGrams >= 0 ? '+' : '−'}{formatKg(Math.abs(m.qtyGrams))}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatKg(m.balanceAfterGrams)}</td>
                        <td className={`${tdCls} text-xs text-slate-500`}>
                          {m.billNumber && <span className="mr-1 font-medium text-slate-700">Bill {m.billNumber}</span>}
                          {m.purchaseRatePerKg ? <span className="mr-1">@ {formatINR(m.purchaseRatePerKg)}/kg</span> : null}
                          {m.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <div className={`${cardCls} p-4`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'red' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
    </div>
  )
}
