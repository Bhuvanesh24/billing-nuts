const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundred) parts.push(`${ONES[hundred]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

/** Integer → words in the Indian system (Crore / Lakh / Thousand). */
export function integerToWords(num: number): string {
  let n = Math.floor(Math.abs(num))
  if (n === 0) return 'Zero'

  const parts: string[] = []
  const crore = Math.floor(n / 10_000_000)
  n %= 10_000_000
  const lakh = Math.floor(n / 100_000)
  n %= 100_000
  const thousand = Math.floor(n / 1_000)
  n %= 1_000

  if (crore) parts.push(`${integerToWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`)
  if (n) parts.push(threeDigits(n))
  return parts.join(' ')
}

/** 3910 → "Rupees Three Thousand Nine Hundred Ten Only"; 10.5 → "Rupees Ten and Fifty Paise Only" */
export function numberToWords(amount: number): string {
  const totalPaise = Math.round(Math.abs(amount) * 100)
  const rupees = Math.floor(totalPaise / 100)
  const paise = totalPaise % 100
  let words = `Rupees ${integerToWords(rupees)}`
  if (paise) words += ` and ${twoDigits(paise)} Paise`
  return `${words} Only`
}
