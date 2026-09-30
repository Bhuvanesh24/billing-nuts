/**
 * Pure functions for quantities, money and stock math.
 * No Firebase imports here — everything is unit-tested by scripts/test-calculator.ts.
 *
 * Quantities are INTEGER GRAMS. Money is rupees rounded to 2 decimals.
 */

import type { BillTotals } from '../types'

// ---------------------------------------------------------------------------
// Units & rounding
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000)
}

export function gramsToKg(grams: number): number {
  return grams / 1000
}

/** 1250 → "1.250" */
export function formatKg(grams: number): string {
  return gramsToKg(grams).toFixed(3)
}

/** Parses a kg string typed by the user into grams. Returns null for invalid/negative input. */
export function parseKgInput(value: string): number | null {
  if (value.trim() === '') return null
  const kg = Number(value)
  if (!Number.isFinite(kg) || kg < 0) return null
  return kgToGrams(kg)
}

/**
 * Parses a quantity typed on the bill screen into grams. Accepts kg by default:
 *   "0.5", "1/2", "1 1/2", "½", "¼", "250g", "250 gm", "1.5kg"
 * Returns null for anything invalid, zero or negative.
 */
export function parseQtyInput(value: string): number | null {
  let v = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!v) return null
  v = v.replace(/½/g, ' 1/2').replace(/¼/g, ' 1/4').replace(/¾/g, ' 3/4').trim()

  let unit: 'kg' | 'g' = 'kg'
  const unitMatch = v.match(/^(.*?)\s*(kg|kgs|g|gm|gms|grams?)$/)
  if (unitMatch) {
    v = unitMatch[1].trim()
    unit = unitMatch[2].startsWith('k') ? 'kg' : 'g'
  }

  // "1.5", "1/2" or a mixed number "1 1/2"
  const mixed = v.match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/)
  if (!mixed || (!mixed[1] && !mixed[2])) return null
  let amount = mixed[1] ? Number(mixed[1]) : 0
  if (mixed[2]) {
    const den = Number(mixed[3])
    if (!den) return null
    amount += Number(mixed[2]) / den
  }
  if (!Number.isFinite(amount) || amount <= 0) return null
  const grams = unit === 'kg' ? kgToGrams(amount) : Math.round(amount)
  return grams > 0 ? grams : null
}

/** 500 → "500 g", 1500 → "1.500 kg" — friendly display for bill rows. */
export function formatQty(grams: number): string {
  return grams < 1000 ? `${grams} g` : `${formatKg(grams)} kg`
}

export function lineAmount(qtyGrams: number, ratePerKg: number): number {
  return round2((qtyGrams * ratePerKg) / 1000)
}

export function formatINR(n: number): string {
  return `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---------------------------------------------------------------------------
// Bill totals
// ---------------------------------------------------------------------------

/**
 * Grand total = subtotal − discount + GST.
 * Discount and GST are rupee amounts typed on the bill. The discount is capped
 * at the subtotal; negative values count as 0. No rounding to whole rupees.
 */
export function computeTotals(lines: { amount: number }[], discount: number, gstAmount: number): BillTotals {
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0))
  const disc = round2(Math.min(Math.max(discount || 0, 0), subtotal))
  const gst = round2(Math.max(gstAmount || 0, 0))
  return { subtotal, discount: disc, gstAmount: gst, grandTotal: round2(subtotal - disc + gst) }
}

// ---------------------------------------------------------------------------
// Credit / outstanding
// ---------------------------------------------------------------------------

/** Outstanding on a credit bill. Throws if more has been paid than the bill total. */
export function creditBalance(grandTotal: number, paidAmount: number): number {
  const paid = round2(paidAmount)
  if (!(paid >= 0)) throw new Error('Paid amount cannot be negative')
  if (paid > round2(grandTotal)) {
    throw new Error(`Paid ${formatINR(paid)} is more than the bill total ${formatINR(grandTotal)}`)
  }
  return round2(grandTotal - paid)
}

/** Receiving money against a credit bill. Returns the new balance; never lets it go below 0. */
export function applyPayment(balanceDue: number, amount: number): number {
  const amt = round2(amount)
  if (!(amt > 0)) throw new Error('Enter an amount greater than 0')
  if (amt > round2(balanceDue)) throw new Error(`Only ${formatINR(balanceDue)} is outstanding on this bill`)
  return round2(balanceDue - amt)
}

// ---------------------------------------------------------------------------
// Stock planning (used inside Firestore transactions and in tests)
// ---------------------------------------------------------------------------

export interface StockLine {
  productId: string
  productName: string
  qtyGrams: number
}

export interface StockChange {
  productId: string
  productName: string
  /** Positive adds stock, negative removes it. */
  deltaGrams: number
  balanceAfterGrams: number
}

/** productId → current stockGrams */
export type StockMap = Record<string, number>

export class StockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockError'
  }
}

export function insufficientStockMessage(productName: string, availableGrams: number): string {
  return `Only ${formatKg(Math.max(availableGrams, 0))} kg of ${productName} in stock`
}

/** Sums quantities per product (a cart may list the same product twice). */
export function qtyByProduct(items: StockLine[]): Map<string, { productName: string; qtyGrams: number }> {
  const map = new Map<string, { productName: string; qtyGrams: number }>()
  for (const item of items) {
    const existing = map.get(item.productId)
    if (existing) existing.qtyGrams += item.qtyGrams
    else map.set(item.productId, { productName: item.productName, qtyGrams: item.qtyGrams })
  }
  return map
}

/** Merges bill rows with the same product and the same rate into one row. */
export function mergeItems<T extends StockLine & { ratePerKg: number; amount: number }>(items: T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    const existing = out.find((o) => o.productId === item.productId && o.ratePerKg === item.ratePerKg)
    if (existing) {
      existing.qtyGrams += item.qtyGrams
      existing.amount = lineAmount(existing.qtyGrams, existing.ratePerKg)
    } else {
      out.push({ ...item, amount: lineAmount(item.qtyGrams, item.ratePerKg) })
    }
  }
  return out
}

function requireStock(stock: StockMap, productId: string, productName: string): number {
  const current = stock[productId]
  if (current === undefined) throw new StockError(`Product "${productName}" no longer exists`)
  return current
}

function validateQty(line: StockLine): void {
  if (!Number.isInteger(line.qtyGrams) || line.qtyGrams <= 0) {
    throw new StockError(`Enter a valid quantity for ${line.productName}`)
  }
}

/** A new sale. Throws if ANY product is short, so the whole bill fails. */
export function planSale(stock: StockMap, items: StockLine[]): StockChange[] {
  items.forEach(validateQty)
  const changes: StockChange[] = []
  for (const [productId, { productName, qtyGrams }] of qtyByProduct(items)) {
    const current = requireStock(stock, productId, productName)
    if (current < qtyGrams) throw new StockError(insufficientStockMessage(productName, current))
    changes.push({ productId, productName, deltaGrams: -qtyGrams, balanceAfterGrams: current - qtyGrams })
  }
  return changes
}

/**
 * Editing a bill: only the net difference per product touches stock.
 * Stock is checked only where the new quantity is larger than the old one.
 */
export function planEdit(stock: StockMap, oldItems: StockLine[], newItems: StockLine[]): StockChange[] {
  newItems.forEach(validateQty)
  const oldQty = qtyByProduct(oldItems)
  const newQty = qtyByProduct(newItems)
  const productIds = new Set([...oldQty.keys(), ...newQty.keys()])

  const changes: StockChange[] = []
  for (const productId of productIds) {
    const before = oldQty.get(productId)?.qtyGrams ?? 0
    const after = newQty.get(productId)?.qtyGrams ?? 0
    const extraNeeded = after - before
    if (extraNeeded === 0) continue

    const productName = newQty.get(productId)?.productName ?? oldQty.get(productId)?.productName ?? productId
    const current = requireStock(stock, productId, productName)
    if (extraNeeded > 0 && current < extraNeeded) {
      // Tell the user the total they can put on this bill: stock + what the bill already holds.
      throw new StockError(insufficientStockMessage(productName, current + before))
    }
    changes.push({ productId, productName, deltaGrams: -extraNeeded, balanceAfterGrams: current - extraNeeded })
  }
  return changes
}

/** Cancelling a bill puts every item's quantity back. */
export function planCancel(stock: StockMap, items: StockLine[]): StockChange[] {
  const changes: StockChange[] = []
  for (const [productId, { productName, qtyGrams }] of qtyByProduct(items)) {
    const current = requireStock(stock, productId, productName)
    changes.push({ productId, productName, deltaGrams: qtyGrams, balanceAfterGrams: current + qtyGrams })
  }
  return changes
}

/** Returns true only for a bill that can still be cancelled (cancelling twice is a no-op). */
export function canCancel(bill: { status: 'active' | 'cancelled' }): boolean {
  return bill.status === 'active'
}

/** Stock in from a purchase. Returns the new balance. */
export function planStockIn(currentGrams: number, qtyGrams: number): number {
  if (!Number.isInteger(qtyGrams) || qtyGrams <= 0) throw new StockError('Enter a quantity greater than 0')
  return currentGrams + qtyGrams
}

/** Manual adjustment (wastage, damage, count correction). Never lets stock go below 0. */
export function planAdjust(currentGrams: number, deltaGrams: number, productName: string): number {
  if (!Number.isInteger(deltaGrams) || deltaGrams === 0) throw new StockError('Adjustment quantity cannot be 0')
  const next = currentGrams + deltaGrams
  if (next < 0) throw new StockError(insufficientStockMessage(productName, currentGrams))
  return next
}
