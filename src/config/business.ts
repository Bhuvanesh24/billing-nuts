// Shop details printed on invoices. Values marked DUMMY must be replaced before going live.

export const BUSINESS = {
  name: 'Sai Cashews',
  tagline: 'Inventory & Billing',
  addressLines: [
    'No. 10 A, Thirumalai Swami Street, Lakshmi Nagar, 3rd Street,',
    'Kavundampalayam Post, Coimbatore – 641 030',
  ],
  gstin: '33AAAAA0000A1Z5', // DUMMY
  stateName: 'Tamil Nadu',
  stateCode: '33',
  phone: '77082 53836',
  email: '', // optional
} as const

export const UPI = {
  vpa: 'saicashews@upi', // DUMMY
  merchantName: 'Sai Cashews',
} as const

export const BANK = {
  // DUMMY
  accountName: 'Sai Cashews',
  bankName: 'State Bank of India',
  accountNumber: '00000000000',
  ifsc: 'SBIN0000000',
  branch: 'Coimbatore',
} as const

export const INVOICE_TERMS = [
  'Goods once sold will not be taken back.',
  'Please check the weight and quality at the time of delivery.',
  'Subject to Coimbatore jurisdiction.',
]

/**
 * The first bill number the app issues when counters/invoiceNumber does not exist yet.
 * Bills are numbered sequentially from here: #00001, #00002, …
 */
export const INVOICE_NUMBER_START = 1


export const DEFAULT_GST_RATE = 5
export const DEFAULT_HSN = '0801'
export const PRODUCT_CATEGORIES = ['Cashew', 'Almond', 'Pistachio', 'Raisins', 'Walnut', 'Dates', 'Others']

/** Quick-pick quantities shown on the bill screen (grams). */
export const QUICK_QTYS = [
  { label: '¼ kg', grams: 250 },
  { label: '½ kg', grams: 500 },
  { label: '1 kg', grams: 1000 },
]

/** Sample products taken from bill No. 701 — offered on an empty Products page. */
export const SAMPLE_PRODUCTS = [
  { name: 'Almond (Badam)', category: 'Almond', hsnCode: '0802', gstRate: 5, ratePerKg: 4500 },
  { name: 'Cashew', category: 'Cashew', hsnCode: '0801', gstRate: 5, ratePerKg: 1800 },
  { name: 'Roasted Cashew', category: 'Cashew', hsnCode: '0801', gstRate: 5, ratePerKg: 2000 },
  { name: 'Dry Grapes / Raisins', category: 'Raisins', hsnCode: '0806', gstRate: 5, ratePerKg: 520 },
]
