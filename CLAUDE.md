# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

"Sai Cashews Billing & Inventory" is a GST billing and stock app for a nuts shop in Coimbatore: React 19 + Vite 7 + TypeScript, Tailwind v4, Firestore as the database, invoice PDFs stored in Google Drive, and hosting on Firebase Hosting. The original spec is `nuts-inventory-billing-prompt.md`. `example.txt` is a real handwritten bill (No. 701) that shaped some choices: bills without GST and fractional kg quantities. Bill numbers run sequentially from #00001. There are no customer or supplier records: each bill carries the customer name, phone, GSTIN and address typed in on that bill (`customerSnapshot`). Setup and deploy steps are in `SETUP.md`.

## Commands

- `npm run dev`: dev server on localhost:5173. Needs `.env` (see `.env.example`). Without it, the Drive gate shows a missing-env error.
- `npm run build`: `tsc -b && vite build`. It must pass with zero TS errors. `tsconfig.node.json` also type-checks `scripts/`.
- `npm test`: runs `scripts/test-calculator.ts` via tsx (plain `node:assert`, no framework). There's no per-test filter; comment out `test(...)` calls or run a scratch tsx file to isolate one.
- `npm run build && firebase deploy`: deploy the hosting and Firestore rules.

There is no linter configured.

## Architecture

- **Provider nesting (`App.tsx`):** `AuthProvider > DriveProvider > Toaster > BrowserRouter`. `ProtectedRoute` wraps pages in `Layout`, and `Layout` replaces all page content with a "Connect Google Drive" card until Drive is signed in. Auth is a hardcoded, sessionStorage-based dummy login (`AuthContext.tsx`).
- **Pure core (`src/lib/calculator.ts`):**
  - Unit conversion (`kgToGrams`, `parseQtyInput`, which accepts `1/2`, `½`, `250g` and more).
  - `computeTotals(lines, discount, gstAmount)`: grand total = subtotal − discount + GST. Both amounts are rupees typed on the bill, with no percentage GST and no rounding to whole rupees.
  - The **stock planners** `planSale`, `planEdit`, `planCancel`, `planAdjust`, `planStockIn` and `canCancel`. They take a `StockMap` and return `StockChange[]` or throw `StockError`. Everything stock-related is decided here and tested in `scripts/test-calculator.ts`.
- **Transactions (`services/inventoryService.ts`, `services/billService.ts`):** each operation runs as one `runTransaction`:
  1. **Read** everything: `reserveInvoiceNumber(tx)` and `readProducts(tx, ids)`.
  2. **Plan** with the pure planners.
  3. **Write** through `applyStockChanges` / `writeMovement` (product `stockGrams` plus one `stockMovements` doc per change) and the bill doc.

  Keep all reads before all writes. `reserveInvoiceNumber` returns a `commit()` for exactly this reason.
- **Save flow (`CreateBill.tsx` → `services/billPdf.ts`):**
  1. The transaction saves the bill with `pdfStatus: 'pending'`.
  2. `syncBillPdf` generates the PDF and runs `uploadFile`, or `updateFile` if `driveFileId` exists.
  3. `attachPdf` sets it to `'uploaded'`.

  `syncBillPdf` never throws, and a Drive failure never rolls back stock. BillList offers "Retry upload" for pending bills. Cancelling re-uploads the PDF with a CANCELLED watermark.
- **PDF (`services/pdfGeneration.ts`):** jsPDF + autotable + qrcode. It's lazy-loaded with `await import(...)` to keep the ~800 KB pdf chunk out of the initial bundle, so keep new callers doing the same. Built-in fonts have no ₹ glyph, so the PDF prints "Rs.". The title is "TAX INVOICE" (with the shop GSTIN) when `gstAmount > 0`, and "INVOICE" otherwise.
- **Logo:** `sai-cashew.jpeg` (1280 px) is the source. The app uses resized copies: `src/assets/logo.jpg` (256 px) for the sidebar, header and login page, `src/assets/logo-print.jpg` (480 px) for the PDF header, and `public/logo-192.jpg` for the browser-tab and home-screen icon.
- **Shop constants:** everything printed on invoices (address, GSTIN, UPI, bank, terms), `INVOICE_NUMBER_START` and `SAMPLE_PRODUCTS` live in `src/config/business.ts`. Values marked DUMMY there, and the credentials in `AuthContext.tsx`, are placeholders.

## Invariants

- **Quantities are integer grams** (`qtyGrams`, `stockGrams`, `lowStockThresholdGrams`). Convert to kg only for display and input. Money is rounded with `round2`. Rates are per kg. Old Firestore bills may still have `cgst/sgst/igst` or lack `paidAmount/balanceDue/payments`, and `toBill` in billService normalises both.
- **`products.stockGrams` changes only inside a transaction via the planners.** `masterService.updateProduct` must never write it. Opening stock is written by `createProduct` in the same transaction as an `IN` movement, so the ledger sum always equals stock. The Inventory ledger drawer checks this.
- **Edits apply only the net difference per product.** Cancel is a no-op on an already-cancelled bill. Bills are never deleted, and `firestore.rules` enforces that plus an append-only ledger and a non-negative integer `stockGrams`.
- **Bills store snapshots** of the customer, product name, HSN, GST rate and rate/kg. `buildItems` in billService re-snapshots them from the product docs read inside the transaction.
- **The rate on a bill is editable.** The Create Bill form pre-fills it from `product.currentRate` (today's Daily Rate), or from the bill's own rate when editing (`ratesOnBill`). `buildItems` saves the rate the form sends and requires it to be > 0.
- **Credit bills:** `paymentMode: 'credit'` tracks `paidAmount`, `balanceDue` and a `payments[]` history. Cash, UPI and card bills always have `paidAmount = grandTotal` and `balanceDue = 0`. Money received later goes through `recordPayment`, a transaction guarded by `applyPayment`, so the balance can never go below 0. Editing a bill that is already on credit keeps its payments and recomputes the balance with `creditBalance`, which throws if the amount already paid exceeds the new total. `listOutstandingBills` queries `balanceDue > 0`, which needs only a single-field index.
- Dates are local `YYYY-MM-DD` strings (`lib/date.ts`), never `toISOString()`, because that shifts to UTC.
- No composite Firestore indexes: queries filter on one field and sort client-side. Keep it that way, or add the index to `firestore.indexes.json`.
- Firestore is initialised with `ignoreUndefinedProperties: true`, so optional fields can be passed as `undefined`.
- Save buttons use a ref guard plus a disabled state, because a double submit would deduct stock twice.
