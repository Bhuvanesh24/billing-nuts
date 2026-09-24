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
import { canCancel, computeTotals, lineAmount, mergeItems, planCancel, planEdit, planSale, round2, StockError } from '../lib/calculator'
import type { Bill, BillDraft, BillItem, Product } from '../types'

const billRef = (id: string) => doc(db, COLLECTIONS.bills, id)

/** Bills saved before GST became a typed amount stored cgst/sgst/igst instead of gstAmount. */
function toBill(id: string, data: Omit<Bill, 'id'>): Bill {
  const legacy = data as Partial<Record<'cgst' | 'sgst' | 'igst', number>>
  const gstAmount = data.gstAmount ?? round2((legacy.cgst ?? 0) + (legacy.sgst ?? 0) + (legacy.igst ?? 0))
  return { id, ...data, gstAmount }
}

function validateDraft(draft: BillDraft): void {
  if (!draft.customerSnapshot.name.trim()) throw new Error('Enter the customer name')
  if (draft.items.length === 0) throw new Error('Add at least one item')
  for (const item of draft.items) {
    if (!item.productId) throw new Error('Select a product for every row')
    if (!Number.isInteger(item.qtyGrams) || item.qtyGrams <= 0) throw new Error(`Enter a valid quantity for ${item.productName}`)
  }
  if (!(draft.discount >= 0)) throw new Error('Discount cannot be negative')
  if (!(draft.gstAmount >= 0)) throw new Error('GST cannot be negative')
  if (!['cash', 'upi', 'card'].includes(draft.paymentMode)) throw new Error('Choose Cash, UPI or Card')
}

/** productId → rate/kg already on a bill. Editing a bill keeps these rates. */
export function ratesOnBill(items: BillItem[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const it of items) if (!map.has(it.productId)) map.set(it.productId, it.ratePerKg)
  return map
}

/**
 * Snapshots product name / HSN / GST from the product documents read inside the
 * transaction, merges duplicate rows, and recomputes every amount.
 *
 * The rate is NOT taken from the form: it is the product's current daily rate,
 * or, when editing, the rate the product was originally billed at (lockedRates).
 */
function buildItems(items: BillItem[], products: Map<string, Product>, lockedRates = new Map<string, number>()): BillItem[] {
  const snapshotted = items.map((item) => {
    const p = products.get(item.productId)
    if (!p) throw new StockError(`Product "${item.productName}" no longer exists`)
    const ratePerKg = lockedRates.get(item.productId) ?? p.currentRate
    if (!(ratePerKg > 0)) throw new Error(`No rate set today for ${p.name}. Set it on the Daily Rates page first.`)
    return {
      productId: item.productId,
      productName: p.name,
      hsnCode: p.hsnCode,
      gstRate: p.gstRate,
      qtyGrams: item.qtyGrams,
      ratePerKg: round2(ratePerKg),
      amount: lineAmount(item.qtyGrams, ratePerKg),
    }
  })
  return mergeItems(snapshotted)
}

function billFields(draft: BillDraft, items: BillItem[]) {
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
    const items = buildItems(draft.items, products, ratesOnBill(old.items))
    const changes = planEdit(toStockMap(products), old.items, items)
    const fields = billFields(draft, items)

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
