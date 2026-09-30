import { GState, jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'
import signatureUrl from '../assets/signature.png'
import logoUrl from '../assets/logo-print.jpg'
import { BANK, BUSINESS, INVOICE_TERMS, UPI } from '../config/business'
import { formatKg, round2 } from '../lib/calculator'
import { formatDisplayDate, formatFileDate } from '../lib/date'
import { numberToWords } from '../lib/numberToWords'
import type { Bill } from '../types'

/** Everything the PDF needs. A saved Bill satisfies this; so does a preview built from the form. */
export type InvoiceData = Pick<
  Bill,
  | 'billNumber'
  | 'billDate'
  | 'customerSnapshot'
  | 'items'
  | 'paymentMode'
  | 'subtotal'
  | 'discount'
  | 'gstAmount'
  | 'grandTotal'
  | 'paidAmount'
  | 'balanceDue'
> & { status?: Bill['status'] }

// Built-in PDF fonts have no ₹ glyph, so amounts use "Rs." in the PDF.
function money(n: number): string {
  return round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeFilePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Customer'
}

export function invoiceFileName(data: Pick<InvoiceData, 'billNumber' | 'customerSnapshot' | 'billDate'>): string {
  const number = data.billNumber.replace(/[^0-9A-Za-z]/g, '')
  return `Bill_${number}_${safeFilePart(data.customerSnapshot.name)}_${formatFileDate(data.billDate)}.pdf`
}

const imageCache = new Map<string, string | null>()
/** Loads a bundled image as a data URL. Returns null on failure — the PDF still generates without it. */
async function loadImage(url: string): Promise<string | null> {
  if (imageCache.has(url)) return imageCache.get(url)!
  let dataUrl: string | null = null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    dataUrl = null
  }
  imageCache.set(url, dataUrl)
  return dataUrl
}

export async function generateInvoicePDF(data: InvoiceData): Promise<{ blob: Blob; fileName: string }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const M = 12
  const right = pageW - M
  // A bill with a GST amount is a tax invoice and shows the shop's GSTIN.
  const isGst = data.gstAmount > 0
  const slate900: [number, number, number] = [15, 23, 42]
  const slate500: [number, number, number] = [100, 116, 139]
  const blue: [number, number, number] = [37, 99, 235]

  // ---------------- Header ----------------
  doc.setFillColor(...blue)
  doc.rect(0, 0, pageW, 3, 'F')

  const LOGO = 26
  const logo = await loadImage(logoUrl)
  let tx0 = M
  if (logo) {
    try {
      doc.addImage(logo, 'JPEG', M - 1, 5, LOGO, LOGO, undefined, 'FAST')
      tx0 = M + LOGO + 2
    } catch {
      // ignore a broken image
    }
  }

  let y = 14
  doc.setTextColor(...slate900)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text(BUSINESS.name, tx0, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...slate500)
  y += 5
  for (const line of BUSINESS.addressLines) {
    doc.text(line, tx0, y)
    y += 4
  }
  const contact = [`Mobile: ${BUSINESS.phone}`, BUSINESS.email ? `Email: ${BUSINESS.email}` : ''].filter(Boolean).join('   ')
  doc.text(contact, tx0, y)
  y += 4
  if (isGst) {
    doc.setTextColor(...slate900)
    doc.setFont('helvetica', 'bold')
    doc.text(`GSTIN: ${BUSINESS.gstin}`, tx0, y)
    doc.setFont('helvetica', 'normal')
    y += 4
  }
  if (logo) y = Math.max(y, 5 + LOGO)

  doc.setTextColor(...blue)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(isGst ? 'TAX INVOICE' : 'INVOICE', right, 14, { align: 'right' })
  doc.setFontSize(9)
  doc.setTextColor(...slate900)
  doc.setFont('helvetica', 'normal')
  const meta: [string, string][] = [
    ['Bill No', data.billNumber],
    ['Date', formatDisplayDate(data.billDate)],
    ['Payment', data.paymentMode.toUpperCase()],
  ]
  let my = 21
  for (const [k, v] of meta) {
    doc.setTextColor(...slate500)
    doc.text(`${k}:`, right - 40, my)
    doc.setTextColor(...slate900)
    doc.setFont('helvetica', 'bold')
    doc.text(v, right, my, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    my += 5
  }

  y = Math.max(y, my) + 2
  doc.setDrawColor(226, 232, 240)
  doc.line(M, y, right, y)
  y += 6

  // ---------------- Bill to ----------------
  const c = data.customerSnapshot
  doc.setFontSize(8)
  doc.setTextColor(...slate500)
  doc.text('BILL TO', M, y)
  y += 5
  doc.setFontSize(11)
  doc.setTextColor(...slate900)
  doc.setFont('helvetica', 'bold')
  doc.text(c.name || 'Cash Customer', M, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  y += 4.5
  if (c.address) {
    const lines = doc.splitTextToSize(c.address, 110) as string[]
    doc.text(lines, M, y)
    y += lines.length * 4
  }
  if (c.phone) {
    doc.text(`Phone: ${c.phone}`, M, y)
    y += 4
  }
  if (c.gstNo) {
    doc.text(`GSTIN: ${c.gstNo}`, M, y)
    y += 4
  }
  y += 3

  // ---------------- Items ----------------
  const head = [['#', 'Product', 'HSN', 'Qty (kg)', 'Rate / kg', 'Amount']]
  const body = data.items.map((it, i) => [String(i + 1), it.productName, it.hsnCode, formatKg(it.qtyGrams), money(it.ratePerKg), money(it.amount)])
  const numericCols = [3, 4, 5]
  const columnStyles: Record<number, { halign: 'right' | 'center'; cellWidth?: number }> = { 0: { halign: 'center', cellWidth: 9 } }
  for (const col of numericCols) columnStyles[col] = { halign: 'right' }

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: 'grid',
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.2, textColor: slate900 },
    headStyles: { fillColor: [241, 245, 249], textColor: slate900, fontStyle: 'bold' },
    columnStyles,
    didParseCell: (hook) => {
      if (hook.section === 'head' && numericCols.includes(hook.column.index)) hook.cell.styles.halign = 'right'
    },
  })
  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 6

  // Keep totals + footer together on one page.
  if (y > pageH - 95) {
    doc.addPage()
    y = 20
  }

  // ---------------- Totals (right) ----------------
  const rows: [string, string, boolean?][] = [['Subtotal', money(data.subtotal)]]
  if (data.discount > 0) rows.push(['Discount', `- ${money(data.discount)}`])
  if (data.gstAmount > 0) rows.push(['GST', `+ ${money(data.gstAmount)}`])

  const tx = right - 70
  let ty = y
  doc.setFontSize(9)
  for (const [label, value] of rows) {
    doc.setTextColor(...slate500)
    doc.text(label, tx, ty)
    doc.setTextColor(...slate900)
    doc.text(value, right, ty, { align: 'right' })
    ty += 5.5
  }
  doc.setFillColor(239, 246, 255)
  doc.rect(tx - 3, ty - 4, right - tx + 3, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...blue)
  doc.text('Grand Total', tx, ty + 2)
  doc.text(`Rs. ${money(data.grandTotal)}`, right, ty + 2, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  ty += 10
  if (data.paymentMode === 'credit') {
    doc.setFontSize(9)
    doc.setTextColor(...slate500)
    doc.text('Paid', tx, ty)
    doc.setTextColor(...slate900)
    doc.text(money(data.paidAmount), right, ty, { align: 'right' })
    ty += 5.5
    doc.setFont('helvetica', 'bold')
    if (data.balanceDue > 0) doc.setTextColor(217, 119, 6)
    else doc.setTextColor(5, 150, 105)
    doc.text(data.balanceDue > 0 ? 'Outstanding' : 'Fully paid', tx, ty)
    doc.text(`Rs. ${money(data.balanceDue)}`, right, ty, { align: 'right' })
    doc.setFont('helvetica', 'normal')
    ty += 6
  }

  // ---------------- Amount in words (left) ----------------
  doc.setFontSize(8)
  doc.setTextColor(...slate500)
  doc.text('Amount in words', M, y)
  doc.setFontSize(9)
  doc.setTextColor(...slate900)
  doc.setFont('helvetica', 'bold')
  const words = doc.splitTextToSize(numberToWords(data.grandTotal), tx - M - 8) as string[]
  doc.text(words, M, y + 5)
  doc.setFont('helvetica', 'normal')

  // ---------------- UPI QR ----------------
  // Credit bills ask only for what is still outstanding.
  const qrAmount = data.paymentMode === 'credit' ? data.balanceDue : data.grandTotal
  let ly = y + 5 + words.length * 4 + 4
  if (qrAmount > 0 && data.status !== 'cancelled') {
    const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI.vpa)}&pn=${encodeURIComponent(UPI.merchantName)}&am=${qrAmount.toFixed(2)}&cu=INR`
    const qr = await QRCode.toDataURL(upiUrl, { margin: 1, width: 240 })
    doc.addImage(qr, 'PNG', M, ly, 28, 28, undefined, 'FAST')
    doc.setFontSize(8)
    doc.setTextColor(...slate500)
    doc.text('Scan & pay with any UPI app', M + 31, ly + 6)
    doc.setTextColor(...slate900)
    doc.setFont('helvetica', 'bold')
    doc.text(`Rs. ${money(qrAmount)}`, M + 31, ly + 11)
    doc.setFont('helvetica', 'normal')
    doc.text(`UPI: ${UPI.vpa}`, M + 31, ly + 16)
    ly += 32
  }

  y = Math.max(ly, ty) + 4

  // ---------------- Bank + terms (left), signature (right) ----------------
  doc.setDrawColor(226, 232, 240)
  doc.line(M, y, right, y)
  y += 6
  doc.setFontSize(8)
  doc.setTextColor(...slate500)
  doc.text('BANK DETAILS', M, y)
  doc.setTextColor(...slate900)
  const bankLines = [
    `${BANK.accountName}`,
    `${BANK.bankName}, ${BANK.branch}`,
    `A/c No: ${BANK.accountNumber}   IFSC: ${BANK.ifsc}`,
  ]
  bankLines.forEach((l, i) => doc.text(l, M, y + 4.5 + i * 4))

  let termsY = y + 4.5 + bankLines.length * 4 + 4
  doc.setTextColor(...slate500)
  doc.text('TERMS & CONDITIONS', M, termsY)
  doc.setTextColor(...slate900)
  termsY += 4.5
  INVOICE_TERMS.forEach((t, i) => doc.text(`${i + 1}. ${t}`, M, termsY + i * 4))

  const sigX = right - 55
  doc.setFontSize(9)
  doc.text(`For ${BUSINESS.name}`, right, y, { align: 'right' })
  const signature = await loadImage(signatureUrl)
  if (signature) {
    try {
      doc.addImage(signature, 'PNG', sigX + 8, y + 3, 45, 15, undefined, 'FAST')
    } catch {
      // ignore a broken image — the PDF is still valid
    }
  }
  doc.setDrawColor(148, 163, 184)
  doc.line(sigX, y + 21, right, y + 21)
  doc.setFontSize(8)
  doc.setTextColor(...slate500)
  doc.text('Authorised Signatory', right, y + 25, { align: 'right' })

  // ---------------- Footer ----------------
  doc.setFontSize(8)
  doc.setTextColor(...slate500)
  doc.text('Thank you for your business!', pageW / 2, pageH - 10, { align: 'center' })
  if (!isGst) doc.text('This is a computer generated bill.', pageW / 2, pageH - 6, { align: 'center' })

  // ---------------- Cancelled watermark ----------------
  if (data.status === 'cancelled') {
    const pages = doc.getNumberOfPages()
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      doc.setGState(new GState({ opacity: 0.18 }))
      doc.setTextColor(220, 38, 38)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(80)
      doc.text('CANCELLED', pageW / 2 - 60, pageH / 2 + 30, { angle: 30 })
      doc.setGState(new GState({ opacity: 1 }))
    }
  }

  return { blob: doc.output('blob'), fileName: invoiceFileName(data) }
}
