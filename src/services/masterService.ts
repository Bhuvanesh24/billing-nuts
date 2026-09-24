import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { COLLECTIONS, db } from './firestore'
import { writeMovement } from './inventoryService'
import { todayISO } from '../lib/date'
import type { Product, ProductInput } from '../types'

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listProducts(opts: { activeOnly?: boolean } = {}): Promise<Product[]> {
  const snap = await getDocs(query(collection(db, COLLECTIONS.products), orderBy('name')))
  const products = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))
  return opts.activeOnly ? products.filter((p) => p.isActive) : products
}

export async function getProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.products, id))
  return snap.exists() ? { id: snap.id, ...(snap.data() as Omit<Product, 'id'>) } : null
}

function cleanProductInput(input: ProductInput): ProductInput {
  return {
    name: input.name.trim(),
    category: input.category.trim(),
    hsnCode: input.hsnCode.trim(),
    gstRate: Number(input.gstRate) || 0,
    lowStockThresholdGrams: Math.max(0, Math.round(input.lowStockThresholdGrams) || 0),
  }
}

/**
 * Creates a product. Opening stock (if any) is written in the same transaction
 * as an 'IN' movement, so the ledger always adds up to stockGrams.
 */
export async function createProduct(input: ProductInput, openingStockGrams: number): Promise<string> {
  const data = cleanProductInput(input)
  if (!data.name) throw new Error('Product name is required')
  if (!Number.isInteger(openingStockGrams) || openingStockGrams < 0) throw new Error('Invalid opening stock')

  const ref = doc(collection(db, COLLECTIONS.products))
  await runTransaction(db, async (tx) => {
    tx.set(ref, {
      ...data,
      unit: 'kg',
      stockGrams: openingStockGrams,
      currentRate: 0,
      purchaseRate: 0,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (openingStockGrams > 0) {
      writeMovement(tx, {
        productId: ref.id,
        productName: data.name,
        type: 'IN',
        qtyGrams: openingStockGrams,
        balanceAfterGrams: openingStockGrams,
        refType: 'manual',
        refId: '',
        note: 'Opening stock',
        date: todayISO(),
      })
    }
  })
  return ref.id
}

/** Updates master fields only — stockGrams is never touched here. */
export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const data = cleanProductInput(input)
  if (!data.name) throw new Error('Product name is required')
  await updateDoc(doc(db, COLLECTIONS.products, id), { ...data, updatedAt: serverTimestamp() })
}

export async function setProductActive(id: string, isActive: boolean): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.products, id), { isActive, updatedAt: serverTimestamp() })
}
