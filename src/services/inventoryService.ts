/**
 * ALL stock math lives here (and in the pure planners in lib/calculator.ts).
 * products.stockGrams is only ever changed inside runTransaction, and every
 * change writes a stockMovements document. Inside a transaction every read
 * happens before any write.
 */
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore'
import { COLLECTIONS, db } from './firestore'
import { planAdjust, planStockIn, StockError, type StockChange, type StockMap } from '../lib/calculator'
import { todayISO } from '../lib/date'
import type { MovementRefType, MovementType, Product, StockMovement } from '../types'

export const productRef = (id: string) => doc(db, COLLECTIONS.products, id) as DocumentReference<Omit<Product, 'id'>>

export type MovementInput = Omit<StockMovement, 'id' | 'createdAt'>

/** WRITE-only helper: appends one ledger entry inside a transaction. */
export function writeMovement(tx: Transaction, movement: MovementInput): void {
  const ref = doc(collection(db, COLLECTIONS.stockMovements))
  tx.set(ref, { ...movement, createdAt: serverTimestamp() })
}

/** READ step: loads the given products inside a transaction. */
export async function readProducts(tx: Transaction, productIds: Iterable<string>): Promise<Map<string, Product>> {
  const ids = [...new Set(productIds)]
  const snaps = await Promise.all(ids.map((id) => tx.get(productRef(id))))
  const map = new Map<string, Product>()
  snaps.forEach((snap, i) => {
    if (snap.exists()) map.set(ids[i], { id: ids[i], ...snap.data() })
  })
  return map
}

export function toStockMap(products: Map<string, Product>): StockMap {
  const stock: StockMap = {}
  for (const [id, p] of products) stock[id] = p.stockGrams
  return stock
}

interface ChangeContext {
  type: MovementType
  refType: MovementRefType
  refId: string
  date: string
  note: string
  billNumber?: string
}

/**
 * WRITE step: applies planned stock changes and writes one movement per change.
 * `typeFor` lets billService pick SALE vs SALE_REVERSAL per change.
 */
export function applyStockChanges(
  tx: Transaction,
  changes: StockChange[],
  ctx: Omit<ChangeContext, 'type'> & { typeFor: (change: StockChange) => MovementType },
): void {
  for (const change of changes) {
    if (change.balanceAfterGrams < 0) throw new StockError(`Stock for ${change.productName} cannot go below 0`)
    tx.update(productRef(change.productId), { stockGrams: change.balanceAfterGrams, updatedAt: serverTimestamp() })
    writeMovement(tx, {
      productId: change.productId,
      productName: change.productName,
      type: ctx.typeFor(change),
      qtyGrams: change.deltaGrams,
      balanceAfterGrams: change.balanceAfterGrams,
      refType: ctx.refType,
      refId: ctx.refId,
      billNumber: ctx.billNumber,
      note: ctx.note,
      date: ctx.date,
    })
  }
}

export interface AddStockInput {
  productId: string
  qtyGrams: number
  purchaseRatePerKg?: number
  date?: string
  note?: string
}

/** Stock In (purchase). Returns the new balance in grams. */
export async function addStock(input: AddStockInput): Promise<number> {
  return runTransaction(db, async (tx) => {
    const ref = productRef(input.productId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new StockError('Product not found')
    const product = snap.data()

    const balance = planStockIn(product.stockGrams, input.qtyGrams)

    tx.update(ref, {
      stockGrams: balance,
      ...(input.purchaseRatePerKg ? { purchaseRate: input.purchaseRatePerKg } : {}),
      updatedAt: serverTimestamp(),
    })
    writeMovement(tx, {
      productId: input.productId,
      productName: product.name,
      type: 'IN',
      qtyGrams: input.qtyGrams,
      balanceAfterGrams: balance,
      refType: 'purchase',
      refId: '',
      purchaseRatePerKg: input.purchaseRatePerKg,
      note: input.note?.trim() || 'Stock in',
      date: input.date ?? todayISO(),
    })
    return balance
  })
}

export interface AdjustStockInput {
  productId: string
  /** Positive adds, negative removes. */
  deltaGrams: number
  reason: string
  date?: string
}

/** Manual adjustment (wastage, damage, physical count). Reason is required. */
export async function adjustStock(input: AdjustStockInput): Promise<number> {
  const reason = input.reason.trim()
  if (!reason) throw new StockError('A reason is required for stock adjustments')

  return runTransaction(db, async (tx) => {
    const ref = productRef(input.productId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new StockError('Product not found')
    const product = snap.data()

    const balance = planAdjust(product.stockGrams, input.deltaGrams, product.name)

    tx.update(ref, { stockGrams: balance, updatedAt: serverTimestamp() })
    writeMovement(tx, {
      productId: input.productId,
      productName: product.name,
      type: 'ADJUSTMENT',
      qtyGrams: input.deltaGrams,
      balanceAfterGrams: balance,
      refType: 'manual',
      refId: '',
      note: reason,
      date: input.date ?? todayISO(),
    })
    return balance
  })
}

function createdAtMillis(m: StockMovement): number {
  const t = m.createdAt
  return t && 'toMillis' in t ? t.toMillis() : Number.MAX_SAFE_INTEGER // pending server timestamp = newest
}

/** All movements for one product, newest first. Sorted client-side so no composite index is needed. */
export async function getLedger(productId: string): Promise<StockMovement[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.stockMovements), where('productId', '==', productId)))
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockMovement, 'id'>) }))
  return rows.sort((a, b) => createdAtMillis(b) - createdAtMillis(a))
}

/** Movements in a date range (inclusive, 'YYYY-MM-DD'), newest first. */
export async function getMovementsByDate(from: string, to: string): Promise<StockMovement[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTIONS.stockMovements), where('date', '>=', from), where('date', '<=', to)),
  )
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockMovement, 'id'>) }))
  return rows.sort((a, b) => createdAtMillis(b) - createdAtMillis(a))
}
