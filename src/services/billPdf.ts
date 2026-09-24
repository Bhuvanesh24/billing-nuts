import { attachPdf } from './billService'
import type { DriveContextValue } from './DriveContext'
import type { Bill } from '../types'

export interface PdfSyncResult {
  ok: boolean
  blob: Blob | null
  fileName: string
  driveFileId: string
  driveLink: string
  error?: string
}

export function driveViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

/**
 * Generates the bill PDF and uploads it (or replaces the existing Drive file).
 * Never throws: a Drive failure leaves the bill as pdfStatus 'pending' so it
 * can be retried from the Bills page. Stock is NEVER rolled back here.
 */
export async function syncBillPdf(bill: Bill, drive: Pick<DriveContextValue, 'uploadFile' | 'updateFile'>): Promise<PdfSyncResult> {
  let blob: Blob | null = null
  let fileName = ''
  try {
    const { generateInvoicePDF } = await import('./pdfGeneration')
    const pdf = await generateInvoicePDF(bill)
    blob = pdf.blob
    fileName = pdf.fileName

    let fileId = bill.driveFileId
    if (fileId) {
      try {
        await drive.updateFile(fileId, blob)
      } catch (e) {
        // The old file may have been deleted from Drive — upload a fresh one instead.
        if (e instanceof Error && /\(404\)/.test(e.message)) fileId = ''
        else throw e
      }
    }
    if (!fileId) {
      const uploaded = await drive.uploadFile(blob, fileName)
      fileId = uploaded.id
    }
    const link = driveViewLink(fileId)
    await attachPdf(bill.id, fileId, link)
    return { ok: true, blob, fileName, driveFileId: fileId, driveLink: link }
  } catch (e) {
    return {
      ok: false,
      blob,
      fileName,
      driveFileId: bill.driveFileId,
      driveLink: bill.driveLink,
      error: e instanceof Error ? e.message : 'PDF upload failed',
    }
  }
}
