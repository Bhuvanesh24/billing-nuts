import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowDownToLine, Boxes, FilePlus2, IndianRupee, Receipt, Scale, Tags } from 'lucide-react'
import { Badge, cardCls, EmptyState, LoadingBlock } from '../components/ui'
import { listProducts } from '../services/masterService'
import { listBills, listRecentBills } from '../services/billService'
import { getRatesForDate } from '../services/rateService'
import { formatINR, formatKg, round2 } from '../lib/calculator'
import { formatDisplayDate, todayISO } from '../lib/date'
import { errorMessage } from '../lib/utils'
import type { Bill, PaymentMode, Product } from '../types'

interface DashboardData {
  products: Product[]
  todayBills: Bill[]
  recent: Bill[]
  missingRate: Product[]
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const today = todayISO()
        const [products, todayBills, recent, todayRates] = await Promise.all([
          listProducts({ activeOnly: true }),
          listBills(today, today),
          listRecentBills(6),
          getRatesForDate(today),
        ])
        if (cancelled) return
        setData({ products, todayBills, recent, missingRate: products.filter((p) => !todayRates.has(p.id)) })
      } catch (e) {
        toast.error(errorMessage(e, 'Failed to load dashboard'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!data) return <LoadingBlock />

  const active = data.todayBills.filter((b) => b.status === 'active')
  const salesTotal = round2(active.reduce((s, b) => s + b.grandTotal, 0))
  const gramsSold = active.reduce((s, b) => s + b.items.reduce((x, i) => x + i.qtyGrams, 0), 0)
  const byMode = (m: PaymentMode) => round2(active.filter((b) => b.paymentMode === m).reduce((s, b) => s + b.grandTotal, 0))
  const stockValue = round2(data.products.reduce((s, p) => s + (p.stockGrams / 1000) * p.currentRate, 0))
  const stockGrams = data.products.reduce((s, p) => s + p.stockGrams, 0)
  const lowStock = data.products.filter((p) => p.stockGrams <= p.lowStockThresholdGrams).sort((a, b) => a.stockGrams - b.stockGrams)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <QuickLink to="/bills/new" icon={<FilePlus2 className="h-4 w-4" />} primary>New Bill</QuickLink>
        <QuickLink to="/rates" icon={<Tags className="h-4 w-4" />}>Set Today's Rates</QuickLink>
        <QuickLink to="/inventory" icon={<ArrowDownToLine className="h-4 w-4" />}>Stock In</QuickLink>
      </div>

      {data.missingRate.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <b>No rate set today</b> for {data.missingRate.length} product(s):{' '}
              {data.missingRate.slice(0, 6).map((p) => p.name).join(', ')}
              {data.missingRate.length > 6 ? '…' : ''}
            </div>
          </div>
          <Link to="/rates" className="shrink-0 text-sm font-medium text-amber-900 underline">Set rates</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<IndianRupee className="h-5 w-5" />} label="Today's sales" value={formatINR(salesTotal)} sub={`Cash ${formatINR(byMode('cash'))} · UPI ${formatINR(byMode('upi'))} · Card ${formatINR(byMode('card'))}`} />
        <StatCard icon={<Receipt className="h-5 w-5" />} label="Bills today" value={String(active.length)} sub={`${data.todayBills.length - active.length} cancelled`} />
        <StatCard icon={<Scale className="h-5 w-5" />} label="Sold today" value={`${formatKg(gramsSold)} kg`} />
        <StatCard icon={<Boxes className="h-5 w-5" />} label="Stock value" value={formatINR(stockValue)} sub={`${formatKg(stockGrams)} kg at today's rates`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className={`${cardCls} lg:col-span-3`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent bills</h3>
            <Link to="/bills" className="text-xs font-medium text-blue-600 hover:underline">View all</Link>
          </div>
          {data.recent.length === 0 ? (
            <EmptyState title="No bills yet" subtitle="Create your first bill to see it here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      <span className="text-blue-700">{b.billNumber}</span> · {b.customerSnapshot.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDisplayDate(b.billDate)} · {b.items.length} item(s) · {b.paymentMode.toUpperCase()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {b.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
                    {b.pdfStatus === 'pending' && b.status === 'active' && <Badge tone="amber">PDF pending</Badge>}
                    <span className="text-sm font-semibold tabular-nums">{formatINR(b.grandTotal)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${cardCls} lg:col-span-2`}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Low stock</h3>
            <Link to="/inventory" className="text-xs font-medium text-blue-600 hover:underline">Inventory</Link>
          </div>
          {lowStock.length === 0 ? (
            <EmptyState title="All stocked up" subtitle="No product is below its alert level." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStock.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-slate-900">{p.name}</span>
                  <span className={`text-sm font-semibold tabular-nums ${p.stockGrams === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {formatKg(p.stockGrams)} kg
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-center gap-2 text-slate-500">
        <span className="rounded-lg bg-blue-50 p-1.5 text-blue-600">{icon}</span>
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

function QuickLink({ to, icon, children, primary }: { to: string; icon: ReactNode; children: ReactNode; primary?: boolean }) {
  return (
    <Link
      to={to}
      className={
        primary
          ? 'inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700'
          : 'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50'
      }
    >
      {icon}
      {children}
    </Link>
  )
}
