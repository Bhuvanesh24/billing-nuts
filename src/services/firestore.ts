import { initializeApp } from 'firebase/app'
import { doc, getDoc, initializeFirestore, serverTimestamp, type Transaction } from 'firebase/firestore'
import type { Counter } from '../types'
import { INVOICE_NUMBER_START } from '../config/business'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
// Optional fields (billNumber, purchaseRatePerKg, …) are left undefined rather than written.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true })

export const COLLECTIONS = {
  products: 'products',
  dailyRates: 'dailyRates',
  stockMovements: 'stockMovements',
  bills: 'bills',
  counters: 'counters',
} as const

const counterRef = () => doc(db, COLLECTIONS.counters, 'invoiceNumber')

export function formatInvoiceNumber(n: number): string {
  return `#${String(n).padStart(5, '0')}`
}

/**
 * Transaction step 1 (READ): returns the next invoice number and a writer.
 * Call `commit()` only after every other read in the transaction is done.
 */
export async function reserveInvoiceNumber(tx: Transaction): Promise<{ billNumber: string; commit: () => void }> {
  const ref = counterRef()
  const snap = await tx.get(ref)
  const current = snap.exists() ? ((snap.data() as Counter).current ?? 0) : INVOICE_NUMBER_START - 1
  const next = current + 1
  return {
    billNumber: formatInvoiceNumber(next),
    commit: () => tx.set(ref, { current: next, lastUpdated: serverTimestamp() }),
  }
}

/** Shows the next bill number in the UI without incrementing the counter. */
export async function peekNextInvoiceNumber(): Promise<string> {
  const snap = await getDoc(counterRef())
  const current = snap.exists() ? ((snap.data() as Counter).current ?? 0) : INVOICE_NUMBER_START - 1
  return formatInvoiceNumber(current + 1)
}
