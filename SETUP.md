# Setup: Sai Cashews Billing & Inventory

## 1. Install and run locally

```bash
npm install
cp .env.example .env      # then fill in the values from steps 2 and 3
npm run dev               # http://localhost:5173
```

Login (dummy, change in `src/services/AuthContext.tsx`): **admin / admin123**

## 2. Firebase (database + hosting)

1. Go to https://console.firebase.google.com and **Add project** (Google Analytics is optional).
2. **Build → Firestore Database → Create database**. Choose production mode and the region `asia-south1` (Mumbai).
3. **Project settings → General → Your apps → Web app (</>)**. Register the app and copy the config values into `.env`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
4. Install the CLI and link the project:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add            # pick the project, alias "default"
   firebase deploy --only firestore:rules,firestore:indexes
   ```

`firestore.rules` stops stock from going negative or fractional, keeps the stock ledger append-only, and blocks deleting bills. It **cannot check who is logged in**, because the login is hardcoded on the client. Before real use, switch to Firebase Authentication:
- In the console, go to **Authentication → Sign-in method** and enable Email/Password, then add the shop user.
- Replace the check in `AuthContext.tsx` with `signInWithEmailAndPassword`.
- In `firestore.rules`, change `signedIn()` to return `request.auth != null`.

No composite indexes are needed. Every query uses a single field, and sorting happens in the app.

## 3. Google Cloud (Drive for invoice PDFs)

Use the Google Cloud project that Firebase created (same name).

1. https://console.cloud.google.com → select the project → **APIs & Services → Library** → enable **Google Drive API**.
2. **APIs & Services → OAuth consent screen**:
   - User type: External. Fill in the app name and emails.
   - Add the scopes `.../auth/drive.file` and `.../auth/drive.readonly`.
   - Under **Test users**, add the shop's Google account. While the app is in "Testing", only test users can sign in.
3. **Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173`, `https://<project-id>.web.app` and `https://<project-id>.firebaseapp.com`. Add a custom domain too if you use one.
   - Copy the **Client ID** → `VITE_GOOGLE_CLIENT_ID`.
4. **Credentials → Create credentials → API key**. Restrict it to the Google Drive API and your website origins, then copy it → `VITE_GOOGLE_API_KEY`.
5. In Google Drive, create a folder such as "Sai Cashews Bills" and open it. The URL looks like `https://drive.google.com/drive/folders/<FOLDER_ID>`. Copy the ID → `VITE_GOOGLE_DRIVE_FOLDER_ID`.

## 4. Before going live

Replace the dummy values:

| What | Where |
| --- | --- |
| Login username/password | `src/services/AuthContext.tsx` (`USERNAME`, `PASSWORD`) |
| GSTIN, UPI ID, bank details, terms | `src/config/business.ts` |
| Signature image | `src/assets/signature.png`: a PNG with a transparent background, about 300×100 px |
| First bill number | `INVOICE_NUMBER_START` in `src/config/business.ts` (currently 1, so bills run #00001, #00002, …). This only applies before the first bill is saved. After that, the counter lives in Firestore at `counters/invoiceNumber`. |
| Default tax mode | `DEFAULT_TAX_MODE` in `src/config/business.ts` (`'none'`, the same as the handwritten bills) |

## 5. Deploy

```bash
npm run build && firebase deploy
```

`firebase.json` serves `dist/` with an SPA rewrite and the `Cross-Origin-Opener-Policy: same-origin-allow-popups` header that the Google sign-in popup needs.

## 6. First-day checklist

1. Log in, then connect Google Drive.
2. On **Products**, click **Add sample products** (the 4 items from bill No. 701) or add your own. Enter opening stock when you create each product.
3. On **Daily Rates**, check today's rates and click **Save All**.
4. On **Inventory**, use **Stock In** for any stock that arrives, with the purchase rate.
5. On **Create Bill**, enter the customer name (plus phone, GSTIN and address if needed). Type quantities as `1/2`, `1/4`, `250g` or `0.5`, then click **Save & Generate PDF**.
