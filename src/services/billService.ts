/**
 * Bills: create / edit / cancel, each inside ONE Firestore transaction that
 * reads everything first, plans the stock changes with the pure planners in
 * lib/calculator.ts, and only then writes (stock, ledger, counter, bill).
 *
 * The PDF / Drive upload happens AFTER the transaction and never rolls back stock.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { COLLECTIONS, db, reserveInvoiceNumber } from './firestore'
import { applyStockChanges, readProducts, toStockMap } from './inventoryService'
import {
  applyPayment,
  canCancel,
  computeTotals,
  creditBalance,
  lineAmount,
  mergeItems,
  planCancel,
  planEdit,
  planSale,
  round2,
  StockError,
} from '../lib/calculator'
import type { Bill, BillDraft, BillItem, Payment, PaymentMode, Product, ReceiptMode } from '../types'

const billRef = (id: string) => doc(db, COLLECTIONS.bills, id)

const PAYMENT_MODES: PaymentMode[] = ['cash', 'upi', 'card', 'credit']
const RECEIPT_MODES: ReceiptMode[] = ['cash', 'upi', 'card']

/**
 * Normalises bills written by older versions of the app:
 * - GST used to be stored as cgst/sgst/igst instead of gstAmount.
 * - Some bills have no paidAmount/balanceDue/payments (they were fully paid).
 */
function toBill(id: string, data: Omit<Bill, 'id'>): Bill {
  const legacy = data as Partial<Record<'cgst' | 'sgst' | 'igst', number>>
  const gstAmount = data.gstAmount ?? round2((legacy.cgst ?? 0) + (legacy.sgst ?? 0) + (legacy.igst ?? 0))
  const paidAmount = data.paidAmount ?? data.grandTotal
  const balanceDue = data.balanceDue ?? round2(Math.max(data.grandTotal - paidAmount, 0))
  return { id, ...data, gstAmount, paidAmount, balanceDue, payments: data.payments ?? [] }
}

function validateDraft(draft: BillDraft): void {
  if (!draft.customerSnapshot.name.trim()) throw new Error('Enter the customer name')
  if (draft.items.length === 0) throw new Error('Add at least one item')
  for (const item of draft.items) {
    if (!item.productId) throw new Error('Select a product for every row')
    if (!Number.isInteger(item.qtyGrams) || item.qtyGrams <= 0) throw new Error(`Enter a valid quantity for ${item.productName}`)
    if (!(item.ratePerKg > 0)) throw new Error(`Enter a rate for ${item.productName}`)
  }
  if (!(draft.discount >= 0)) throw new Error('Discount cannot be negative')
  if (!(draft.gstAmount >= 0)) throw new Error('GST cannot be negative')
  if (!PAYMENT_MODES.includes(draft.paymentMode)) throw new Error('Choose Cash, UPI, Card or Credit')
  if (draft.paymentMode === 'credit') {
    if (!(draft.paidNow >= 0)) throw new Error('Paid amount cannot be negative')
    if (!RECEIPT_MODES.includes(draft.paidNowMode)) throw new Error('Choose how the advance was paid')
  }
}

/** productId → rate/kg already on a bill. Used to pre-fill the rate when editing. */
export function ratesOnBill(items: BillItem[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const it of items) if (!map.has(it.productId)) map.set(it.productId, it.ratePerKg)
  return map
}

/**
 * Snapshots product name / HSN / GST from the product documents read inside the
 * transaction, merges duplicate rows, and recomputes every amount from the
 * rate entered on the bill (pre-filled from Daily Rates, editable by the user).
 */
function buildItems(items: BillItem[], products: Map<string, Product>): BillItem[] {
  const snapshotted = items.map((item) => {
    const p = products.get(item.productId)
    if (!p) throw new StockError(`Product "${item.productName}" no longer exists`)
    const ratePerKg = round2(item.ratePerKg)
    return {
      productId: item.productId,
      productName: p.name,
      hsnCode: p.hsnCode,
      gstRate: p.gstRate,
      qtyGrams: item.qtyGrams,
      ratePerKg,
      amount: lineAmount(item.qtyGrams, ratePerKg),
    }
  })
  return mergeItems(snapshotted)
}

/**
 * Works out paidAmount / balanceDue / payments.
 * - Cash/UPI/Card: fully paid.
 * - Credit, new (or switched to credit on edit): the advance typed on the form.
 * - Credit, already credit before this edit: keeps every recorded payment; the
 *   balance is recomputed against the new total.
 */
function paymentFields(draft: BillDraft, grandTotal: number, previous?: Bill) {
  if (draft.paymentMode !== 'credit') {
    return { paidAmount: grandTotal, balanceDue: 0, payments: [] as Payment[] }
  }
  let payments: Payment[]
  if (previous && previous.paymentMode === 'credit') {
    payments = previous.payments
  } else {
    const advance = round2(draft.paidNow)
    payments = advance > 0 ? [{ amount: advance, mode: draft.paidNowMode, date: draft.billDate, note: 'Paid at billing' }] : []
  }
  const paidAmount = round2(payments.reduce((s, p) => s + p.amount, 0))
  return { paidAmount, balanceDue: creditBalance(grandTotal, paidAmount), payments }
}

function billFields(draft: BillDraft, items: BillItem[], previous?: Bill) {
  const totals = computeTotals(items, draft.discount, draft.gstAmount)
  return {
    billDate: draft.billDate,
    customerSnapshot: {
      name: draft.customerSnapshot.name.trim(),
      phone: draft.customerSnapshot.phone.trim(),
      address: draft.customerSnapshot.address.trim(),
      gstNo: draft.customerSnapshot.gstNo.trim().toUpperCase(),
    },
    items,
    paymentMode: draft.paymentMode,
    ...totals,
    ...paymentFields(draft, totals.grandTotal, previous),
  }
}

/** Creates a bill: allocates the number, deducts stock, writes ledger + bill. All or nothing. */
export async function createBill(draft: BillDraft): Promise<Bill> {
  validateDraft(draft)
  const ref = doc(collection(db, COLLECTIONS.bills))

  return runTransaction(db, async (tx) => {
    // ---- reads ----
    const invoice = await reserveInvoiceNumber(tx)
    const products = await readProducts(tx, draft.items.map((i) => i.productId))

    // ---- plan (throws → nothing is written) ----
    const items = buildItems(draft.items, products)
    const changes = planSale(toStockMap(products), items)
    const fields = billFields(draft, items)

    // ---- writes ----
    invoice.commit()
    applyStockChanges(tx, changes, {
      refType: 'bill',
      refId: ref.id,
      billNumber: invoice.billNumber,
      date: draft.billDate,
      note: `Bill ${invoice.billNumber} – ${fields.customerSnapshot.name}`,
      typeFor: () => 'SALE',
    })
    const bill: Omit<Bill, 'id'> = {
      billNumber: invoice.billNumber,
      ...fields,
      status: 'active',
      pdfStatus: 'pending',
      driveFileId: '',
      driveLink: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    tx.set(ref, bill)
    return toBill(ref.id, { ...bill, createdAt: null, updatedAt: null })
  })
}

/** Edits a bill: only the net quantity difference per product touches stock. Same bill number. */
export async function editBill(billId: string, draft: BillDraft): Promise<Bill> {
  validateDraft(draft)

  return runTransaction(db, async (tx) => {
    // ---- reads ----
    const snap = await tx.get(billRef(billId))
    if (!snap.exists()) throw new Error('Bill not found')
    const old = toBill(snap.id, snap.data() as Omit<Bill, 'id'>)
    if (old.status === 'cancelled') throw new Error(`Bill ${old.billNumber} is cancelled and cannot be edited`)
    const products = await readProducts(tx, [...old.items, ...draft.items].map((i) => i.productId))

    // ---- plan ----
    const items = buildItems(draft.items, products)
    const changes = planEdit(toStockMap(products), old.items, items)
    const fields = billFields(draft, items, old)

    // ---- writes ----
    applyStockChanges(tx, changes, {
      refType: 'bill',
      refId: billId,
      billNumber: old.billNumber,
      date: draft.billDate,
      note: `Bill ${old.billNumber} edited`,
      typeFor: (c) => (c.deltaGrams < 0 ? 'SALE' : 'SALE_REVERSAL'),
    })
    tx.update(billRef(billId), { ...fields, pdfStatus: 'pending', updatedAt: serverTimestamp() })
    return { ...old, ...fields, pdfStatus: 'pending' as const }
  })
}

export interface PaymentInput {
  amount: number
  mode: ReceiptMode
  date: string
  note?: string
}

/**
 * Records money received against a credit bill and reduces its outstanding.
 * Rejects amounts larger than what is outstanding.
 */
export async function recordPayment(billId: string, input: PaymentInput): Promise<Bill> {
  if (!RECEIPT_MODES.includes(input.mode)) throw new Error('Choose Cash, UPI or Card')
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(billRef(billId))
    if (!snap.exists()) throw new Error('Bill not found')
    const bill = toBill(snap.id, snap.data() as Omit<Bill, 'id'>)
    if (bill.status === 'cancelled') throw new Error(`Bill ${bill.billNumber} is cancelled`)
    if (bill.paymentMode !== 'credit') throw new Error(`Bill ${bill.billNumber} is not a credit bill`)

    const amount = round2(input.amount)
    const balanceDue = applyPayment(bill.balanceDue, amount)
    const payment: Payment = { amount, mode: input.mode, date: input.date, note: input.note?.trim() ?? '' }
    const payments = [...bill.payments, payment]
    const paidAmount = round2(bill.paidAmount + amount)

    tx.update(billRef(billId), { payments, paidAmount, balanceDue, pdfStatus: 'pending', updatedAt: serverTimestamp() })
    return { ...bill, payments, paidAmount, balanceDue, pdfStatus: 'pending' as const }
  })
}

/**
 * Cancels a bill and puts its stock back. Cancelling an already-cancelled bill
 * does nothing and returns { changed: false }. Bills are never deleted.
 */
export async function cancelBill(billId: string): Promise<{ changed: boolean; bill: Bill }> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(billRef(billId))
    if (!snap.exists()) throw new Error('Bill not found')
    const bill = toBill(snap.id, snap.data() as Omit<Bill, 'id'>)
    if (!canCancel(bill)) return { changed: false, bill }

    const products = await readProducts(tx, bill.items.map((i) => i.productId))
    const changes = planCancel(toStockMap(products), bill.items)

    applyStockChanges(tx, changes, {
      refType: 'bill',
      refId: billId,
      billNumber: bill.billNumber,
      date: bill.billDate,
      note: `Bill ${bill.billNumber} cancelled`,
      typeFor: () => 'SALE_REVERSAL',
    })
    tx.update(billRef(billId), { status: 'cancelled', updatedAt: serverTimestamp() })
    return { changed: true, bill: { ...bill, status: 'cancelled' as const } }
  })
}

/** Called after a successful Drive upload/update. */
export async function attachPdf(billId: string, driveFileId: string, driveLink: string): Promise<void> {
  await updateDoc(billRef(billId), { driveFileId, driveLink, pdfStatus: 'uploaded', updatedAt: serverTimestamp() })
}

export async function getBill(billId: string): Promise<Bill | null> {
  const snap = await getDoc(billRef(billId))
  return snap.exists() ? toBill(snap.id, snap.data() as Omit<Bill, 'id'>) : null
}

function billNumberValue(b: Bill): number {
  return Number(b.billNumber.replace(/\D/g, '')) || 0
}

/** Bills with billDate in [from, to] (inclusive), newest bill number first. */
export async function listBills(from: string, to: string): Promise<Bill[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.bills), where('billDate', '>=', from), where('billDate', '<=', to)))
  return snap.docs
    .map((d) => toBill(d.id, d.data() as Omit<Bill, 'id'>))
    .sort((a, b) => b.billDate.localeCompare(a.billDate) || billNumberValue(b) - billNumberValue(a))
}

export async function listRecentBills(count = 5): Promise<Bill[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.bills), orderBy('createdAt', 'desc'), limit(count)))
  return snap.docs.map((d) => toBill(d.id, d.data() as Omit<Bill, 'id'>))
}

/** Every active bill that still has money outstanding, oldest first. Single-field query, no index needed. */
export async function listOutstandingBills(): Promise<Bill[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.bills), where('balanceDue', '>', 0)))
  return snap.docs
    .map((d) => toBill(d.id, d.data() as Omit<Bill, 'id'>))
    .filter((b) => b.status === 'active')
    .sort((a, b) => a.billDate.localeCompare(b.billDate) || billNumberValue(a) - billNumberValue(b))
}
