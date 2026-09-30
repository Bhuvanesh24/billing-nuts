/**
 * Pure-function tests for stock math and bill totals.
 * Run: npm test   (or: npx tsx scripts/test-calculator.ts)
 */
import assert from 'node:assert/strict'
import {
  applyPayment,
  canCancel,
  computeTotals,
  creditBalance,
  formatKg,
  formatQty,
  gramsToKg,
  kgToGrams,
  lineAmount,
  mergeItems,
  parseKgInput,
  parseQtyInput,
  planAdjust,
  planCancel,
  planEdit,
  planSale,
  planStockIn,
  round2,
  StockError,
  type StockChange,
  type StockMap,
} from '../src/lib/calculator'
import { numberToWords } from '../src/lib/numberToWords'

let passed = 0
let failed = 0

function test(name: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ✔ ${name}`)
  } catch (e) {
    failed++
    console.log(`  ✖ ${name}`)
    console.log(`    ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** Applies changes to a stock map the same way the transaction does. */
function apply(stock: StockMap, changes: StockChange[]): StockMap {
  const next = { ...stock }
  for (const c of changes) {
    assert.equal(next[c.productId] + c.deltaGrams, c.balanceAfterGrams, 'balanceAfterGrams must equal stock + delta')
    next[c.productId] = c.balanceAfterGrams
  }
  return next
}

const cashew = (qtyGrams: number) => ({ productId: 'cashew', productName: 'Cashew', qtyGrams })
const almond = (qtyGrams: number) => ({ productId: 'almond', productName: 'Almond', qtyGrams })

console.log('\nUnits & rounding')

test('kg ↔ grams conversion', () => {
  assert.equal(kgToGrams(1.25), 1250)
  assert.equal(kgToGrams(0.001), 1)
  assert.equal(kgToGrams(1.2345), 1235) // rounds to nearest gram
  assert.equal(kgToGrams(0.1 + 0.2), 300) // no floating-point drift
  assert.equal(gramsToKg(1250), 1.25)
  assert.equal(formatKg(1250), '1.250')
  assert.equal(formatKg(7), '0.007')
})

test('parseKgInput rejects bad input', () => {
  assert.equal(parseKgInput('2.5'), 2500)
  assert.equal(parseKgInput(''), null)
  assert.equal(parseKgInput('-1'), null)
  assert.equal(parseKgInput('abc'), null)
})

test('round2 and line amounts', () => {
  assert.equal(round2(0.1 + 0.2), 0.3)
  assert.equal(round2(1.005), 1.01)
  assert.equal(lineAmount(1250, 900), 1125)
  assert.equal(lineAmount(333, 999.99), 333)
  assert.equal(lineAmount(1, 850), 0.85)
})

test('summing many small grams stays exact', () => {
  let grams = 0
  for (let i = 0; i < 1000; i++) grams += kgToGrams(0.1)
  assert.equal(grams, 100_000)
})

console.log('\nSales')

test('a sale deducts stock correctly', () => {
  const stock: StockMap = { cashew: 10_000, almond: 5_000 }
  const after = apply(stock, planSale(stock, [cashew(2_500), almond(1_000)]))
  assert.deepEqual(after, { cashew: 7_500, almond: 4_000 })
})

test('duplicate cart rows are summed before the stock check', () => {
  const stock: StockMap = { cashew: 3_000 }
  const after = apply(stock, planSale(stock, [cashew(1_000), cashew(1_500)]))
  assert.equal(after.cashew, 500)
  assert.throws(() => planSale(stock, [cashew(2_000), cashew(1_500)]), StockError)
})

test('a sale over available stock is rejected and nothing is deducted', () => {
  const stock: StockMap = { cashew: 7_500, almond: 5_000 }
  assert.throws(
    () => planSale(stock, [almond(1_000), cashew(20_000)]),
    (e: unknown) => e instanceof StockError && e.message === 'Only 7.500 kg of Cashew in stock',
  )
  assert.deepEqual(stock, { cashew: 7_500, almond: 5_000 })
})

test('selling exactly the available stock leaves 0', () => {
  const stock: StockMap = { cashew: 1_234 }
  assert.equal(apply(stock, planSale(stock, [cashew(1_234)])).cashew, 0)
})

test('zero, negative, fractional-gram and unknown-product sales are rejected', () => {
  const stock: StockMap = { cashew: 1_000 }
  assert.throws(() => planSale(stock, [cashew(0)]), StockError)
  assert.throws(() => planSale(stock, [cashew(-5)]), StockError)
  assert.throws(() => planSale(stock, [cashew(1.5)]), StockError)
  assert.throws(() => planSale(stock, [almond(100)]), StockError)
})

test('mergeItems combines same product + rate only', () => {
  const merged = mergeItems([
    { ...cashew(1_000), ratePerKg: 900, amount: 900 },
    { ...cashew(500), ratePerKg: 900, amount: 450 },
    { ...cashew(500), ratePerKg: 950, amount: 475 },
  ])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].qtyGrams, 1_500)
  assert.equal(merged[0].amount, 1_350)
})

console.log('\nEditing bills')

test('editing a bill applies only the difference (increase)', () => {
  // Stock 7.5 kg after a 2.5 kg sale; bill edited to 3 kg → 7.0 kg
  const stock: StockMap = { cashew: 7_500 }
  const changes = planEdit(stock, [cashew(2_500)], [cashew(3_000)])
  assert.equal(changes.length, 1)
  assert.equal(changes[0].deltaGrams, -500)
  assert.equal(apply(stock, changes).cashew, 7_000)
})

test('editing a bill applies only the difference (decrease)', () => {
  const stock: StockMap = { cashew: 7_500 }
  assert.equal(apply(stock, planEdit(stock, [cashew(2_500)], [cashew(1_000)])).cashew, 9_000)
})

test('editing with no qty change touches nothing', () => {
  assert.deepEqual(planEdit({ cashew: 7_500 }, [cashew(2_500)], [cashew(2_500)]), [])
})

test('editing swaps products: old one restored, new one deducted', () => {
  const stock: StockMap = { cashew: 7_500, almond: 5_000 }
  const after = apply(stock, planEdit(stock, [cashew(2_500)], [almond(1_000)]))
  assert.deepEqual(after, { cashew: 10_000, almond: 4_000 })
})

test('edit checks stock only for the extra quantity', () => {
  // 0 kg left, but the bill already holds 2.5 kg → can keep 2.5, cannot go to 3
  const stock: StockMap = { cashew: 0 }
  assert.deepEqual(apply(stock, planEdit(stock, [cashew(2_500)], [cashew(2_500)])), stock)
  assert.throws(
    () => planEdit(stock, [cashew(2_500)], [cashew(3_000)]),
    (e: unknown) => e instanceof StockError && e.message === 'Only 2.500 kg of Cashew in stock',
  )
})

console.log('\nCancelling bills')

test('cancelling restores stock', () => {
  const stock: StockMap = { cashew: 7_500, almond: 4_000 }
  assert.deepEqual(apply(stock, planCancel(stock, [cashew(2_500), almond(1_000)])), { cashew: 10_000, almond: 5_000 })
})

test('cancelling twice does nothing', () => {
  const bill = { status: 'active' as 'active' | 'cancelled', items: [cashew(2_500)] }
  let stock: StockMap = { cashew: 7_500 }
  const cancel = () => {
    if (!canCancel(bill)) return
    stock = apply(stock, planCancel(stock, bill.items))
    bill.status = 'cancelled'
  }
  cancel()
  cancel()
  assert.equal(stock.cashew, 10_000)
})

test('full cycle: sale → edit → cancel returns to the original stock', () => {
  let stock: StockMap = { cashew: 10_000 }
  stock = apply(stock, planSale(stock, [cashew(2_500)]))
  stock = apply(stock, planEdit(stock, [cashew(2_500)], [cashew(3_000)]))
  stock = apply(stock, planCancel(stock, [cashew(3_000)]))
  assert.equal(stock.cashew, 10_000)
})

console.log('\nStock in & adjustments')

test('stock in adds, rejects 0', () => {
  assert.equal(planStockIn(1_000, 2_500), 3_500)
  assert.throws(() => planStockIn(1_000, 0), StockError)
})

test('adjustment never lets stock go below 0', () => {
  assert.equal(planAdjust(1_000, -250, 'Cashew'), 750)
  assert.equal(planAdjust(1_000, -1_000, 'Cashew'), 0)
  assert.equal(planAdjust(1_000, 500, 'Cashew'), 1_500)
  assert.throws(() => planAdjust(1_000, -1_001, 'Cashew'), StockError)
  assert.throws(() => planAdjust(1_000, 0, 'Cashew'), StockError)
})

console.log('\nBill totals')

test('grand total = subtotal − discount + GST', () => {
  const t = computeTotals([{ amount: 2250 }, { amount: 900 }], 150, 97.5)
  assert.deepEqual(t, { subtotal: 3150, discount: 150, gstAmount: 97.5, grandTotal: 3097.5 })
})

test('no discount and no GST: grand total is the plain sum', () => {
  const t = computeTotals([{ amount: 1000 }, { amount: 260 }], 0, 0)
  assert.equal(t.grandTotal, 1260)
})

test('GST only / discount only', () => {
  assert.equal(computeTotals([{ amount: 1000 }], 0, 50).grandTotal, 1050)
  assert.equal(computeTotals([{ amount: 1000 }], 100, 0).grandTotal, 900)
})

test('discount is capped at the subtotal; negatives count as 0', () => {
  assert.equal(computeTotals([{ amount: 100 }], 500, 0).grandTotal, 0)
  assert.equal(computeTotals([{ amount: 100 }], 500, 18).grandTotal, 18)
  const t = computeTotals([{ amount: 100 }], -20, -5)
  assert.equal(t.discount, 0)
  assert.equal(t.gstAmount, 0)
  assert.equal(t.grandTotal, 100)
})

test('paise are kept exactly (no rounding to whole rupees)', () => {
  const t = computeTotals([{ amount: 0.1 }, { amount: 0.2 }], 0.05, 0.015)
  assert.equal(t.subtotal, 0.3)
  assert.equal(t.gstAmount, 0.02)
  assert.equal(t.grandTotal, 0.27)
})

console.log('\nCredit / outstanding')

test('credit bill: outstanding = total − paid', () => {
  assert.equal(creditBalance(3910, 0), 3910)
  assert.equal(creditBalance(3910, 1000), 2910)
  assert.equal(creditBalance(3910, 3910), 0)
  assert.equal(creditBalance(100.3, 0.1), 100.2)
})

test('credit bill: paying more than the total is rejected', () => {
  assert.throws(() => creditBalance(1000, 1000.01))
  assert.throws(() => creditBalance(1000, -1))
})

test('receiving payments reduces outstanding until fully paid', () => {
  let due = creditBalance(3910, 1000)
  due = applyPayment(due, 1500)
  assert.equal(due, 1410)
  due = applyPayment(due, 1410)
  assert.equal(due, 0)
})

test('a payment above the outstanding, zero or negative is rejected', () => {
  assert.throws(() => applyPayment(500, 500.01), /Only ₹500.00 is outstanding/)
  assert.throws(() => applyPayment(500, 0))
  assert.throws(() => applyPayment(500, -10))
  assert.throws(() => applyPayment(0, 1))
})

console.log('\nExample bill No. 701 (29/07/2026)')

test('½ kg Almond, ½ kg Cashew, ¼ kg Roasted Cashew, ½ kg Raisins = ₹3,910', () => {
  const rows = [
    { qty: '1/2', rate: 4500, expected: 2250 },
    { qty: '½', rate: 1800, expected: 900 },
    { qty: '1/4', rate: 2000, expected: 500 },
    { qty: '500g', rate: 520, expected: 260 },
  ]
  const lines = rows.map((r) => {
    const grams = parseQtyInput(r.qty)
    assert.ok(grams !== null)
    const amount = lineAmount(grams, r.rate)
    assert.equal(amount, r.expected)
    return { amount }
  })
  const t = computeTotals(lines, 0, 0)
  assert.equal(t.grandTotal, 3910)
  assert.equal(numberToWords(t.grandTotal), 'Rupees Three Thousand Nine Hundred Ten Only')
})

console.log('\nQuantity input')

test('parseQtyInput understands fractions, grams and kg', () => {
  assert.equal(parseQtyInput('1/2'), 500)
  assert.equal(parseQtyInput('1/4'), 250)
  assert.equal(parseQtyInput('3/4 kg'), 750)
  assert.equal(parseQtyInput('1 1/2'), 1500)
  assert.equal(parseQtyInput('1½'), 1500)
  assert.equal(parseQtyInput('0.5'), 500)
  assert.equal(parseQtyInput('2'), 2000)
  assert.equal(parseQtyInput('250g'), 250)
  assert.equal(parseQtyInput('250 gm'), 250)
  assert.equal(parseQtyInput('1.25kg'), 1250)
  assert.equal(parseQtyInput('0.001'), 1)
})

test('parseQtyInput rejects nonsense', () => {
  for (const bad of ['', '0', '-1', 'abc', '1/0', '0g', '1//2', '0.0001']) {
    assert.equal(parseQtyInput(bad), null, `"${bad}" should be rejected`)
  }
})

test('formatQty', () => {
  assert.equal(formatQty(250), '250 g')
  assert.equal(formatQty(1500), '1.500 kg')
})

console.log('\nAmount in words (Indian system)')

test('numberToWords', () => {
  assert.equal(numberToWords(0), 'Rupees Zero Only')
  assert.equal(numberToWords(1181), 'Rupees One Thousand One Hundred Eighty One Only')
  assert.equal(numberToWords(100000), 'Rupees One Lakh Only')
  assert.equal(numberToWords(1234567), 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only')
  assert.equal(numberToWords(10_00_00_000), 'Rupees Ten Crore Only')
  assert.equal(numberToWords(10.5), 'Rupees Ten and Fifty Paise Only')
  assert.equal(numberToWords(99.99), 'Rupees Ninety Nine and Ninety Nine Paise Only')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
