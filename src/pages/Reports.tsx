import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FileDown, RefreshCw } from 'lucide-react'
import { Badge, btnSecondary, cardCls, EmptyState, inputCls, LoadingBlock, PageHeader, tdCls, thCls } from '../components/ui'
import { listBills } from '../services/billService'
import { getMovementsByDate } from '../services/inventoryService'
import { listProducts } from '../services/masterService'
import { formatINR, formatKg, round2 } from '../lib/calculator'
import { addDaysISO, formatDisplayDate, todayISO } from '../lib/date'
import { downloadCSV, type CsvCell } from '../lib/csv'
import { cn, errorMessage } from '../lib/utils'
import type { Bill, MovementType, Product, StockMovement } from '../types'

type Tab = 'sales' | 'products' | 'movements' | 'stock'

const TABS: { value: Tab; label: string }[] = [
  { value: 'sales', label: 'Sales by day' },
  { value: 'products', label: 'Product-wise' },
  { value: 'movements', label: 'Stock movements' },
  { value: 'stock', label: 'Current stock' },
]

const MOVEMENT_TONE: Record<MovementType, 'green' | 'blue' | 'amber' | 'red'> = { IN: 'green', SALE: 'blue', SALE_REVERSAL: 'amber', ADJUSTMENT: 'red' }

function monthStartISO(): string {
  return `${todayISO().slice(0, 8)}01`
}

export default function Reports() {
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [tab, setTab] = useState<Tab>('sales')
  const [bills, setBills] = useState<Bill[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [movementType, setMovementType] = useState<'' | MovementType>('')
  const [movementProduct, setMovementProduct] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [b, m, p] = await Promise.all([listBills(from, to), getMovementsByDate(from, to), listProducts()])
      setBills(b)
      setMovements(m)
      setProducts(p)
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load reports'))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load])

  const activeBills = useMemo(() => bills.filter((b) => b.status === 'active'), [bills])

  // ---- Sales by day ----
  const salesByDay = useMemo(() => {
    const map = new Map<string, { date: string; bills: number; grams: number; subtotal: number; discount: number; tax: number; total: number }>()
    for (const b of activeBills) {
      const row = map.get(b.billDate) ?? { date: b.billDate, bills: 0, grams: 0, subtotal: 0, discount: 0, tax: 0, total: 0 }
      row.bills++
      row.grams += b.items.reduce((s, i) => s + i.qtyGrams, 0)
      row.subtotal += b.subtotal
      row.discount += b.discount
      row.tax += b.gstAmount
      row.total += b.grandTotal
      map.set(b.billDate, row)
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [activeBills])

  const salesTotals = useMemo(
    () =>
      salesByDay.reduce(
        (t, r) => ({ bills: t.bills + r.bills, grams: t.grams + r.grams, subtotal: t.subtotal + r.subtotal, discount: t.discount + r.discount, tax: t.tax + r.tax, total: t.total + r.total }),
        { bills: 0, grams: 0, subtotal: 0, discount: 0, tax: 0, total: 0 },
      ),
    [salesByDay],
  )

  // ---- Product-wise ----
  const productRows = useMemo(() => {
    const purchase = new Map(products.map((p) => [p.id, p.purchaseRate || 0]))
    const map = new Map<string, { productId: string; name: string; grams: number; value: number; bills: Set<string> }>()
    for (const b of activeBills) {
      for (const it of b.items) {
        const row = map.get(it.productId) ?? { productId: it.productId, name: it.productName, grams: 0, value: 0, bills: new Set<string>() }
        row.grams += it.qtyGrams
        row.value += it.amount
        row.bills.add(b.id)
        map.set(it.productId, row)
      }
    }
    return [...map.values()]
      .map((r) => {
        const rate = purchase.get(r.productId) ?? 0
        const cost = rate ? round2((r.grams / 1000) * rate) : null
        return {
          ...r,
          value: round2(r.value),
          avgRate: r.grams ? round2(r.value / (r.grams / 1000)) : 0,
          billCount: r.bills.size,
          cost,
          margin: cost === null ? null : round2(r.value - cost),
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [activeBills, products])

  // ---- Movements ----
  const filteredMovements = useMemo(
    () => movements.filter((m) => (!movementType || m.type === movementType) && (!movementProduct || m.productId === movementProduct)),
    [movements, movementType, movementProduct],
  )

  const movementSummary = useMemo(() => {
    const sum: Record<MovementType, number> = { IN: 0, SALE: 0, SALE_REVERSAL: 0, ADJUSTMENT: 0 }
    for (const m of filteredMovements) sum[m.type] += m.qtyGrams
    return sum
  }, [filteredMovements])

  // ---- CSV ----
  const exportCSV = () => {
    const range = `${from}_to_${to}`
    let rows: CsvCell[][] = []
    let name = ''
    if (tab === 'sales') {
      name = `sales_${range}.csv`
      rows = [
        ['Date', 'Bills', 'Qty (kg)', 'Subtotal', 'Discount', 'GST', 'Grand Total'],
        ...salesByDay.map((r) => [formatDisplayDate(r.date), r.bills, formatKg(r.grams), round2(r.subtotal), round2(r.discount), round2(r.tax), round2(r.total)]),
        ['Total', salesTotals.bills, formatKg(salesTotals.grams), round2(salesTotals.subtotal), round2(salesTotals.discount), round2(salesTotals.tax), round2(salesTotals.total)],
        [],
        ['Bill No', 'Date', 'Customer', 'Phone', 'GSTIN', 'Payment', 'Subtotal', 'Discount', 'GST', 'Grand Total', 'Status'],
        ...bills.map((b) => [b.billNumber, formatDisplayDate(b.billDate), b.customerSnapshot.name, b.customerSnapshot.phone, b.customerSnapshot.gstNo, b.paymentMode, b.subtotal, b.discount, b.gstAmount, b.grandTotal, b.status]),
      ]
    } else if (tab === 'products') {
      name = `product_sales_${range}.csv`
      rows = [
        ['Product', 'Qty sold (kg)', 'Bills', 'Avg rate / kg', 'Sales value', 'Est. cost', 'Est. margin'],
        ...productRows.map((r) => [r.name, formatKg(r.grams), r.billCount, r.avgRate, r.value, r.cost ?? '', r.margin ?? '']),
      ]
    } else if (tab === 'movements') {
      name = `stock_movements_${range}.csv`
      rows = [
        ['Date', 'Product', 'Type', 'Qty (kg)', 'Balance after (kg)', 'Bill No', 'Purchase rate / kg', 'Note'],
        ...filteredMovements.map((m) => [formatDisplayDate(m.date), m.productName, m.type, formatKg(m.qtyGrams), formatKg(m.balanceAfterGrams), m.billNumber ?? '', m.purchaseRatePerKg ?? '', m.note]),
      ]
    } else {
      name = `stock_${todayISO()}.csv`
      rows = [
        ['Product', 'Category', 'Stock (kg)', 'Alert at (kg)', 'Rate / kg', 'Value at rate', 'Purchase rate / kg', 'Value at cost', 'Active'],
        ...products.map((p) => [p.name, p.category, formatKg(p.stockGrams), formatKg(p.lowStockThresholdGrams), p.currentRate, round2((p.stockGrams / 1000) * p.currentRate), p.purchaseRate || '', p.purchaseRate ? round2((p.stockGrams / 1000) * p.purchaseRate) : '', p.isActive ? 'Yes' : 'No']),
      ]
    }
    downloadCSV(name, rows)
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        actions={
          <>
            <button className={btnSecondary} onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
            </button>
            <button className={btnSecondary} onClick={exportCSV} disabled={loading}>
              <FileDown className="h-4 w-4" /> Export CSV
            </button>
          </>
        }
      />

      <div className={`${cardCls} mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:items-center`}>
        <div className="flex gap-2">
          <input type="date" className={inputCls} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <input type="date" className={inputCls} value={to} min={from} max={todayISO()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            ['Today', todayISO(), todayISO()],
            ['Last 7 days', addDaysISO(todayISO(), -6), todayISO()],
            ['This month', monthStartISO(), todayISO()],
            ['Last 30 days', addDaysISO(todayISO(), -29), todayISO()],
          ].map(([label, f, t]) => (
            <button
              key={label}
              onClick={() => {
                setFrom(f)
                setTo(t)
              }}
              className={cn('rounded-full border px-3 py-1 text-xs', from === f && to === t ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn('flex-1 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap', tab === t.value ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={cardCls}>
        {loading ? (
          <LoadingBlock />
        ) : tab === 'sales' ? (
          salesByDay.length === 0 ? (
            <EmptyState title="No sales in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={`${thCls} text-right`}>Bills</th>
                    <th className={`${thCls} text-right`}>Qty (kg)</th>
                    <th className={`${thCls} text-right`}>Subtotal</th>
                    <th className={`${thCls} text-right`}>Discount</th>
                    <th className={`${thCls} text-right`}>GST</th>
                    <th className={`${thCls} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesByDay.map((r) => (
                    <tr key={r.date}>
                      <td className={tdCls}>{formatDisplayDate(r.date)}</td>
                      <td className={`${tdCls} text-right`}>{r.bills}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatKg(r.grams)}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatINR(r.subtotal)}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.discount ? formatINR(r.discount) : '—'}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{r.tax ? formatINR(r.tax) : '—'}</td>
                      <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatINR(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                  <tr>
                    <td className={tdCls}>Total</td>
                    <td className={`${tdCls} text-right`}>{salesTotals.bills}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatKg(salesTotals.grams)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatINR(salesTotals.subtotal)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatINR(salesTotals.discount)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatINR(salesTotals.tax)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatINR(salesTotals.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : tab === 'products' ? (
          productRows.length === 0 ? (
            <EmptyState title="No sales in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={thCls}>Product</th>
                    <th className={`${thCls} text-right`}>Qty sold (kg)</th>
                    <th className={`${thCls} text-right`}>Bills</th>
                    <th className={`${thCls} text-right`}>Avg rate</th>
                    <th className={`${thCls} text-right`}>Sales value</th>
                    <th className={`${thCls} text-right`}>Est. margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productRows.map((r) => (
                    <tr key={r.productId}>
                      <td className={`${tdCls} font-medium text-slate-900`}>{r.name}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatKg(r.grams)}</td>
                      <td className={`${tdCls} text-right`}>{r.billCount}</td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatINR(r.avgRate)}</td>
                      <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatINR(r.value)}</td>
                      <td className={cn(tdCls, 'text-right tabular-nums', r.margin !== null && r.margin < 0 && 'text-red-600')}>{r.margin === null ? '—' : formatINR(r.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-xs text-slate-500">
                Sales value is before discount and GST. Margin is estimated from each product's latest purchase rate.
              </p>
            </div>
          )
        ) : tab === 'movements' ? (
          <>
            <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row">
              <select className={inputCls} value={movementProduct} onChange={(e) => setMovementProduct(e.target.value)}>
                <option value="">All products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select className={inputCls} value={movementType} onChange={(e) => setMovementType(e.target.value as '' | MovementType)}>
                <option value="">All types</option>
                <option value="IN">Stock In</option>
                <option value="SALE">Sale</option>
                <option value="SALE_REVERSAL">Sale Reversal</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
              {(Object.keys(movementSummary) as MovementType[]).map((t) => (
                <div key={t}>
                  <p className="text-xs text-slate-500">{t.replace('_', ' ')}</p>
                  <p className="font-semibold tabular-nums">{movementSummary[t] >= 0 ? '+' : '−'}{formatKg(Math.abs(movementSummary[t]))} kg</p>
                </div>
              ))}
            </div>
            {filteredMovements.length === 0 ? (
              <EmptyState title="No movements in this period" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Product</th>
                      <th className={thCls}>Type</th>
                      <th className={`${thCls} text-right`}>Qty (kg)</th>
                      <th className={`${thCls} text-right`}>Balance</th>
                      <th className={thCls}>Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMovements.map((m) => (
                      <tr key={m.id}>
                        <td className={`${tdCls} whitespace-nowrap`}>{formatDisplayDate(m.date)}</td>
                        <td className={tdCls}>{m.productName}</td>
                        <td className={tdCls}><Badge tone={MOVEMENT_TONE[m.type]}>{m.type.replace('_', ' ')}</Badge></td>
                        <td className={cn(tdCls, 'text-right font-medium tabular-nums', m.qtyGrams >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                          {m.qtyGrams >= 0 ? '+' : '−'}{formatKg(Math.abs(m.qtyGrams))}
                        </td>
                        <td className={`${tdCls} text-right tabular-nums`}>{formatKg(m.balanceAfterGrams)}</td>
                        <td className={`${tdCls} text-xs text-slate-500`}>
                          {m.billNumber && <span className="mr-1 font-medium text-slate-700">{m.billNumber}</span>}
                          {m.note}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : products.length === 0 ? (
          <EmptyState title="No products" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={thCls}>Product</th>
                  <th className={`${thCls} text-right`}>Stock (kg)</th>
                  <th className={`${thCls} text-right`}>Rate / kg</th>
                  <th className={`${thCls} text-right`}>Value at rate</th>
                  <th className={`${thCls} text-right`}>Value at cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((p) => (
                  <tr key={p.id} className={p.isActive ? '' : 'text-slate-400'}>
                    <td className={tdCls}>{p.name}{!p.isActive && ' (inactive)'}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatKg(p.stockGrams)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{p.currentRate ? formatINR(p.currentRate) : '—'}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{formatINR((p.stockGrams / 1000) * p.currentRate)}</td>
                    <td className={`${tdCls} text-right tabular-nums`}>{p.purchaseRate ? formatINR((p.stockGrams / 1000) * p.purchaseRate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <tr>
                  <td className={tdCls}>Total</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{formatKg(products.reduce((s, p) => s + p.stockGrams, 0))}</td>
                  <td />
                  <td className={`${tdCls} text-right tabular-nums`}>{formatINR(products.reduce((s, p) => s + (p.stockGrams / 1000) * p.currentRate, 0))}</td>
                  <td className={`${tdCls} text-right tabular-nums`}>{formatINR(products.reduce((s, p) => s + (p.stockGrams / 1000) * (p.purchaseRate || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
