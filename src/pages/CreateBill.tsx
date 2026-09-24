import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, Download, ExternalLink, Eye, FilePlus2, Lock, Plus, Save, Trash2, TriangleAlert } from 'lucide-react'
import { btnPrimary, btnSecondary, cardCls, Field, inputCls, LoadingBlock, Spinner } from '../components/ui'
import { listProducts } from '../services/masterService'
import { createBill, editBill, getBill, ratesOnBill } from '../services/billService'
import { peekNextInvoiceNumber } from '../services/firestore'
import type { InvoiceData } from '../services/pdfGeneration'
import { syncBillPdf } from '../services/billPdf'
import { useDrive } from '../services/useDrive'
import { computeTotals, formatINR, formatKg, formatQty, gramsToKg, lineAmount, parseQtyInput, round2 } from '../lib/calculator'
import { formatDisplayDate, todayISO } from '../lib/date'
import { cn, errorMessage } from '../lib/utils'
import { QUICK_QTYS } from '../config/business'
import type { Bill, BillDraft, BillItem, CustomerSnapshot, PaymentMode, Product } from '../types'

interface Row {
  key: number
  productId: string
  qty: string
  /** Rate/kg — set automatically (today's daily rate, or the rate already on the bill). Not editable. */
  rate: number
}

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
]

const emptyCustomer: CustomerSnapshot = { name: '', phone: '', address: '', gstNo: '' }
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/

let rowKey = 0
const newRow = (): Row => ({ key: ++rowKey, productId: '', qty: '', rate: 0 })

interface SavedInfo {
  bill: Bill
  pdfUrl: string | null
  fileName: string
  driveLink: string
  uploaded: boolean
}

export default function CreateBill() {
  const { id: editId } = useParams<{ id: string }>()
  const isEdit = !!editId
  const navigate = useNavigate()
  const drive = useDrive()

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [original, setOriginal] = useState<Bill | null>(null)
  const [billNumber, setBillNumber] = useState('')

  const [billDate, setBillDate] = useState(todayISO())
  const [customer, setCustomer] = useState<CustomerSnapshot>(emptyCustomer)
  const [rows, setRows] = useState<Row[]>([newRow()])
  const [discount, setDiscount] = useState('')
  const [gstInput, setGstInput] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash')

  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [previewing, setPreviewing] = useState(false)
  const [saved, setSaved] = useState<SavedInfo | null>(null)


  const resetForm = useCallback(() => {
    setBillDate(todayISO())
    setCustomer(emptyCustomer)
    setRows([newRow()])
    setDiscount('')
    setGstInput('')
    setPaymentMode('cash')
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const prods = await listProducts()
      setProducts(prods)
      if (editId) {
        const bill = await getBill(editId)
        if (!bill) {
          toast.error('Bill not found')
          navigate('/bills', { replace: true })
          return
        }
        setOriginal(bill)
        setBillNumber(bill.billNumber)
        setBillDate(bill.billDate)
        setCustomer(bill.customerSnapshot)
        setRows(bill.items.map((it) => ({ key: ++rowKey, productId: it.productId, qty: String(gramsToKg(it.qtyGrams)), rate: it.ratePerKg })))
        setDiscount(bill.discount ? String(bill.discount) : '')
        setGstInput(bill.gstAmount ? String(bill.gstAmount) : '')
        // Old bills may carry a mode that no longer exists (e.g. credit) — fall back to cash.
        setPaymentMode(PAYMENT_MODES.some((m) => m.value === bill.paymentMode) ? bill.paymentMode : 'cash')
      } else {
        setBillNumber(await peekNextInvoiceNumber())
      }
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [editId, navigate])

  useEffect(() => {
    load()
  }, [load])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  // Quantity this bill already holds per product (edit mode) — it is "available" to this bill.
  const heldByBill = useMemo(() => {
    const m = new Map<string, number>()
    if (original) for (const it of original.items) m.set(it.productId, (m.get(it.productId) ?? 0) + it.qtyGrams)
    return m
  }, [original])

  // Editing keeps the rate each product was billed at; everything else uses today's daily rate.
  const lockedRates = useMemo(() => (original ? ratesOnBill(original.items) : new Map<string, number>()), [original])
  const rateFor = useCallback(
    (productId: string) => lockedRates.get(productId) ?? productById.get(productId)?.currentRate ?? 0,
    [lockedRates, productById],
  )

  const availableFor = useCallback(
    (productId: string) => (productById.get(productId)?.stockGrams ?? 0) + (heldByBill.get(productId) ?? 0),
    [productById, heldByBill],
  )

  // Per-row computed values + stock check across rows of the same product.
  const computed = useMemo(() => {
    const usedByProduct = new Map<string, number>()
    for (const r of rows) {
      const g = parseQtyInput(r.qty)
      if (r.productId && g) usedByProduct.set(r.productId, (usedByProduct.get(r.productId) ?? 0) + g)
    }
    return rows.map((r) => {
      const product = productById.get(r.productId)
      const grams = parseQtyInput(r.qty)
      const rate = r.rate
      const amount = grams && rate > 0 ? lineAmount(grams, rate) : 0
      const available = r.productId ? availableFor(r.productId) : 0
      const used = r.productId ? usedByProduct.get(r.productId) ?? 0 : 0
      let error = ''
      if (r.productId && r.qty && grams === null) error = 'Invalid quantity'
      else if (product && grams && used > available) error = `Only ${formatKg(available)} kg of ${product.name} in stock`
      else if (product && !(rate > 0)) error = `No rate set today for ${product.name}. Set it on Daily Rates first.`
      return { row: r, product, grams, rate, amount, available, error }
    })
  }, [rows, productById, availableFor])

  const filledLines = computed.filter((c) => c.product && c.grams && c.rate > 0)
  const discountValue = Number(discount) || 0
  const gstValue = Number(gstInput) || 0
  const totals = useMemo(() => computeTotals(filledLines, discountValue, gstValue), [filledLines, discountValue, gstValue])
  const hasErrors = computed.some((c) => c.error)
  const incompleteRow = computed.some((c) => (c.row.productId || c.row.qty) && !(c.product && c.grams && c.rate > 0))

  const updateRow = (key: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const selectProduct = (key: number, productId: string) => {
    updateRow(key, { productId, rate: productId ? rateFor(productId) : 0 })
  }

  const removeRow = (key: number) => setRows((prev) => (prev.length === 1 ? [newRow()] : prev.filter((r) => r.key !== key)))

  const buildItems = (): BillItem[] =>
    filledLines.map((c) => ({
      productId: c.product!.id,
      productName: c.product!.name,
      hsnCode: c.product!.hsnCode,
      gstRate: c.product!.gstRate,
      qtyGrams: c.grams!,
      ratePerKg: round2(c.rate),
      amount: c.amount,
    }))

  const buildDraft = (): BillDraft => ({
    billDate,
    customerSnapshot: {
      name: customer.name.trim(),
      phone: customer.phone.trim(),
      address: customer.address.trim(),
      gstNo: customer.gstNo.trim().toUpperCase(),
    },
    items: buildItems(),
    discount: discountValue,
    gstAmount: gstValue,
    paymentMode,
  })

  const validate = (): string | null => {
    if (!customer.name.trim()) return 'Enter the customer name'
    const gst = customer.gstNo.trim().toUpperCase()
    if (gst && !GSTIN_RE.test(gst)) return 'GSTIN must be 15 characters, e.g. 33ABCDE1234F1Z5'
    const phoneDigits = customer.phone.replace(/\D/g, '')
    if (customer.phone.trim() && (phoneDigits.length < 10 || phoneDigits.length > 12)) return 'Enter a valid phone number'
    if (filledLines.length === 0) return 'Add at least one item with quantity and rate'
    if (incompleteRow) return 'Complete or remove the unfinished item rows'
    const firstError = computed.find((c) => c.error)
    if (firstError) return firstError.error
    if (discount && !(Number(discount) >= 0)) return 'Enter a valid discount'
    if (gstInput && !(Number(gstInput) >= 0)) return 'Enter a valid GST amount'
    if (discountValue > totals.subtotal) return 'Discount cannot be more than the subtotal'
    return null
  }

  const handlePreview = async () => {
    const err = validate()
    if (err) return toast.error(err)
    const win = window.open('', '_blank') // open synchronously so popup blockers allow it
    setPreviewing(true)
    try {
      const draft = buildDraft()
      const data: InvoiceData = {
        billNumber: billNumber || 'PREVIEW',
        billDate: draft.billDate,
        customerSnapshot: draft.customerSnapshot,
        items: draft.items,
        paymentMode,
        ...totals,
      }
      const { generateInvoicePDF } = await import('../services/pdfGeneration')
      const { blob } = await generateInvoicePDF(data)
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } catch (e) {
      win?.close()
      toast.error(errorMessage(e, 'Could not build preview'))
    } finally {
      setPreviewing(false)
    }
  }

  const handleSave = async (e?: FormEvent) => {
    e?.preventDefault()
    if (savingRef.current) return // never double-submit: it would deduct stock twice
    const err = validate()
    if (err) return toast.error(err)

    savingRef.current = true
    setSaving(true)
    try {
      // 1) Transaction: number + stock + ledger + bill (all or nothing)
      const draft = buildDraft()
      let bill: Bill
      try {
        bill = isEdit && editId ? await editBill(editId, draft) : await createBill(draft)
      } catch (err2) {
        toast.error(errorMessage(err2, 'Could not save the bill'))
        return
      }
      toast.success(`Bill ${bill.billNumber} ${isEdit ? 'updated' : 'saved'}. Stock updated.`)

      // 2) PDF + Drive. A failure here never rolls back stock.
      const pdf = await syncBillPdf(bill, drive)
      if (pdf.ok) toast.success('PDF saved to Google Drive')
      else toast.error(`Bill saved, but the PDF upload failed. Use "Retry upload" on the Bills page. (${pdf.error})`, { duration: 7000 })

      if (isEdit) {
        navigate('/bills')
        return
      }
      setSaved({
        bill,
        pdfUrl: pdf.blob ? URL.createObjectURL(pdf.blob) : null,
        fileName: pdf.fileName,
        driveLink: pdf.driveLink,
        uploaded: pdf.ok,
      })
      resetForm()
      const [prods, next] = await Promise.all([listProducts(), peekNextInvoiceNumber()])
      setProducts(prods)
      setBillNumber(next)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loading) return <LoadingBlock />

  if (original?.status === 'cancelled') {
    return (
      <div className={`${cardCls} p-8 text-center`}>
        <p className="font-medium text-slate-900">Bill {original.billNumber} is cancelled and cannot be edited.</p>
        <Link to="/bills" className="mt-3 inline-block text-sm text-blue-600 hover:underline">Back to bills</Link>
      </div>
    )
  }

  const activeProducts = products.filter((p) => p.isActive || rows.some((r) => r.productId === p.id))

  return (
    <>
    <form onSubmit={handleSave} className="mx-auto max-w-5xl space-y-4 pb-24 lg:pb-0">
      {saved && (
        <div className={cn('flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between', saved.uploaded ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex items-start gap-2">
            {saved.uploaded ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-600" />}
            <div>
              <p className="font-medium text-slate-900">
                Bill {saved.bill.billNumber} saved: {formatINR(saved.bill.grandTotal)} for {saved.bill.customerSnapshot.name}
              </p>
              <p className="text-sm text-slate-600">{saved.uploaded ? 'PDF is in Google Drive.' : 'PDF upload is pending. Retry from the Bills page.'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {saved.pdfUrl && (
              <a className={btnSecondary} href={saved.pdfUrl} download={saved.fileName}>
                <Download className="h-4 w-4" /> Download
              </a>
            )}
            {saved.uploaded && saved.driveLink && (
              <a className={btnSecondary} href={saved.driveLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> View PDF
              </a>
            )}
            <button type="button" className={btnSecondary} onClick={() => setSaved(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`${cardCls} grid grid-cols-2 gap-4 p-4`}>
        <div>
          <p className="text-xs font-medium text-slate-500">{isEdit ? 'Editing bill' : 'Next bill no.'}</p>
          <p className="text-xl font-semibold text-blue-700">{billNumber}</p>
        </div>
        <Field label="Bill date">
          <input type="date" className={inputCls} value={billDate} max={todayISO()} onChange={(e) => e.target.value && setBillDate(e.target.value)} />
        </Field>
      </div>

      {/* Customer */}
      <div className={`${cardCls} p-4`}>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Customer</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name *">
            <input className={inputCls} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Customer name" autoComplete="off" />
          </Field>
          <Field label="Phone">
            <input className={inputCls} type="tel" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="10-digit mobile" autoComplete="off" />
          </Field>
          <Field label="GSTIN">
            <input className={cn(inputCls, 'uppercase')} value={customer.gstNo} maxLength={15} onChange={(e) => setCustomer({ ...customer, gstNo: e.target.value.toUpperCase() })} placeholder="Optional" autoComplete="off" />
          </Field>
          <Field label="Address">
            <input className={inputCls} value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Optional" autoComplete="off" />
          </Field>
        </div>
      </div>

      {/* Items */}
      <div className={cardCls}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Items</h3>
          <span className="text-xs text-slate-500">Rates come from Daily Rates · Qty: 0.5, 1/2, ½ or 250g</span>
        </div>
        {/* Column headings (desktop) — same grid as the rows so everything lines up */}
        <div className="hidden grid-cols-12 gap-x-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase md:grid">
          <span className="col-span-5 pl-7">Product</span>
          <span className="col-span-3">Quantity (kg)</span>
          <span className="col-span-2 text-right">Rate / kg</span>
          <span className="col-span-2 pr-11 text-right">Amount</span>
        </div>
        <div className="divide-y divide-slate-100">
          {computed.map(({ row, product, grams, rate, amount, available, error }, idx) => (
            <div key={row.key} className="grid grid-cols-12 items-start gap-x-3 gap-y-2 px-4 py-3">
              {/* Product */}
              <div className="order-1 col-span-10 flex items-center gap-2 md:col-span-5">
                <span className="w-5 shrink-0 text-center text-xs text-slate-400">{idx + 1}</span>
                <select className={cn(inputCls, 'h-10', !row.productId && 'text-slate-400')} value={row.productId} onChange={(e) => selectProduct(row.key, e.target.value)}>
                  <option value="">Select product…</option>
                  {activeProducts.map((p) => {
                    const r = rateFor(p.id)
                    const outOfStock = availableFor(p.id) <= 0
                    return (
                      <option key={p.id} value={p.id} disabled={p.id !== row.productId && (outOfStock || !(r > 0))}>
                        {p.name}: {formatKg(availableFor(p.id))} kg · {r > 0 ? `₹${r}/kg` : 'no rate today'}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Delete — top-right on mobile */}
              <div className="order-2 col-span-2 flex h-10 items-center justify-end md:hidden">
                <DeleteRowButton onClick={() => removeRow(row.key)} />
              </div>

              {/* Quantity — the only editable field */}
              <div className="order-3 col-span-5 md:order-2 md:col-span-3">
                <span className="mb-1 block text-xs text-slate-500 md:hidden">Quantity (kg)</span>
                <input
                  className={cn(inputCls, 'h-10', error && 'border-red-300 focus:border-red-400 focus:ring-red-100')}
                  placeholder="e.g. 1/2 or 0.5"
                  inputMode="decimal"
                  value={row.qty}
                  onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                />
                <div className="mt-1.5 flex items-center gap-1">
                  {QUICK_QTYS.map((q) => (
                    <button
                      key={q.grams}
                      type="button"
                      onClick={() => updateRow(row.key, { qty: String(gramsToKg(q.grams)) })}
                      className={cn('rounded-md border px-1.5 py-0.5 text-xs', grams === q.grams ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                    >
                      {q.label}
                    </button>
                  ))}
                  {grams ? <span className="ml-auto text-xs text-slate-500">{formatQty(grams)}</span> : null}
                </div>
              </div>

              {/* Rate — read-only, comes from Daily Rates */}
              <div className="order-4 col-span-3 md:order-3 md:col-span-2">
                <span className="mb-1 block text-xs text-slate-500 md:hidden">Rate / kg</span>
                <div
                  className="flex h-10 items-center justify-end gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 tabular-nums"
                  title={lockedRates.has(row.productId) ? 'Rate this item was billed at' : "Today's rate from Daily Rates"}
                >
                  <Lock className="h-3 w-3 shrink-0 text-slate-400" />
                  {rate > 0 ? formatINR(rate) : <span className="text-slate-400">—</span>}
                </div>
              </div>

              {/* Amount (+ delete on desktop) */}
              <div className="order-5 col-span-4 md:order-4 md:col-span-2">
                <span className="mb-1 block text-right text-xs text-slate-500 md:hidden">Amount</span>
                <div className="flex h-10 items-center justify-end gap-2">
                  <span className="font-semibold text-slate-900 tabular-nums">{formatINR(amount)}</span>
                  <span className="hidden md:block">
                    <DeleteRowButton onClick={() => removeRow(row.key)} />
                  </span>
                </div>
              </div>

              {(error || product) && (
                <div className="order-6 col-span-12 text-xs md:pl-7">
                  {error ? (
                    <span className="text-red-600">{error}</span>
                  ) : (
                    <span className="text-slate-400">
                      Available: {formatKg(available)} kg · GST {product!.gstRate}% · HSN {product!.hsnCode}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-100 p-3">
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50" onClick={() => setRows((prev) => [...prev, newRow()])}>
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {/* Payment + totals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${cardCls} space-y-4 p-4`}>
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Payment mode</span>
            <Segmented options={PAYMENT_MODES} value={paymentMode} onChange={setPaymentMode} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount (₹)" hint="Subtracted from the total">
              <MoneyInput value={discount} onChange={setDiscount} />
            </Field>
            <Field label="GST (₹)" hint="Added to the total">
              <MoneyInput value={gstInput} onChange={setGstInput} />
            </Field>
          </div>
        </div>

        <div className={`${cardCls} p-4`}>
          <dl className="space-y-2 text-sm">
            <TotalRow label="Subtotal" value={formatINR(totals.subtotal)} />
            <TotalRow label="Discount" value={`− ${formatINR(totals.discount)}`} />
            <TotalRow label="GST" value={`+ ${formatINR(totals.gstAmount)}`} />
            <div className="flex items-center justify-between border-t border-slate-200 pt-3">
              <dt className="text-base font-semibold text-slate-900">Grand Total</dt>
              <dd className="text-2xl font-bold text-blue-700 tabular-nums">{formatINR(totals.grandTotal)}</dd>
            </div>
          </dl>
          <p className="mt-1 text-right text-xs text-slate-400">{formatDisplayDate(billDate)} · {filledLines.length} item(s)</p>
        </div>
      </div>

      {/* Actions — sticky on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t border-slate-200 bg-white p-3 lg:static lg:justify-end lg:border-0 lg:bg-transparent lg:p-0">
        {isEdit && (
          <Link to="/bills" className={`${btnSecondary} flex-1 lg:flex-none`}>Cancel</Link>
        )}
        <button type="button" className={`${btnSecondary} flex-1 lg:flex-none`} onClick={handlePreview} disabled={previewing || saving}>
          {previewing ? <Spinner /> : <Eye className="h-4 w-4" />} Preview PDF
        </button>
        <button type="submit" className={`${btnPrimary} flex-[2] lg:flex-none`} disabled={saving || hasErrors || filledLines.length === 0}>
          {saving ? <Spinner /> : isEdit ? <Save className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />}
          {saving ? 'Saving…' : isEdit ? 'Update & Replace PDF' : 'Save & Generate PDF'}
        </button>
      </div>
    </form>
    </>
  )
}

function DeleteRowButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600" title="Remove item">
      <Trash2 className="h-4 w-4" />
    </button>
  )
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">₹</span>
      <input
        className={cn(inputCls, 'h-10 pl-7 text-right tabular-nums')}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900 tabular-nums">{value}</dd>
    </div>
  )
}

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-md px-2 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
