# AI Prompt: Nuts Inventory & Billing App

Replace every `[BRACKETED]` value before using the prompt. Copy everything inside the code block below and paste it into the AI tool.

```text
You are building a new web app called "Sai Cashews Billing & Inventory". It must follow
EXACTLY the same architecture, tech stack, folder structure and coding style as my existing
travel-billing ERP, which I describe below. It's for a dry-fruits / nuts shop (cashew, almond,
pistachio, raisins, walnut, etc.). The shop sets each product's selling rate every day, keeps
stock in kilograms, and creates bills (GST invoices as PDFs). Every bill must reduce stock
correctly.

=====================================================================
1. TECH STACK (same as my existing project, don't change it)
=====================================================================
- Vite 7 + React 19 + TypeScript (~5.9), plugin: @vitejs/plugin-react-swc
- Tailwind CSS v4 (@tailwindcss/postcss, `@import "tailwindcss";` in index.css)
- react-router-dom v7 (BrowserRouter)
- firebase v12 (Firestore only, used as the database)
- Google Drive API from the browser (gapi + Google Identity Services token client) to store PDFs
- jspdf + jspdf-autotable for invoice PDFs, qrcode for a UPI payment QR on the invoice
- lucide-react icons, react-hot-toast for notifications, clsx + tailwind-merge
- Firebase Hosting for deployment (dist folder, SPA rewrite to /index.html)

vite.config.ts and firebase.json must set the header
`Cross-Origin-Opener-Policy: same-origin-allow-popups` so the Google sign-in popup works.

.env variables (also add a .env.example):
  VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, VITE_GOOGLE_DRIVE_FOLDER_ID,
  VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID

=====================================================================
2. FOLDER STRUCTURE (mirror this)
=====================================================================
src/
  main.tsx, App.tsx, index.css
  assets/signature.png            (signature image printed on the invoice)
  components/
    Layout.tsx                    (sidebar + top bar + Drive-connect gate)
    Pagination.tsx
  lib/
    calculator.ts                 (pure functions: line totals, subtotal, discount, GST, grand total, rounding)
  services/
    firestore.ts                  (Firebase init, `db` export, invoice counter, bill metadata helpers)
    google-drive-service.ts       (GoogleDriveService class)
    drive-config.ts               (reads env vars, throws if missing)
    DriveContext.tsx + useDrive.ts
    AuthContext.tsx
    masterService.ts              (CRUD for products, customers, suppliers)
    inventoryService.ts           (stock-in, adjustments, stock ledger; ALL stock math lives here)
    rateService.ts                (daily rates)
    billService.ts                (create / edit / cancel bill inside Firestore transactions)
    pdfGeneration.ts              (generateInvoicePDF(data) => { blob, fileName })
  pages/
    Login.tsx, Dashboard.tsx, Products.tsx, DailyRates.tsx, Inventory.tsx (stock in + ledger),
    CreateBill.tsx (create + edit, routes /bills/new and /bills/edit/:id), BillList.tsx,
    Customers.tsx, Suppliers.tsx, Reports.tsx

=====================================================================
3. REUSED INFRASTRUCTURE (copy these patterns exactly)
=====================================================================
A) AuthContext: simple username/password login checked on the client, stored in
   sessionStorage under the key "[appname]_auth". Export useAuth(). Put the credentials in
   constants: USERNAME = "[username]", PASSWORD = "[password]".
   ProtectedRoute in App.tsx redirects to /login and wraps pages in <Layout>.

B) GoogleDriveService class (browser-side):
   - constructor({ clientId, apiKey, folderId }), scopes:
     "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly"
   - init(): dynamically load https://apis.google.com/js/api.js and
     https://accounts.google.com/gsi/client in parallel, gapi.client.init with the Drive v3
     discovery doc, google.accounts.oauth2.initTokenClient, then restoreToken()
   - signIn(): requestAccessToken ({prompt:'consent'} the first time, else {prompt:''})
   - Save the token to localStorage "gdrive_token" as {access_token, expires_at}; restore it
     on load if it hasn't expired
   - signOut(): revoke the token, clear it from gapi, remove it from localStorage
   - uploadFile(file, customName): multipart POST to
     https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink
     with parents=[folderId]
   - updateFile(fileId, file): PATCH ...?uploadType=media (used when a bill is edited)
   - deleteFile, listPDFs(pageSize, pageToken, searchQuery) with the query
     "'<folder>' in parents and mimeType='application/pdf' and trashed=false", getFileMetadata

C) DriveContext provider wraps the whole app (AuthProvider > DriveProvider > Toaster > Router)
   and exposes: driveService, isInitialized, isSignedIn, signIn, signOut, uploadFile,
   updateFile, deleteFile, listPDFs, loading, error. useDrive() throws if it's used outside
   the provider.

D) Layout.tsx: white sidebar (w-64, lg:static, slides in on mobile with an overlay and a
   menu button), logo block with the business name + "Inventory & Billing", nav items with
   lucide icons, active item style `bg-blue-50 text-blue-700 border-blue-100`.
   Sticky top bar: page name, a "Sync Active / Offline" pill with Connect/Disconnect, the
   business name, and a logout button.
   IMPORTANT: if Google Drive isn't connected, show a centered "Connect Google Drive" card
   instead of the page content (same as the existing app).
   Nav: Dashboard, Create Bill, Bills, Daily Rates, Inventory, Products, Customers,
   Suppliers, Reports.

E) Invoice numbers: a Firestore transaction on `counters/invoiceNumber` ({current,
   lastUpdated}), formatted as "#00001" (padStart 5). Also provide peekNextInvoiceNumber()
   for showing the next number in the UI without incrementing it.

F) PDF generation (pdfGeneration.ts): A4 GST tax invoice with jsPDF + autoTable, including:
   - Header: business name, address, GSTIN, phone ([fill in]); title "TAX INVOICE"
   - Bill No, Date (dd/mm/yyyy), customer name/address/phone/GSTIN
   - Items table: S.No, Product, HSN, Qty (kg, 3 decimals), Rate/kg, Amount
   - Subtotal, Discount, CGST + SGST (or IGST for other states), Round off, Grand Total
   - Amount in words in the Indian system (Crore/Lakh/Thousand, "Rupees ... Paise Only"),
     same numberToWords as the existing app
   - UPI QR code (upi://pay?pa=[UPI_VPA]&pn=[MERCHANT]&am=<total>&cu=INR) using the qrcode package
   - Bank details, terms, signature image, "Authorised Signatory"
   - fileName = `Bill_<number>_<customer>_<dd-mm-yyyy>.pdf`

G) Bill save flow (same as the existing CreateInvoice):
   1. Validate the form
   2. Run the Firestore transaction (section 5): allocate the bill number, deduct stock,
      write the bill doc
   3. Generate the PDF, upload it to Drive (or updateFile when editing), then update the bill
      doc with driveFileId + driveLink
   4. If the Drive upload fails, keep the bill and its stock deduction, mark it
      `pdfStatus: 'pending'`, and show a "Retry upload" button in BillList. Never roll back
      stock because of a Drive failure.
   BillList shows "View PDF" → https://drive.google.com/file/d/<driveFileId>/view

=====================================================================
4. FIRESTORE DATA MODEL
=====================================================================
Store ALL quantities as INTEGER GRAMS (qtyGrams) to avoid floating-point errors
(1.25 kg = 1250). Convert to kg only for display and input. Store money in rupees rounded to
2 decimals (use a round2 helper everywhere).

products/{id}
  name, category, hsnCode, gstRate (e.g. 5), unit: 'kg',
  stockGrams: number          // current stock, changed ONLY inside transactions
  currentRate: number         // today's selling rate per kg (copied from the latest daily rate)
  lowStockThresholdGrams, isActive, createdAt, updatedAt

dailyRates/{productId_YYYY-MM-DD}
  productId, productName, date 'YYYY-MM-DD', ratePerKg, purchaseRatePerKg (optional), createdAt
  (Saving a rate also updates products.currentRate when the date is today.)

stockMovements/{id}           // append-only ledger; this is the audit trail
  productId, productName, type: 'IN' | 'SALE' | 'SALE_REVERSAL' | 'ADJUSTMENT',
  qtyGrams (positive for additions, negative for deductions),
  balanceAfterGrams, refType: 'purchase' | 'bill' | 'manual', refId, billNumber?,
  supplierId?, purchaseRatePerKg?, note, date, createdAt

bills/{id}
  billNumber '#00001', billDate, customerId, customerSnapshot {name, phone, address, gstNo},
  items: [{ productId, productName, hsnCode, qtyGrams, ratePerKg, gstRate, amount }],
  subtotal, discount, taxableAmount, cgst, sgst, igst, roundOff, grandTotal,
  paymentMode: 'cash' | 'upi' | 'card' | 'credit', paidAmount, balanceDue,
  status: 'active' | 'cancelled', pdfStatus: 'uploaded' | 'pending',
  driveFileId, driveLink, createdAt, updatedAt

customers/{id}   name, phone, address, gstNo, createdAt
suppliers/{id}   name, phone, address, gstNo, createdAt
counters/invoiceNumber   { current, lastUpdated }

Bills keep a SNAPSHOT of the product name, rate and customer, so changing tomorrow's rate or
editing master data never changes old bills.

=====================================================================
5. INVENTORY RULES (most important; must be correct)
=====================================================================
All stock changes use Firestore `runTransaction`, and inside it ALL reads happen BEFORE any
writes.

createBill(items, ...):
  - Merge duplicate products in the cart (sum their qtyGrams)
  - In the transaction: read the counter doc and every product doc in the bill
  - For each item: if product.stockGrams < qtyGrams → throw a clear error
    "Only X.XXX kg of Cashew in stock" (the whole bill fails, nothing is deducted)
  - Write: product.stockGrams -= qtyGrams, one stockMovements 'SALE' doc per item with
    balanceAfterGrams, the counter increment, and the bill doc
  - Stock must never go negative

editBill(billId, newItems):
  - Transaction: read the old bill + all products in the old AND new items
  - Work out the net difference per product (newQty - oldQty). Check stock only for positive
    differences, apply the differences, and write 'SALE_REVERSAL' / 'SALE' movements for them
  - Keep the same billNumber; the PDF is replaced through updateFile(driveFileId)

cancelBill(billId):
  - Transaction: add every item's qty back to stock, write 'SALE_REVERSAL' movements, set
    status='cancelled'. Cancelling twice must do nothing (check status first).
    Don't hard-delete bills.

addStock (Inventory page "Stock In"):
  - Pick a product, enter kg, supplier, purchase rate, and date → transaction increments
    stockGrams and writes an 'IN' movement

adjustStock (damaged, wastage, or correction after a physical count):
  - Requires a reason. Writes an 'ADJUSTMENT' movement and never lets stock go below 0

Stock ledger view: for each product, list movements newest first with running balances, so
the owner can check that current stock = sum of all movements.

=====================================================================
6. PAGES & UX
=====================================================================
- Dashboard: today's sales total, number of bills today, total stock value
  (sum of stockGrams/1000 × currentRate), low-stock alerts, recent bills, and a warning
  listing products with no rate set for today
- Daily Rates: a table of all active products with today's date preselected (date picker to
  change it); edit the rate for each row inline and "Save All" in one batch write; show
  yesterday's rate next to it for reference; rate history per product
- Products: CRUD (name, category, HSN, GST %, low-stock threshold). Opening stock is entered
  once at creation as an 'IN' movement. Stock can't be edited directly here
- Inventory: current stock per product (kg, colored badge when low), "Stock In" modal,
  "Adjust" modal, and a per-product ledger drawer
- Create Bill: pick or quick-add a customer; add product rows (product dropdown shows
  available kg; rate auto-fills from today's daily rate but can be edited); enter qty in kg
  (allow 0.001 precision), with the amount calculated live; block qty > available stock in
  the UI (the transaction checks it again); discount, GST toggle (intra-state CGST+SGST /
  inter-state IGST), payment mode, paid amount; show the next bill number with
  peekNextInvoiceNumber; buttons "Save & Generate PDF" and "Preview PDF"
- Bills: search by bill no / customer, filter by date range and status, pagination
  (reuse Pagination.tsx), actions View PDF / Edit / Cancel (with a confirm) / Retry upload;
  totals row for the filtered set
- Reports: sales by date range, product-wise quantity sold and revenue, stock movement
  report, export to CSV
- UI: neat and clean, slate/blue palette like the existing app, rounded-xl cards, and it must
  work on mobile (the shop owner will use a phone). Use react-hot-toast for every
  success/error.

=====================================================================
7. QUALITY REQUIREMENTS
=====================================================================
- Strict TypeScript interfaces for every collection, no `any` in the services
- The stock math and bill totals in lib/calculator.ts are pure functions; add a small test
  script (tsx) that covers: a sale deducts correctly, a sale over available stock is
  rejected, editing a bill applies only the difference, cancelling restores stock,
  cancelling twice does nothing, and grams↔kg conversion with rounding
- Disable Save buttons while saving (no double-submit, since that would deduct stock twice)
- `npm run build` must pass with no TypeScript errors
- Give me the Firebase setup steps (create the project, enable Firestore, suggested
  firestore.rules), the Google Cloud steps (OAuth client with authorized JS origins for
  localhost:5173 and the hosting domain, API key, enable the Drive API, create the Drive
  folder and copy its ID), and deploy steps (`npm run build && firebase deploy`)

Build it step by step: first the project scaffold + infrastructure (auth, drive, firestore,
layout), then masters (products, customers, suppliers), then daily rates, then the
inventory service, then billing + PDF, then dashboard and reports. Show me each step
before you move on.
```

## Notes: what changes from the travels project, and why

- **Stock is stored in whole grams.** For example, 1.25 kg is stored as 1250. Decimal kilograms add up small errors over hundreds of bills.
- **Stock only changes inside a Firestore transaction.** Two bills saved at the same moment can't both use the same stock, and a bill with too little stock fails completely instead of taking stock for only some items.
- **Every stock change is recorded in a `stockMovements` log.** If the stock number ever looks wrong, you can trace every addition and deduction.
- **Bills are cancelled, not deleted, and cancelling puts the stock back.** Editing a bill only applies the difference in quantity.
- **Stock is not rolled back if the Drive upload fails.** The bill is marked "pending" and can be uploaded again.
- **Login:** the prompt keeps the hardcoded login from the travels app. Since the new app handles money and stock, consider switching to Firebase Authentication.
