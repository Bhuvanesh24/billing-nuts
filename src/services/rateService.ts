import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'
import { COLLECTIONS, db } from './firestore'
import { round2 } from '../lib/calculator'
import { todayISO } from '../lib/date'
import type { DailyRate } from '../types'

export const dailyRateId = (productId: string, date: string) => `${productId}_${date}`

export interface RateRow {
  productId: string
  productName: string
  ratePerKg: number
  purchaseRatePerKg?: number
}

/**
 * Saves every row in one batch. When the date is today, products.currentRate
 * (and purchaseRate, if given) are updated in the same batch so billing picks them up.
 */
export async function saveRates(date: string, rows: RateRow[]): Promise<number> {
  const valid = rows.filter((r) => r.ratePerKg > 0)
  if (valid.length === 0) throw new Error('Enter at least one rate')
  if (valid.length > 240) throw new Error('Too many rates to save at once') // 2 writes per row, batch limit 500

  const isToday = date === todayISO()
  const batch = writeBatch(db)
  for (const r of valid) {
    const ratePerKg = round2(r.ratePerKg)
    const purchaseRatePerKg = r.purchaseRatePerKg && r.purchaseRatePerKg > 0 ? round2(r.purchaseRatePerKg) : undefined
    batch.set(doc(db, COLLECTIONS.dailyRates, dailyRateId(r.productId, date)), {
      productId: r.productId,
      productName: r.productName,
      date,
      ratePerKg,
      purchaseRatePerKg,
      createdAt: serverTimestamp(),
    })
    if (isToday) {
      batch.update(doc(db, COLLECTIONS.products, r.productId), {
        currentRate: ratePerKg,
        ...(purchaseRatePerKg ? { purchaseRate: purchaseRatePerKg } : {}),
        updatedAt: serverTimestamp(),
      })
    }
  }
  await batch.commit()
  return valid.length
}

/** productId → rate for one date */
export async function getRatesForDate(date: string): Promise<Map<string, DailyRate>> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.dailyRates), where('date', '==', date)))
  const map = new Map<string, DailyRate>()
  snap.docs.forEach((d) => {
    const rate = { id: d.id, ...(d.data() as Omit<DailyRate, 'id'>) }
    map.set(rate.productId, rate)
  })
  return map
}

/** Rate history for one product, newest first (sorted client-side; no composite index needed). */
export async function getRateHistory(productId: string, max = 60): Promise<DailyRate[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.dailyRates), where('productId', '==', productId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<DailyRate, 'id'>) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, max)
}
