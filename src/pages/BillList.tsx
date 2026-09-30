import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Ban, CloudUpload, Download, ExternalLink, FilePlus2, HandCoins, Pencil, Search } from 'lucide-react'
import Modal from '../components/Modal'
import Pagination from '../components/Pagination'
import { Badge, btnDanger, btnPrimary, btnSecondary, cardCls, EmptyState, Field, iconBtn, inputCls, LoadingBlock, PageHeader, Spinner, tdCls, thCls } from '../components/ui'
import { cancelBill, listBills, listOutstandingBills, recordPayment } from '../services/billService'
import { syncBillPdf } from '../services/billPdf'
import { useDrive } from '../services/useDrive'
import { formatINR, formatKg, round2 } from '../lib/calculator'
import { addDaysISO, formatDisplayDate, todayISO } from '../lib/date'
import { cn, errorMessage } from '../lib/utils'
import type { Bill, ReceiptMode } from '../types'

const PAGE_SIZE = 15
type StatusFilter = 'all' | 'active' | 'cancelled' | 'pending' | 'outstanding'

const RECEIPT_MODES: { value: ReceiptMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
]

function monthStartISO(): string {
  return `${todayISO().slice(0, 8)}01`
}

export default function BillList() {
  const drive = useDrive()
  const [from, setFrom] = useState(monthStartISO())
  const [to, setTo] = useState(todayISO())
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<StatusFilter>(searchParams.get('view') === 'outstanding' ? 'outstanding' : 'all')
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Bill | null>(null)
  const [payFor, setPayFor] = useState<Bill | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', mode: 'cash' as ReceiptMode, date: todayISO(), note: '' })

  // The Outstanding view ignores the date range: it lists every bill with money due.
  const outstandingView = status === 'outstanding'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBills(outstandingView ? await listOutstandingBills() : await listBills(from, to))
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load bills'))
    } finally {
      setLoading(false)
    }
  }, [from, to, outstandingView])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => setPage(1), [search, status, from, to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '')
    return bills.filter((b) => {
      if (status === 'active' && b.status !== 'active') return false
      if (status === 'cancelled' && b.status !== 'cancelled') return false
      if (status === 'pending' && !(b.pdfStatus === 'pending')) return false
      if (status === 'outstanding' && !(b.status === 'active' && b.balanceDue > 0)) return false
      if (!q) return true
      return (
        b.billNumber.toLowerCase().replace(/^#0*/, '').includes(q.replace(/^0+/, '')) ||
        b.customerSnapshot.name.toLowerCase().includes(q) ||
        b.customerSnapshot.phone.includes(q)
      )
    })
  }, [bills, search, status])

  const totals = useMemo(() => {
    const active = filtered.filter((b) => b.status === 'active')
    return {
      count: active.length,
      grandTotal: round2(active.reduce((s, b) => s + b.grandTotal, 0)),
      gst: round2(active.reduce((s, b) => s + b.gstAmount, 0)),
      outstanding: round2(active.reduce((s, b) => s + b.balanceDue, 0)),
      grams: active.reduce((s, b) => s + b.items.reduce((x, i) => x + i.qtyGrams, 0), 0),
    }
  }, [filtered])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const pendingCount = bills.filter((b) => b.pdfStatus === 'pending').length

  const replaceBill = (updated: Bill) => setBills((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))

  const retryUpload = async (bill: Bill) => {
    setBusyId(bill.id)
    try {
      const res = await syncBillPdf(bill, drive)
      if (res.ok) {
        replaceBill({ ...bill, pdfStatus: 'uploaded', driveFileId: res.driveFileId, driveLink: res.driveLink })
        toast.success(`PDF for ${bill.billNumber} uploaded`)
      } else {
        toast.error(`Upload failed: ${res.error}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  const download = async (bill: Bill) => {
    setBusyId(bill.id)
    try {
      const { generateInvoicePDF } = await import('../services/pdfGeneration')
      const { blob, fileName } = await generateInvoicePDF(bill)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      toast.error(errorMessage(e, 'Could not build PDF'))
    } finally {
      setBusyId(null)
    }
  }

  const doCancel = async () => {
    const bill = confirmCancel
    if (!bill || busyId) return
    setBusyId(bill.id)
    try {
      const { changed, bill: updated } = await cancelBill(bill.id)
      setConfirmCancel(null)
      if (!changed) {
        toast('Bill was already cancelled')
        replaceBill(updated)
        return
      }
      toast.success(`Bill ${bill.billNumber} cancelled. Stock restored.`)
      // Stamp the Drive copy as CANCELLED (best effort).
      const res = await syncBillPdf(updated, drive)
      replaceBill(res.ok ? { ...updated, pdfStatus: 'uploaded', driveFileId: res.driveFileId, driveLink: res.driveLink } : { ...updated, pdfStatus: 'pending' })
      if (!res.ok) toast.error('Could not update the PDF in Drive. Use Retry upload.')
    } catch (e) {
      toast.error(errorMessage(e, 'Cancel failed'))
    } finally {
      setBusyId(null)
    }
  }

  const openPayment = (b: Bill) => {
    setPayForm({ amount: String(b.balanceDue), mode: 'cash', date: todayISO(), note: '' })
    setPayFor(b)
  }

  const doPayment = async () => {
    const bill = payFor
    if (!bill || busyId) return
    const amount = Number(payForm.amount)
    if (!(amount > 0)) return toast.error('Enter the amount received')
    if (round2(amount) > bill.balanceDue) return toast.error(`Only ${formatINR(bill.balanceDue)} is outstanding`)
    setBusyId(bill.id)
    try {
      const updated = await recordPayment(bill.id, { amount, mode: payForm.mode, date: payForm.date, note: payForm.note })
      setPayFor(null)
      toast.success(
        updated.balanceDue > 0
          ? `${formatINR(amount)} received. ${formatINR(updated.balanceDue)} still outstanding.`
          : `${formatINR(amount)} received. Bill ${bill.billNumber} is fully paid.`,
      )
      // Refresh the Drive PDF so it shows the new paid / outstanding amounts (best effort).
      const res = await syncBillPdf(updated, drive)
      replaceBill(res.ok ? { ...updated, pdfStatus: 'uploaded', driveFileId: res.driveFileId, driveLink: res.driveLink } : updated)
      if (!res.ok) toast.error('Payment saved, but the PDF in Drive was not updated. Use Retry upload.')
    } catch (e) {
      toast.error(errorMessage(e, 'Could not record the payment'))
    } finally {
      setBusyId(null)
    }
  }

  const actions = (b: Bill) => {
    const busy = busyId === b.id
    return (
      <div className="flex items-center justify-end gap-0.5">
        {busy && <Spinner className="mr-1 text-slate-400" />}
        {b.pdfStatus === 'pending' && (
          <button className={cn(iconBtn, 'text-amber-600')} onClick={() => retryUpload(b)} disabled={!!busyId} title="Retry upload">
            <CloudUpload className="h-4 w-4" />
          </button>
        )}
        {b.driveFileId && (
          <a className={iconBtn} href={`https://drive.google.com/file/d/${b.driveFileId}/view`} target="_blank" rel="noreferrer" title="View PDF">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <button className={iconBtn} onClick={() => download(b)} disabled={!!busyId} title="Download PDF">
          <Download className="h-4 w-4" />
        </button>
        {b.status === 'active' && b.balanceDue > 0 && (
          <button className={cn(iconBtn, 'text-amber-600 hover:text-amber-700')} onClick={() => openPayment(b)} disabled={!!busyId} title="Receive payment">
            <HandCoins className="h-4 w-4" />
          </button>
        )}
        {b.status === 'active' && (
          <>
            <Link className={iconBtn} to={`/bills/edit/${b.id}`} title="Edit">
              <Pencil className="h-4 w-4" />
            </Link>
            <button className={cn(iconBtn, 'hover:text-red-600')} onClick={() => setConfirmCancel(b)} disabled={!!busyId} title="Cancel bill">
              <Ban className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    )
  }

  const statusBadges = (b: Bill) => (
    <span className="inline-flex flex-wrap gap-1">
      {b.status === 'cancelled' ? (
        <Badge tone="red">Cancelled</Badge>
      ) : b.balanceDue > 0 ? (
        <Badge tone="amber">Due {formatINR(b.balanceDue)}</Badge>
      ) : (
        <Badge tone="green">Paid</Badge>
      )}
      {b.pdfStatus === 'pending' && <Badge tone="amber">PDF pending</Badge>}
    </span>
  )

  return (
    <div>
      <PageHeader
        title="Bills"
        actions={
          <Link to="/bills/new" className={btnPrimary}>
            <FilePlus2 className="h-4 w-4" /> New Bill
          </Link>
        }
      />

      {status === 'outstanding' && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            Showing every credit bill with money due (all dates): <b>{formatINR(totals.outstanding)}</b> outstanding.
          </span>
          <button className="font-medium underline" onClick={() => setStatus('all')}>Show all bills</button>
        </div>
      )}

      {pendingCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>{pendingCount} bill(s) have a PDF waiting to upload.</span>
          <button className="font-medium underline" onClick={() => setStatus('pending')}>Show</button>
        </div>
      )}

      <div className={cardCls}>
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 p-4 md:grid-cols-5">
          <div className="relative col-span-2">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} pl-9`} placeholder="Bill no., customer or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <input type="date" className={inputCls} value={from} max={to} disabled={status === 'outstanding'} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <input type="date" className={inputCls} value={to} min={from} max={todayISO()} disabled={status === 'outstanding'} onChange={(e) => e.target.value && setTo(e.target.value)} />
          <select className={`${inputCls} col-span-2 md:col-span-1`} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">All bills</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="outstanding">Outstanding (credit)</option>
            <option value="pending">PDF pending</option>
          </select>
          <div className="col-span-2 flex flex-wrap gap-1 md:col-span-5">
            {[
              ['Today', todayISO(), todayISO()],
              ['Yesterday', addDaysISO(todayISO(), -1), addDaysISO(todayISO(), -1)],
              ['Last 7 days', addDaysISO(todayISO(), -6), todayISO()],
              ['This month', monthStartISO(), todayISO()],
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

        {loading ? (
          <LoadingBlock />
        ) : filtered.length === 0 ? (
          <EmptyState title="No bills found" subtitle="Try a different date range or filter." />
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {pageRows.map((b) => (
                <li key={b.id} className={cn('p-4', b.status === 'cancelled' && 'opacity-60')}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-blue-700">{b.billNumber}</p>
                      <p className="text-sm font-medium text-slate-900">{b.customerSnapshot.name}</p>
                      <p className="text-xs text-slate-500">{formatDisplayDate(b.billDate)} · {b.items.length} item(s) · {b.paymentMode.toUpperCase()}</p>
                    </div>
                    <p className={cn('text-lg font-semibold tabular-nums', b.status === 'cancelled' && 'line-through')}>{formatINR(b.grandTotal)}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    {statusBadges(b)}
                    {actions(b)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={thCls}>Bill No</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Customer</th>
                    <th className={`${thCls} text-right`}>Qty (kg)</th>
                    <th className={thCls}>Mode</th>
                    <th className={`${thCls} text-right`}>Total</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((b) => (
                    <tr key={b.id} className={cn('hover:bg-slate-50/60', b.status === 'cancelled' && 'text-slate-400')}>
                      <td className={`${tdCls} font-semibold text-blue-700`}>{b.billNumber}</td>
                      <td className={`${tdCls} whitespace-nowrap`}>{formatDisplayDate(b.billDate)}</td>
                      <td className={tdCls}>
                        <p className="font-medium text-slate-900">{b.customerSnapshot.name}</p>
                        {b.customerSnapshot.phone && <p className="text-xs text-slate-500">{b.customerSnapshot.phone}</p>}
                      </td>
                      <td className={`${tdCls} text-right tabular-nums`}>{formatKg(b.items.reduce((s, i) => s + i.qtyGrams, 0))}</td>
                      <td className={`${tdCls} uppercase`}>{b.paymentMode}</td>
                      <td className={cn(tdCls, 'text-right font-semibold tabular-nums', b.status === 'cancelled' && 'line-through')}>{formatINR(b.grandTotal)}</td>
                      <td className={tdCls}>{statusBadges(b)}</td>
                      <td className={tdCls}>{actions(b)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td className={`${tdCls} font-semibold`} colSpan={3}>
                      {totals.count} active bill(s)
                    </td>
                    <td className={`${tdCls} text-right font-semibold tabular-nums`}>{formatKg(totals.grams)}</td>
                    <td />
                    <td className={`${tdCls} text-right font-bold tabular-nums`}>{formatINR(totals.grandTotal)}</td>
                    <td className={`${tdCls} text-xs`} colSpan={2}>
                      {totals.outstanding > 0 && <span className="mr-2 font-semibold text-amber-700">Due {formatINR(totals.outstanding)}</span>}
                      {totals.gst > 0 && <span className="text-slate-500">incl. GST {formatINR(totals.gst)}</span>}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile totals */}
            <div className="flex justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm md:hidden">
              <span className="font-medium">
                {totals.count} active bill(s)
                {totals.outstanding > 0 && <span className="ml-2 text-amber-700">Due {formatINR(totals.outstanding)}</span>}
              </span>
              <span className="font-bold">{formatINR(totals.grandTotal)}</span>
            </div>

            <Pagination currentPage={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </>
        )}
      </div>

      <Modal
        open={!!payFor}
        title={`Receive payment · ${payFor?.billNumber ?? ''}`}
        onClose={() => !busyId && setPayFor(null)}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setPayFor(null)} disabled={!!busyId}>Cancel</button>
            <button className={btnPrimary} onClick={doPayment} disabled={!!busyId}>
              {busyId && <Spinner />} Save payment
            </button>
          </>
        }
      >
        {payFor && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center">
              <div>
                <p className="text-xs text-slate-500">Bill total</p>
                <p className="font-semibold tabular-nums">{formatINR(payFor.grandTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Received</p>
                <p className="font-semibold text-emerald-700 tabular-nums">{formatINR(payFor.paidAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Outstanding</p>
                <p className="font-bold text-amber-700 tabular-nums">{formatINR(payFor.balanceDue)}</p>
              </div>
            </div>
            <p className="text-slate-600">
              {payFor.customerSnapshot.name}
              {payFor.customerSnapshot.phone && ` · ${payFor.customerSnapshot.phone}`} · billed {formatDisplayDate(payFor.billDate)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount received (₹)">
                <input
                  className={cn(inputCls, 'h-10 text-right tabular-nums')}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  autoFocus
                />
              </Field>
              <Field label="Date">
                <input type="date" className={cn(inputCls, 'h-10')} value={payForm.date} max={todayISO()} onChange={(e) => e.target.value && setPayForm({ ...payForm, date: e.target.value })} />
              </Field>
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Paid by</span>
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {RECEIPT_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setPayForm({ ...payForm, mode: m.value })}
                    className={cn('flex-1 rounded-md px-2 py-1.5 text-sm font-medium', payForm.mode === m.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Note">
              <input className={inputCls} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Optional" />
            </Field>
            {(() => {
              const left = round2(payFor.balanceDue - (Number(payForm.amount) || 0))
              return left >= 0 ? (
                <p className="text-slate-600">
                  After this payment: <b className={left > 0 ? 'text-amber-700' : 'text-emerald-700'}>{left > 0 ? `${formatINR(left)} outstanding` : 'fully paid'}</b>
                </p>
              ) : (
                <p className="text-red-600">That is more than the {formatINR(payFor.balanceDue)} outstanding.</p>
              )
            })()}
            {payFor.payments.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Payment history</p>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {payFor.payments.map((p, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2">
                      <span className="text-slate-600">
                        {formatDisplayDate(p.date)} · {p.mode.toUpperCase()}
                        {p.note && <span className="text-slate-400"> · {p.note}</span>}
                      </span>
                      <span className="font-medium tabular-nums">{formatINR(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmCancel}
        title={`Cancel bill ${confirmCancel?.billNumber ?? ''}?`}
        onClose={() => !busyId && setConfirmCancel(null)}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setConfirmCancel(null)} disabled={!!busyId}>Keep bill</button>
            <button className={btnDanger} onClick={doCancel} disabled={!!busyId}>
              {busyId && <Spinner />} Cancel bill
            </button>
          </>
        }
      >
        {confirmCancel && (
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              {confirmCancel.customerSnapshot.name} · {formatDisplayDate(confirmCancel.billDate)} · <b>{formatINR(confirmCancel.grandTotal)}</b>
            </p>
            <p>This stock goes back to inventory:</p>
            <ul className="rounded-lg bg-slate-50 p-3">
              {confirmCancel.items.map((i) => (
                <li key={i.productId + i.ratePerKg} className="flex justify-between">
                  <span>{i.productName}</span>
                  <span className="font-medium tabular-nums">+{formatKg(i.qtyGrams)} kg</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">The bill is kept (marked cancelled) and its bill number is not reused.</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
