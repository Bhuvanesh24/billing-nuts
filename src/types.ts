import type { Timestamp, FieldValue } from 'firebase/firestore'

export type FirestoreTime = Timestamp | FieldValue | null

export interface Product {
  id: string
  name: string
  category: string
  hsnCode: string
  gstRate: number
  unit: 'kg'
  /** Current stock in integer grams. Changed ONLY inside Firestore transactions. */
  stockGrams: number
  /** Today's selling rate per kg. */
  currentRate: number
  /** Latest purchase rate per kg (from Stock In or Daily Rates). Used for margin and stock valuation. */
  purchaseRate: number
  lowStockThresholdGrams: number
  isActive: boolean
  createdAt: FirestoreTime
  updatedAt: FirestoreTime
}

export type ProductInput = Pick<Product, 'name' | 'category' | 'hsnCode' | 'gstRate' | 'lowStockThresholdGrams'>

export interface DailyRate {
  id: string
  productId: string
  productName: string
  /** YYYY-MM-DD (local date) */
  date: string
  ratePerKg: number
  purchaseRatePerKg?: number
  createdAt: FirestoreTime
}

export type MovementType = 'IN' | 'SALE' | 'SALE_REVERSAL' | 'ADJUSTMENT'
export type MovementRefType = 'purchase' | 'bill' | 'manual'

export interface StockMovement {
  id: string
  productId: string
  productName: string
  type: MovementType
  /** Positive for additions, negative for deductions. */
  qtyGrams: number
  balanceAfterGrams: number
  refType: MovementRefType
  refId: string
  billNumber?: string
  purchaseRatePerKg?: number
  note: string
  /** YYYY-MM-DD (local date) */
  date: string
  createdAt: FirestoreTime
}

export interface BillItem {
  productId: string
  productName: string
  hsnCode: string
  qtyGrams: number
  ratePerKg: number
  gstRate: number
  amount: number
}

export interface CustomerSnapshot {
  name: string
  phone: string
  address: string
  gstNo: string
}

export type PaymentMode = 'cash' | 'upi' | 'card'
export type BillStatus = 'active' | 'cancelled'
export type PdfStatus = 'uploaded' | 'pending'

/** grandTotal = subtotal − discount + gstAmount (all rupees, 2 decimals). */
export interface BillTotals {
  subtotal: number
  /** Discount in rupees, typed on the bill. */
  discount: number
  /** GST in rupees, typed on the bill. */
  gstAmount: number
  grandTotal: number
}

export interface Bill extends BillTotals {
  id: string
  billNumber: string
  /** YYYY-MM-DD (local date) */
  billDate: string
  customerSnapshot: CustomerSnapshot
  items: BillItem[]
  paymentMode: PaymentMode
  status: BillStatus
  pdfStatus: PdfStatus
  driveFileId: string
  driveLink: string
  createdAt: FirestoreTime
  updatedAt: FirestoreTime
}

/** What the Create/Edit Bill form hands to billService. */
export interface BillDraft {
  billDate: string
  customerSnapshot: CustomerSnapshot
  items: BillItem[]
  discount: number
  gstAmount: number
  paymentMode: PaymentMode
}

export interface Counter {
  current: number
  lastUpdated: FirestoreTime
}
